import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InvoiceStatus, UserRole, Prisma, InvoicePaymentStatus } from '@prisma/client';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceStatusDto } from './dto/update-invoice-status.dto';
import { AddChargeDto } from './dto/add-charge.dto';
import { CreateReplacementDto } from './dto/create-replacement.dto';
import { Decimal } from '@prisma/client/runtime/library';

const INVOICE_ITEM_INCLUDE = {
  invoiceItems: {
    include: {
      service: {
        select: { code: true },
      },
    },
  },
  additionalCharges: true,
  patient: {
    select: {
      id: true,
      civilId: true,
      fullNameAr: true,
      phone: true,
    },
  },
  visit: {
    select: {
      id: true,
      type: true,
      visitDate: true,
      diagnosis: true,
    },
  },
  payments: true,
};

@Injectable()
export class InvoicesService {
  // Status transition rules: DRAFT -> ISSUED -> VOID (or DRAFT -> VOID directly)
  private readonly VALID_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
    DRAFT: ['ISSUED', 'VOID'],
    ISSUED: ['VOID'],
    VOID: [], // Terminal state
  };

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  private validateStatusTransition(currentStatus: InvoiceStatus, newStatus: InvoiceStatus): void {
    if (currentStatus === newStatus) {
      return;
    }

    const validTransitions = this.VALID_TRANSITIONS[currentStatus];
    if (!validTransitions.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${currentStatus} to ${newStatus}. Valid transitions: ${validTransitions.join(', ') || 'none'}`,
      );
    }
  }

  private async generateInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
    // Use PostgreSQL sequence for true atomic invoice numbering
    // Must use transaction client to ensure atomicity with invoice creation
    const result = await tx.$queryRaw<Array<{ nextval: string }>>`
      SELECT nextval('invoice_number_seq') as nextval
    `;

    const nextNumber = parseInt(result[0].nextval, 10);
    return `INV-${String(nextNumber).padStart(6, '0')}`;
  }

  async create(createInvoiceDto: CreateInvoiceDto, userId: string, ipAddress?: string, userAgent?: string) {
    // Use transaction for atomic invoice creation with audit logging
    return this.prisma.$transaction(async (tx) => {
      // Lock the visit row to prevent concurrent invoice creation using SELECT ... FOR UPDATE
      await tx.$queryRaw`SELECT * FROM "Visit" WHERE id = ${createInvoiceDto.visitId}::uuid FOR UPDATE`;

      // Re-read the visit after locking to get the actual data
      const visit = await tx.visit.findUnique({
        where: { id: createInvoiceDto.visitId },
      });

      if (!visit) {
        throw new NotFoundException('Visit not found');
      }

      if (visit.status === 'CANCELLED') {
        throw new BadRequestException('Cannot create an invoice for a cancelled visit');
      }

      // Check for existing active invoices (DRAFT or ISSUED) for this visit
      // Historical VOID invoices are allowed to coexist
      const existingActiveInvoice = await tx.invoice.findFirst({
        where: {
          visitId: createInvoiceDto.visitId,
          status: { in: ['DRAFT', 'ISSUED'] }
        },
      });

      if (existingActiveInvoice) {
        throw new ConflictException('This visit already has an active invoice');
      }

      // Validate payment method - only KNET, LINK, and OTHER are allowed
      const validPaymentMethods = ['KNET', 'LINK', 'OTHER'];
      if (!validPaymentMethods.includes(createInvoiceDto.paymentMethod)) {
        throw new BadRequestException(`Invalid payment method. Only ${validPaymentMethods.join(' and ')} are allowed.`);
      }

      // Validate and price every requested service, snapshotting name + price
      const serviceIds = createInvoiceDto.items.map((item) => item.serviceId);
      const services = await tx.service.findMany({
        where: { id: { in: serviceIds } },
      });

      const serviceMap = new Map(services.map((s) => [s.id, s]));
      const invoiceItemsData = createInvoiceDto.items.map((item) => {
        const service = serviceMap.get(item.serviceId);

        if (!service) {
          throw new NotFoundException(`Service ${item.serviceId} not found`);
        }

        if (!service.isActive) {
          throw new BadRequestException(`Service "${service.name}" is not active and cannot be invoiced`);
        }

        const quantity = item.quantity ?? 1;
        // Use the per-item override if provided, otherwise fall back to the
        // service's current default price. The service's own price is never
        // written to here — this only affects this one invoice's snapshot.
        const unitPrice = item.unitPrice !== undefined
          ? new Decimal(item.unitPrice)
          : service.currentPrice;

        // Calculate line total using Decimal arithmetic
        const lineTotal = unitPrice.mul(quantity).toDecimalPlaces(2);

        return {
          serviceId: service.id,
          serviceNameSnapshot: service.name,
          unitPriceSnapshot: unitPrice,
          quantity,
          lineTotal,
        };
      });

      // Calculate subtotal using Decimal arithmetic
      const subtotal = invoiceItemsData.reduce((sum, i) => sum.add(i.lineTotal), new Decimal(0)).toDecimalPlaces(2);

      // Calculate additional charges
      const additionalChargesData = (createInvoiceDto.additionalCharges || []).map(charge => {
        const chargeValue = new Decimal(charge.chargeValue);
        let calculatedAmount: Decimal;

        if (charge.chargeType === 'PERCENTAGE') {
          // Percentage of subtotal
          calculatedAmount = subtotal.mul(chargeValue.div(100)).toDecimalPlaces(2);
        } else {
          // Fixed amount
          calculatedAmount = chargeValue.toDecimalPlaces(2);
        }

        return {
          chargeType: charge.chargeType,
          chargeValue: chargeValue,
          calculatedAmount: calculatedAmount,
          description: charge.description,
        };
      });

      // Calculate total from subtotal + additional charges
      const totalCharges = additionalChargesData.reduce((sum, charge) => sum.add(charge.calculatedAmount), new Decimal(0)).toDecimalPlaces(2);
      const total = subtotal.add(totalCharges).toDecimalPlaces(2);

      // Generate final invoice number using PostgreSQL sequence
      const finalInvoiceNumber = await this.generateInvoiceNumber(tx);

      // Create the invoice as ISSUED with full payment in one transaction
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: finalInvoiceNumber,
          visitId: visit.id,
          patientId: visit.patientId,
          status: 'ISSUED',
          issuedAt: new Date(),
          issuedById: userId,
          subtotal,
          total,
          paid: total,
          remaining: new Decimal(0),
          paymentStatus: 'PAID',
          createdById: userId,
          invoiceItems: {
            create: invoiceItemsData,
          },
          additionalCharges: {
            create: additionalChargesData,
          },
          payments: {
            create: {
              amount: total,
              method: createInvoiceDto.paymentMethod,
              status: 'RECORDED',
              paymentDate: new Date(),
              recordedById: userId,
            },
          },
        },
        include: INVOICE_ITEM_INCLUDE,
      });

      if (visit.status !== 'COMPLETED') {
        await tx.visit.update({
          where: { id: visit.id },
          data: { status: 'COMPLETED' },
        });

        await tx.auditLog.create({
          data: {
            userId,
            action: 'UPDATE_STATUS',
            entityType: 'Visit',
            entityId: visit.id,
            beforeState: { status: visit.status },
            afterState: { status: 'COMPLETED', invoiceId: invoice.id },
            ipAddress,
            userAgent,
          },
        });
      }

      // Audit log for invoice creation
      await tx.auditLog.create({
        data: {
          userId,
          action: 'CREATE',
          entityType: 'Invoice',
          entityId: invoice.id,
          beforeState: null,
          afterState: {
            invoiceNumber: invoice.invoiceNumber,
            visitId: invoice.visitId,
            patientId: invoice.patientId,
            total: invoice.total,
            status: invoice.status,
            paymentMethod: createInvoiceDto.paymentMethod,
          },
          ipAddress,
          userAgent,
        },
      });

      // Audit log for payment recording
      await tx.auditLog.create({
        data: {
          userId,
          action: 'CREATE',
          entityType: 'Payment',
          entityId: invoice.payments[0].id,
          beforeState: null,
          afterState: {
            invoiceId: invoice.id,
            amount: invoice.payments[0].amount,
            method: invoice.payments[0].method,
            status: 'RECORDED',
          },
          ipAddress,
          userAgent,
        },
      });

      return invoice;
    });
  }

  async findAll(patientId?: string, status?: InvoiceStatus, page: number = 1, limit: number = 20, search?: string) {
    const skip = (page - 1) * limit;

    const normalizedSearch = search?.trim();
    const where: Prisma.InvoiceWhereInput = {};

    if (patientId) {
      where.patientId = patientId;
    }

    if (status) {
      where.status = status;
    }
    if (normalizedSearch) {
      where.OR = [
        { invoiceNumber: { contains: normalizedSearch } },
        { patient: { fullNameAr: { contains: normalizedSearch, mode: 'insensitive' } } },
        { patient: { fullNameEn: { contains: normalizedSearch, mode: 'insensitive' } } },
        { patient: { phone: { contains: normalizedSearch, mode: 'insensitive' } } },
      ];
    }

    const [invoices, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: INVOICE_ITEM_INCLUDE,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      data: invoices,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: INVOICE_ITEM_INCLUDE,
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return invoice;
  }

  async updateStatus(id: string, updateStatusDto: UpdateInvoiceStatusDto, userId: string, userRole: UserRole, ipAddress?: string, userAgent?: string) {
    // Only ADMIN can void invoices
    if (updateStatusDto.status === 'VOID' && userRole !== 'ADMIN') {
      throw new ForbiddenException('Only admin can void invoices');
    }

    // Use transaction for atomic status change and number assignment
    return this.prisma.$transaction(async (tx) => {
      // The state check and sequence allocation must be serialized on this row.
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${id}::uuid FOR UPDATE`;
      const invoice = await tx.invoice.findUnique({
        where: { id },
        include: INVOICE_ITEM_INCLUDE,
      });

      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      this.validateStatusTransition(invoice.status, updateStatusDto.status);

      // Prevent re-issuance of already finalized invoices
      if (invoice.status === 'ISSUED' && updateStatusDto.status === 'ISSUED') {
        throw new BadRequestException('Invoice is already issued and cannot be re-issued');
      }

      if (updateStatusDto.status === 'VOID') {
        const recordedPayment = await tx.payment.findFirst({
          where: {
            invoiceId: id,
            status: 'RECORDED',
          },
          select: { id: true },
        });

        if (recordedPayment) {
          throw new BadRequestException(
            'Invoice cannot be voided while recorded payments exist. Reverse all payments before voiding the invoice.',
          );
        }
      }

      const data: { status: InvoiceStatus; issuedAt?: Date; issuedById?: string; invoiceNumber?: string; paid?: Decimal; remaining?: Decimal; paymentStatus?: InvoicePaymentStatus } = {
        status: updateStatusDto.status,
      };

      if (updateStatusDto.status === 'ISSUED') {
        data.issuedAt = new Date();
        data.issuedById = userId;
        
        // Assign final invoice number using PostgreSQL sequence within transaction
        data.invoiceNumber = await this.generateInvoiceNumber(tx);

        // Handle payment for DRAFT invoices being issued
        if (invoice.status === 'DRAFT') {
          // Check if there are existing payment allocations (replacement invoice)
          const existingAllocations = await tx.paymentAllocation.findMany({
            where: { invoiceId: id },
            include: {
              payment: {
                select: { id: true, amount: true, status: true },
              },
            },
          });

          const allocatedCredit = existingAllocations
            .filter(allocation => allocation.payment.status === 'RECORDED')
            .reduce((sum, allocation) => sum.add(allocation.amount), new Decimal(0));

          // Check if there are existing direct payments (to prevent duplicate payments)
          const existingDirectPayments = await tx.payment.findMany({
            where: { invoiceId: id, status: 'RECORDED' },
            select: { amount: true },
          });

          const directCredit = existingDirectPayments
            .reduce((sum, payment) => sum.add(payment.amount), new Decimal(0));

          const totalExistingCredit = allocatedCredit.add(directCredit);
          const remainingBalance = Decimal.max(invoice.total.sub(totalExistingCredit), new Decimal(0)).toDecimalPlaces(2);

          if (remainingBalance.gt(0)) {
            // Need additional payment
            if (!updateStatusDto.paymentMethod) {
              throw new BadRequestException('Payment method is required when issuing a DRAFT invoice with remaining balance');
            }

            // Validate payment method
            const validPaymentMethods = ['KNET', 'LINK', 'OTHER'];
            if (!validPaymentMethods.includes(updateStatusDto.paymentMethod)) {
              throw new BadRequestException('Invalid payment method. Only KNET, LINK, and OTHER are allowed.');
            }

            // Create payment for remaining balance
            const newPayment = await tx.payment.create({
              data: {
                invoiceId: id,
                amount: remainingBalance,
                method: updateStatusDto.paymentMethod,
                status: 'RECORDED',
                paymentDate: new Date(),
                recordedById: userId,
              },
            });

            // Audit log for payment recording
            await tx.auditLog.create({
              data: {
                userId,
                action: 'CREATE',
                entityType: 'Payment',
                entityId: newPayment.id,
                beforeState: null,
                afterState: {
                  invoiceId: id,
                  amount: remainingBalance.toString(),
                  method: updateStatusDto.paymentMethod,
                  status: 'RECORDED',
                  context: 'Draft invoice issuance payment',
                },
                ipAddress,
                userAgent,
              },
            });

            // Update invoice to fully paid
            data.paid = invoice.total;
            data.remaining = new Decimal(0);
            data.paymentStatus = 'PAID';
          } else {
            // Fully covered by existing credit (allocations or direct payments)
            data.paid = invoice.total;
            data.remaining = new Decimal(0);
            data.paymentStatus = 'PAID';
          }
        }
      }

      const updated = await tx.invoice.update({
        where: { id },
        data,
        include: INVOICE_ITEM_INCLUDE,
      });

      // Audit log within transaction
      await tx.auditLog.create({
        data: {
          userId,
          action: 'STATUS_CHANGE',
          entityType: 'Invoice',
          entityId: id,
          beforeState: { status: invoice.status, invoiceNumber: invoice.invoiceNumber },
          afterState: { status: updated.status, invoiceNumber: updated.invoiceNumber },
          ipAddress,
          userAgent,
        },
      });

      return updated;
    });
  }

  async addCharge(invoiceId: string, addChargeDto: AddChargeDto, userId: string, userRole: UserRole, ipAddress?: string, userAgent?: string) {
    // Admin and Receptionist can add charges
    if (userRole !== 'ADMIN' && userRole !== 'RECEPTIONIST') {
      throw new ForbiddenException('Only admin and receptionist can add charges');
    }

    // Use transaction to ensure atomic charge addition with audit logging
    return this.prisma.$transaction(async (tx) => {
      // Lock the invoice row FIRST to prevent concurrent modifications
      await tx.$queryRaw`SELECT * FROM "Invoice" WHERE id = ${invoiceId}::uuid FOR UPDATE`;
      
      // Re-read invoice with authoritative state after lock
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: INVOICE_ITEM_INCLUDE,
      });

      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      // Only allow adding charges to draft invoices
      if (invoice.status !== 'DRAFT') {
        throw new BadRequestException('Additional charges can only be added to draft invoices');
      }

      // Calculate charge based on fresh invoice state
      const chargeValue = new Decimal(addChargeDto.chargeValue);
      let calculatedAmount: Decimal;
      
      if (addChargeDto.chargeType === 'PERCENTAGE') {
        // Percentage of subtotal
        calculatedAmount = invoice.subtotal.mul(chargeValue.div(100)).toDecimalPlaces(2);
      } else {
        // Fixed amount
        calculatedAmount = chargeValue.toDecimalPlaces(2);
      }

      // Add the charge
      await tx.invoiceAdditionalCharge.create({
        data: {
          invoiceId,
          chargeType: addChargeDto.chargeType,
          chargeValue: chargeValue,
          calculatedAmount: calculatedAmount,
          description: addChargeDto.description,
        },
      });

      // Recalculate invoice total from authoritative stored charges in same transaction
      const allCharges = await tx.invoiceAdditionalCharge.findMany({
        where: { invoiceId },
      });

      const totalCharges = allCharges.reduce((sum, charge) => sum.add(charge.calculatedAmount), new Decimal(0)).toDecimalPlaces(2);
      const newTotal = invoice.subtotal.add(totalCharges).toDecimalPlaces(2);
      const newRemaining = newTotal.sub(invoice.paid).toDecimalPlaces(2);

      // Recalculate payment status based on new total and existing paid amount
      let newPaymentStatus: InvoicePaymentStatus = 'UNPAID';
      if (newRemaining.equals(0)) {
        newPaymentStatus = 'PAID';
      } else if (newRemaining.lessThan(newTotal)) {
        newPaymentStatus = 'PARTIALLY_PAID';
      }

      // Update invoice
      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          total: newTotal,
          remaining: newRemaining,
          paymentStatus: newPaymentStatus,
        },
        include: INVOICE_ITEM_INCLUDE,
      });

      // Audit log within transaction
      await tx.auditLog.create({
        data: {
          userId,
          action: 'CHARGE_ADDED',
          entityType: 'Invoice',
          entityId: invoiceId,
          beforeState: null,
          afterState: {
            chargeType: addChargeDto.chargeType,
            chargeValue: addChargeDto.chargeValue,
            calculatedAmount: calculatedAmount.toString(),
          },
          ipAddress,
          userAgent,
        },
      });

      return updated;
    });
  }

  async createReplacement(originalInvoiceId: string, createReplacementDto: CreateReplacementDto, userId: string, userRole: UserRole, ipAddress?: string, userAgent?: string) {
    // Only ADMIN can create invoice replacements
    if (userRole !== 'ADMIN') {
      throw new ForbiddenException('Only admin can create invoice replacements');
    }

    // Use transaction for the complete replacement workflow with atomic number generation
    return this.prisma.$transaction(async (tx) => {
      // Serialize payment, reversal, and replacement against the original before
      // reading any financial or replacement state.
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${originalInvoiceId}::uuid FOR UPDATE`;

      // This is the authoritative post-lock snapshot. Never use a pre-lock
      // financial read to build a replacement.
      const originalInvoice = await tx.invoice.findUnique({
        where: { id: originalInvoiceId },
        include: {
          invoiceItems: true,
          additionalCharges: true,
        },
      });

      if (!originalInvoice) {
        throw new NotFoundException('Original invoice not found');
      }

      if (originalInvoice.replacedByInvoiceId) {
        throw new ConflictException('This invoice already has a replacement');
      }

      // Only issued invoices can be replaced.
      if (originalInvoice.status !== 'ISSUED') {
        throw new BadRequestException('Only issued invoices can be replaced');
      }

      // Get the visit and patient information
      const visit = await tx.visit.findUnique({
        where: { id: originalInvoice.visitId },
      });

      if (!visit) {
        throw new NotFoundException('Visit not found');
      }

      // Validate and price every requested service, snapshotting name + price
      const serviceIds = createReplacementDto.items.map((item) => item.serviceId);
      const services = await tx.service.findMany({
        where: { id: { in: serviceIds } },
      });

      const serviceMap = new Map(services.map((s) => [s.id, s]));
      const invoiceItemsData = createReplacementDto.items.map((item) => {
        const service = serviceMap.get(item.serviceId);

        if (!service) {
          throw new NotFoundException(`Service ${item.serviceId} not found`);
        }

        if (!service.isActive) {
          throw new BadRequestException(`Service "${service.name}" is not active and cannot be invoiced`);
        }

        const quantity = item.quantity ?? 1;
        const unitPrice = item.unitPrice !== undefined 
          ? new Decimal(item.unitPrice) 
          : service.currentPrice;
        
        const lineTotal = unitPrice.mul(quantity).toDecimalPlaces(2);

        return {
          serviceId: service.id,
          serviceNameSnapshot: service.name,
          unitPriceSnapshot: unitPrice,
          quantity,
          lineTotal,
        };
      });

      // Calculate subtotal
      const subtotal = invoiceItemsData.reduce((sum, i) => sum.add(i.lineTotal), new Decimal(0)).toDecimalPlaces(2);
      
      // Calculate additional charges
      const additionalChargesData = (createReplacementDto.additionalCharges || []).map(charge => {
        const chargeValue = new Decimal(charge.chargeValue);
        let calculatedAmount: Decimal;
        
        if (charge.chargeType === 'PERCENTAGE') {
          calculatedAmount = subtotal.mul(chargeValue.div(100)).toDecimalPlaces(2);
        } else {
          calculatedAmount = chargeValue.toDecimalPlaces(2);
        }
        
        return {
          chargeType: charge.chargeType,
          chargeValue: chargeValue,
          calculatedAmount: calculatedAmount,
          description: charge.description,
        };
      });

      // Calculate total
      const totalCharges = additionalChargesData.reduce((sum, charge) => sum.add(charge.calculatedAmount), new Decimal(0)).toDecimalPlaces(2);
      const total = subtotal.add(totalCharges).toDecimalPlaces(2);
      
      // A predecessor invoice may have:
      // 1. Payment allocations from earlier invoices it replaced
      // 2. Direct payments recorded directly on it
      // Both represent valid payment credits that must carry over to the replacement.
      const sourceAllocations = await tx.paymentAllocation.findMany({
        where: { invoiceId: originalInvoiceId },
        orderBy: { createdAt: 'asc' },
        include: {
          payment: {
            select: { id: true, amount: true, status: true },
          },
        },
      });

      const allocatedCredits = sourceAllocations
        .filter(allocation => allocation.payment.status === 'RECORDED')
        .map(allocation => ({
          paymentId: allocation.paymentId,
          amount: allocation.amount,
        }));

      const directPayments = await tx.payment.findMany({
        where: { invoiceId: originalInvoiceId, status: 'RECORDED' },
        orderBy: [{ paymentDate: 'asc' }, { id: 'asc' }],
        select: { id: true, amount: true },
      });

      const directCredits = directPayments.map((payment) => ({
        paymentId: payment.id,
        amount: payment.amount,
      }));

      const sourceCredits = [...allocatedCredits, ...directCredits];

      // A successor may be cheaper than its predecessor. Allocate credit in
      // order, capped at this replacement's total, so remaining can never be
      // negative and no payment can create phantom credit on this invoice.
      let allocatable = total;
      const validAllocations = sourceCredits.flatMap((credit) => {
        const amount = Decimal.min(credit.amount, allocatable).toDecimalPlaces(2);
        allocatable = allocatable.sub(amount);
        return amount.gt(0) ? [{ paymentId: credit.paymentId, amount }] : [];
      });
      
      // Calculate the total credit from allocations
      const replacementPaid = validAllocations.reduce((sum, allocation) => sum.add(allocation.amount), new Decimal(0)).toDecimalPlaces(2);
      const replacementRemaining = total.sub(replacementPaid).toDecimalPlaces(2);
      
      // Determine payment status based on remaining balance
      let replacementPaymentStatus: InvoicePaymentStatus = 'UNPAID';
      if (replacementRemaining.equals(0)) {
        replacementPaymentStatus = 'PAID';
      } else if (replacementRemaining.lessThan(total)) {
        replacementPaymentStatus = 'PARTIALLY_PAID';
      }
      
      // Check if an optional payment method was provided for remaining balance
      const needsAdditionalPayment = replacementRemaining.gt(0);
      const additionalPaymentMethod = createReplacementDto.paymentMethod;

      if (needsAdditionalPayment && additionalPaymentMethod) {
        // Validate payment method
        const validPaymentMethods = ['KNET', 'LINK', 'OTHER'];
        if (!validPaymentMethods.includes(additionalPaymentMethod)) {
          throw new BadRequestException('Invalid payment method. Only KNET, LINK, and OTHER are allowed.');
        }
      }
      
      // Replacement invoices start as DRAFT with temporary number
      const replacementInvoiceNumber = `DRAFT-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

      // Create payment allocations for the replacement invoice
      const allocationData = validAllocations.map(allocation => ({
        paymentId: allocation.paymentId,
        amount: allocation.amount,
      }));

      // Release the active-invoice constraint before creating the replacement.
      // The surrounding transaction rolls this back if replacement creation fails.
      await tx.invoice.update({
        where: { id: originalInvoiceId },
        data: {
          status: 'VOID',
        },
      });

      // Create replacement invoice
      const replacementInvoice = await tx.invoice.create({
        data: {
          invoiceNumber: replacementInvoiceNumber,
          visitId: visit.id,
          patientId: visit.patientId,
          status: 'DRAFT', // Start as draft, can be issued later
          subtotal,
          total,
          paid: replacementPaid,
          remaining: replacementRemaining,
          paymentStatus: replacementPaymentStatus,
          createdById: userId,
          invoiceItems: {
            create: invoiceItemsData,
          },
          additionalCharges: {
            create: additionalChargesData,
          },
          paymentAllocations: allocationData.length > 0 ? {
            create: allocationData,
          } : undefined,
        },
        include: INVOICE_ITEM_INCLUDE,
      });

      // If there's a remaining balance, create payment directly on the replacement invoice
      if (needsAdditionalPayment && additionalPaymentMethod) {
        const balancePayment = await tx.payment.create({
          data: {
            invoiceId: replacementInvoice.id,
            amount: replacementRemaining,
            method: additionalPaymentMethod,
            status: 'RECORDED',
            paymentDate: new Date(),
            recordedById: userId,
          },
        });

        // Update replacement invoice to fully paid
        await tx.invoice.update({
          where: { id: replacementInvoice.id },
          data: {
            paid: total,
            remaining: new Decimal(0),
            paymentStatus: 'PAID',
          },
        });

        // Audit log for the payment
        await tx.auditLog.create({
          data: {
            userId,
            action: 'CREATE',
            entityType: 'Payment',
            entityId: balancePayment.id,
            beforeState: null,
            afterState: {
              invoiceId: replacementInvoice.id,
              amount: replacementRemaining,
              method: additionalPaymentMethod,
              status: 'RECORDED',
              context: 'Replacement balance payment',
            },
            ipAddress,
            userAgent,
          },
        });
      }

      // Mark original invoice as VOID and link to replacement
      await tx.invoice.update({
        where: { id: originalInvoiceId },
        data: {
          replacedByInvoiceId: replacementInvoice.id,
        },
      });

      // Audit log for original invoice void - use transaction client
      await tx.auditLog.create({
        data: {
          userId,
          action: 'INVOICE_REPLACED',
          entityType: 'Invoice',
          entityId: originalInvoiceId,
          beforeState: { 
            status: originalInvoice.status, 
            invoiceNumber: originalInvoice.invoiceNumber,
            total: originalInvoice.total.toString(),
          },
          afterState: { 
            status: 'VOID', 
            replacedByInvoiceId: replacementInvoice.id,
            replacementInvoiceNumber: replacementInvoice.invoiceNumber,
          },
          ipAddress,
          userAgent,
        },
      });

      // Audit log for replacement creation - use transaction client
      await tx.auditLog.create({
        data: {
          userId,
          action: 'CREATE',
          entityType: 'Invoice',
          entityId: replacementInvoice.id,
          beforeState: null,
          afterState: {
            invoiceNumber: replacementInvoice.invoiceNumber,
            visitId: replacementInvoice.visitId,
            patientId: replacementInvoice.patientId,
            total: replacementInvoice.total,
            status: replacementInvoice.status,
            replacesInvoiceId: originalInvoiceId,
          },
          ipAddress,
          userAgent,
        },
      });

      return replacementInvoice;
    });
  }
}
