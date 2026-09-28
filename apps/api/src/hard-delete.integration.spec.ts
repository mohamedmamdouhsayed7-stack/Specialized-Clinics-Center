import { randomUUID } from 'crypto';
import { PrismaClient, UserRole, AppointmentStatus, VisitStatus, VisitType } from '@prisma/client';
import { AppointmentsService } from './appointments/appointments.service';
import { InvoicesService } from './invoices/invoices.service';
import { PatientsService } from './patients/patients.service';
import { ServicesService } from './services/services.service';
import { VisitsService } from './visits/visits.service';

jest.setTimeout(30000);

describe('permanent delete relations (disposable PostgreSQL)', () => {
  const prisma = new PrismaClient();
  const auditService = { log: jest.fn(), logUserAction: jest.fn() };
  const patientIds: string[] = [];
  const serviceIds: string[] = [];
  let userId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        email: `hard-delete-${randomUUID()}@example.test`,
        passwordHash: 'integration-test-hash',
        name: 'Hard Delete Test Admin',
        role: UserRole.ADMIN,
      },
      select: { id: true },
    });
    userId = user.id;
  });

  afterEach(async () => {
    for (const patientId of patientIds.splice(0)) {
      const invoices = await prisma.invoice.findMany({
        where: { OR: [{ patientId }, { visit: { patientId } }] },
        select: { id: true },
      });
      const invoiceIds = invoices.map(({ id }) => id);
      const payments = invoiceIds.length
        ? await prisma.payment.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { id: true } })
        : [];
      const paymentIds = payments.map(({ id }) => id);
      await prisma.paymentAllocation.deleteMany({
        where: { OR: [{ invoiceId: { in: invoiceIds } }, { paymentId: { in: paymentIds } }] },
      });
      await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoiceAdditionalCharge.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      await prisma.visit.deleteMany({ where: { patientId } });
      await prisma.appointment.deleteMany({ where: { patientId } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
    }
    if (userId) await prisma.auditLog.deleteMany({ where: { userId } });
    for (const serviceId of serviceIds.splice(0)) {
      await prisma.invoiceItem.updateMany({ where: { serviceId }, data: { serviceId: null } });
      await prisma.service.deleteMany({ where: { id: serviceId } });
    }
  });

  afterAll(async () => {
    if (userId) {
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  async function createPatient() {
    const patient = await prisma.patient.create({ data: { fullNameAr: `Delete test ${randomUUID()}` } });
    patientIds.push(patient.id);
    return patient;
  }

  async function createVisit(patientId: string, status: VisitStatus = VisitStatus.CANCELLED, appointmentId?: string) {
    return prisma.visit.create({
      data: { patientId, appointmentId, type: VisitType.OTHER, status, visitDate: new Date() },
    });
  }

  async function createInvoice(patientId: string, visitId: string, invoiceNumber = `DEL-${randomUUID()}`) {
    return prisma.invoice.create({
      data: {
        invoiceNumber,
        patientId,
        visitId,
        status: 'DRAFT',
        subtotal: 100,
        total: 100,
        paid: 0,
        remaining: 100,
        paymentStatus: 'UNPAID',
      },
    });
  }

  it('deletes a patient aggregate with appointments, visits, invoice children, and payments atomically', async () => {
    const patient = await createPatient();
    const appointment = await prisma.appointment.create({
      data: { patientId: patient.id, scheduledAt: new Date('2026-09-28T07:00:00.000Z'), status: AppointmentStatus.BOOKED },
    });
    const visit = await createVisit(patient.id, VisitStatus.CANCELLED, appointment.id);
    const invoice = await createInvoice(patient.id, visit.id);
    const relatedVisit = await createVisit(patient.id);
    const relatedInvoice = await createInvoice(patient.id, relatedVisit.id);
    await prisma.invoiceItem.create({
      data: { invoiceId: invoice.id, serviceNameSnapshot: 'Snapshot', unitPriceSnapshot: 10, quantity: 1, lineTotal: 10 },
    });
    await prisma.invoiceAdditionalCharge.create({
      data: { invoiceId: invoice.id, chargeType: 'FIXED', chargeValue: 2, calculatedAmount: 2 },
    });
    const payment = await prisma.payment.create({ data: { invoiceId: invoice.id, amount: 10, method: 'CASH' } });
    await prisma.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId: relatedInvoice.id, amount: 5 } });

    await expect(new PatientsService(prisma as never, auditService as never).hardDelete(patient.id, userId))
      .resolves.toEqual({ id: patient.id, deleted: true });

    expect(await prisma.patient.findUnique({ where: { id: patient.id } })).toBeNull();
    expect(await prisma.appointment.findUnique({ where: { id: appointment.id } })).toBeNull();
    expect(await prisma.visit.findUnique({ where: { id: visit.id } })).toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).toBeNull();
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    expect(await prisma.paymentAllocation.count({ where: { paymentId: payment.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { userId, entityId: patient.id, action: 'DELETE_PERMANENT' } })).toBe(1);
  });

  it('rolls the complete patient deletion back if audit persistence fails', async () => {
    const patient = await createPatient();
    const appointment = await prisma.appointment.create({
      data: { patientId: patient.id, scheduledAt: new Date(), status: AppointmentStatus.CANCELLED },
    });
    const visit = await createVisit(patient.id);
    const invoice = await createInvoice(patient.id, visit.id);
    await prisma.payment.create({ data: { invoiceId: invoice.id, amount: 10, method: 'CASH' } });

    await expect(new PatientsService(prisma as never, auditService as never).hardDelete(patient.id, randomUUID()))
      .rejects.toThrow('related business records still depend on it');

    expect(await prisma.patient.findUnique({ where: { id: patient.id } })).not.toBeNull();
    expect(await prisma.appointment.findUnique({ where: { id: appointment.id } })).not.toBeNull();
    expect(await prisma.visit.findUnique({ where: { id: visit.id } })).not.toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).not.toBeNull();
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });

  it('deletes allocations touching the target tree while preserving external payments and invoices', async () => {
    const sourcePatient = await createPatient();
    const targetPatient = await createPatient();
    const sourceVisit = await createVisit(sourcePatient.id);
    const targetVisit = await createVisit(targetPatient.id);
    const sourceInvoice = await createInvoice(sourcePatient.id, sourceVisit.id);
    const targetInvoice = await createInvoice(targetPatient.id, targetVisit.id);
    const payment = await prisma.payment.create({ data: { invoiceId: sourceInvoice.id, amount: 20, method: 'CASH' } });
    const allocation = await prisma.paymentAllocation.create({
      data: { paymentId: payment.id, invoiceId: targetInvoice.id, amount: 20 },
    });

    await expect(new PatientsService(prisma as never, auditService as never).hardDelete(targetPatient.id, userId))
      .resolves.toEqual({ id: targetPatient.id, deleted: true });

    expect(await prisma.paymentAllocation.findUnique({ where: { id: allocation.id } })).toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: sourceInvoice.id } })).not.toBeNull();
    expect(await prisma.payment.findUnique({ where: { id: payment.id } })).not.toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: targetInvoice.id } })).toBeNull();
  });

  it('deletes one invoice replacement and allocation tree without deleting external financial records', async () => {
    const patient = await createPatient();
    const externalPatient = await createPatient();
    const visit = await createVisit(patient.id);
    const externalVisit = await createVisit(externalPatient.id);
    const invoice = await createInvoice(patient.id, visit.id);
    const externalInvoice = await createInvoice(externalPatient.id, externalVisit.id);
    const ownedPayment = await prisma.payment.create({ data: { invoiceId: invoice.id, amount: 20, method: 'CASH' } });
    const externalPayment = await prisma.payment.create({ data: { invoiceId: externalInvoice.id, amount: 20, method: 'CASH' } });
    const ownedAllocation = await prisma.paymentAllocation.create({
      data: { paymentId: ownedPayment.id, invoiceId: externalInvoice.id, amount: 10 },
    });
    const incomingAllocation = await prisma.paymentAllocation.create({
      data: { paymentId: externalPayment.id, invoiceId: invoice.id, amount: 10 },
    });
    await prisma.invoice.update({ where: { id: externalInvoice.id }, data: { replacedByInvoiceId: invoice.id } });

    await expect(new InvoicesService(prisma as never, auditService as never).hardDelete(invoice.id, userId, UserRole.ADMIN))
      .resolves.toEqual({ id: invoice.id, deleted: true });

    expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).toBeNull();
    expect(await prisma.payment.findUnique({ where: { id: ownedPayment.id } })).toBeNull();
    expect(await prisma.paymentAllocation.findUnique({ where: { id: ownedAllocation.id } })).toBeNull();
    expect(await prisma.paymentAllocation.findUnique({ where: { id: incomingAllocation.id } })).toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: externalInvoice.id } })).toMatchObject({ replacedByInvoiceId: null });
    expect(await prisma.payment.findUnique({ where: { id: externalPayment.id } })).not.toBeNull();
  });

  it('deletes in-scope replacements and clears external replacement references without deleting external invoices', async () => {
    const patient = await createPatient();
    const otherPatient = await createPatient();
    const firstVisit = await createVisit(patient.id);
    const replacementVisit = await createVisit(patient.id);
    const externalVisit = await createVisit(otherPatient.id);
    const originalInvoice = await createInvoice(patient.id, firstVisit.id);
    const replacementInvoice = await createInvoice(patient.id, replacementVisit.id);
    const externalInvoice = await createInvoice(otherPatient.id, externalVisit.id);
    await prisma.invoice.update({
      where: { id: originalInvoice.id },
      data: { replacedByInvoiceId: replacementInvoice.id },
    });
    await prisma.invoice.update({
      where: { id: externalInvoice.id },
      data: { replacedByInvoiceId: originalInvoice.id },
    });

    await expect(new PatientsService(prisma as never, auditService as never).hardDelete(patient.id, userId))
      .resolves.toEqual({ id: patient.id, deleted: true });
    expect(await prisma.patient.findUnique({ where: { id: patient.id } })).toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: originalInvoice.id } })).toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: replacementInvoice.id } })).toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: externalInvoice.id } })).toMatchObject({ replacedByInvoiceId: null });
  });

  it('deletes completed and in-progress patient history with the full related tree', async () => {
    const patient = await createPatient();
    const appointment = await prisma.appointment.create({
      data: { patientId: patient.id, scheduledAt: new Date(), status: AppointmentStatus.DONE },
    });
    const completedVisit = await createVisit(patient.id, VisitStatus.COMPLETED, appointment.id);
    const inProgressVisit = await createVisit(patient.id, VisitStatus.IN_PROGRESS);
    const invoice = await createInvoice(patient.id, completedVisit.id);
    const payment = await prisma.payment.create({ data: { invoiceId: invoice.id, amount: 20, method: 'CASH' } });

    await expect(new PatientsService(prisma as never, auditService as never).hardDelete(patient.id, userId))
      .resolves.toEqual({ id: patient.id, deleted: true });
    expect(await prisma.patient.findUnique({ where: { id: patient.id } })).toBeNull();
    expect(await prisma.appointment.findUnique({ where: { id: appointment.id } })).toBeNull();
    expect(await prisma.visit.findUnique({ where: { id: completedVisit.id } })).toBeNull();
    expect(await prisma.visit.findUnique({ where: { id: inProgressVisit.id } })).toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).toBeNull();
    expect(await prisma.payment.findUnique({ where: { id: payment.id } })).toBeNull();
  });

  it('cascades appointment and visit deletes through invoices and payments regardless of visit status', async () => {
    const patient = await createPatient();
    const eligibleVisit = await createVisit(patient.id);
    const linkedAppointment = await prisma.appointment.create({
      data: { patientId: patient.id, scheduledAt: new Date(), status: AppointmentStatus.CANCELLED },
    });
    const unlinkedAppointment = await prisma.appointment.create({
      data: { patientId: patient.id, scheduledAt: new Date(), status: AppointmentStatus.CANCELLED },
    });
    const linkedVisit = await createVisit(patient.id, VisitStatus.CANCELLED, linkedAppointment.id);
    const completedVisit = await createVisit(patient.id, VisitStatus.COMPLETED);
    const invoicedVisit = await createVisit(patient.id);
    const protectedInvoice = await createInvoice(patient.id, invoicedVisit.id);
    const linkedInvoice = await createInvoice(patient.id, linkedVisit.id);
    const payment = await prisma.payment.create({ data: { invoiceId: linkedInvoice.id, amount: 10, method: 'CASH' } });

    await expect(new VisitsService(prisma as never, auditService as never).hardDelete(eligibleVisit.id, userId))
      .resolves.toEqual({ id: eligibleVisit.id, deleted: true });
    await expect(new AppointmentsService(prisma as never, auditService as never).hardDelete(unlinkedAppointment.id, userId))
      .resolves.toEqual({ id: unlinkedAppointment.id, deleted: true });
    await expect(new AppointmentsService(prisma as never, auditService as never).hardDelete(linkedAppointment.id, userId))
      .resolves.toEqual({ id: linkedAppointment.id, deleted: true });
    await expect(new VisitsService(prisma as never, auditService as never).hardDelete(completedVisit.id, userId))
      .resolves.toEqual({ id: completedVisit.id, deleted: true });
    await expect(new VisitsService(prisma as never, auditService as never).hardDelete(invoicedVisit.id, userId))
      .resolves.toEqual({ id: invoicedVisit.id, deleted: true });

    expect(await prisma.visit.findUnique({ where: { id: linkedVisit.id } })).toBeNull();
    expect(await prisma.appointment.findUnique({ where: { id: linkedAppointment.id } })).toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: linkedInvoice.id } })).toBeNull();
    expect(await prisma.payment.findUnique({ where: { id: payment.id } })).toBeNull();
    expect(await prisma.visit.findUnique({ where: { id: completedVisit.id } })).toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: protectedInvoice.id } })).toBeNull();
    expect(await prisma.visit.findUnique({ where: { id: invoicedVisit.id } })).toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: protectedInvoice.id } })).toBeNull();
  });

  it('deletes invoice dependencies, preserves historical service snapshots, and nulls service references', async () => {
    const patient = await createPatient();
    const visit = await createVisit(patient.id);
    const invoice = await createInvoice(patient.id, visit.id);
    const service = await prisma.service.create({ data: { name: 'Delete test service', currentPrice: 10 } });
    serviceIds.push(service.id);
    const item = await prisma.invoiceItem.create({
      data: {
        invoiceId: invoice.id,
        serviceId: service.id,
        serviceNameSnapshot: 'Historical snapshot',
        unitPriceSnapshot: 10,
        quantity: 1,
        lineTotal: 10,
      },
    });
    await prisma.payment.create({ data: { invoiceId: invoice.id, amount: 10, method: 'CASH' } });

    await new ServicesService(prisma as never, auditService as never).hardDelete(service.id, userId);
    expect(await prisma.invoiceItem.findUnique({ where: { id: item.id } })).toMatchObject({
      serviceId: null,
      serviceNameSnapshot: 'Historical snapshot',
    });

    await expect(new InvoicesService(prisma as never, auditService as never).hardDelete(
      invoice.id, userId, UserRole.ADMIN,
    )).resolves.toEqual({ id: invoice.id, deleted: true });
    expect(await prisma.invoiceItem.findUnique({ where: { id: item.id } })).toBeNull();
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it('allows different patients to share the same appointment instant', async () => {
    const firstPatient = await createPatient();
    const secondPatient = await createPatient();
    const scheduledAt = '2026-09-28T07:00:00.000Z';
    const appointments = new AppointmentsService(prisma as never, auditService as never);

    const first = await appointments.create({ patientId: firstPatient.id, scheduledAt }, userId);
    const second = await appointments.create({ patientId: secondPatient.id, scheduledAt }, userId);

    expect(first.scheduledAt.toISOString()).toBe(second.scheduledAt.toISOString());
    expect(await prisma.appointment.count({ where: { scheduledAt: new Date(scheduledAt) } })).toBe(2);
  });
});
