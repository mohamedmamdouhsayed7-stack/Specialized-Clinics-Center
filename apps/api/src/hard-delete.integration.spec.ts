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

  it('keeps cross-invoice payment allocations protected for patient and invoice deletes', async () => {
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
      .rejects.toThrow('payment allocation is linked to another invoice');
    await expect(new InvoicesService(prisma as never, auditService as never).hardDelete(
      targetInvoice.id, userId, UserRole.ADMIN,
    )).rejects.toThrow('payment allocation is linked to another invoice');

    expect(await prisma.paymentAllocation.findUnique({ where: { id: allocation.id } })).not.toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: sourceInvoice.id } })).not.toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: targetInvoice.id } })).not.toBeNull();
  });

  it('protects a patient whose invoices participate in a replacement relationship', async () => {
    const patient = await createPatient();
    const firstVisit = await createVisit(patient.id);
    const replacementVisit = await createVisit(patient.id);
    const originalInvoice = await createInvoice(patient.id, firstVisit.id);
    const replacementInvoice = await createInvoice(patient.id, replacementVisit.id);
    await prisma.invoice.update({
      where: { id: originalInvoice.id },
      data: { replacedByInvoiceId: replacementInvoice.id },
    });

    await expect(new PatientsService(prisma as never, auditService as never).hardDelete(patient.id, userId))
      .rejects.toThrow('replacement relationship');
    expect(await prisma.patient.findUnique({ where: { id: patient.id } })).not.toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: originalInvoice.id } })).not.toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: replacementInvoice.id } })).not.toBeNull();
  });

  it('protects completed patient medical history before deleting any dependent rows', async () => {
    const patient = await createPatient();
    const appointment = await prisma.appointment.create({
      data: { patientId: patient.id, scheduledAt: new Date(), status: AppointmentStatus.DONE },
    });
    const completedVisit = await createVisit(patient.id, VisitStatus.COMPLETED, appointment.id);

    await expect(new PatientsService(prisma as never, auditService as never).hardDelete(patient.id, userId))
      .rejects.toThrow('protected medical history');
    expect(await prisma.patient.findUnique({ where: { id: patient.id } })).not.toBeNull();
    expect(await prisma.appointment.findUnique({ where: { id: appointment.id } })).not.toBeNull();
    expect(await prisma.visit.findUnique({ where: { id: completedVisit.id } })).not.toBeNull();
  });

  it('deletes an eligible cancelled visit and unlinked appointment; protects linked and completed history', async () => {
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

    await expect(new VisitsService(prisma as never, auditService as never).hardDelete(eligibleVisit.id, userId))
      .resolves.toEqual({ id: eligibleVisit.id, deleted: true });
    await expect(new AppointmentsService(prisma as never, auditService as never).hardDelete(unlinkedAppointment.id, userId))
      .resolves.toEqual({ id: unlinkedAppointment.id, deleted: true });
    await expect(new AppointmentsService(prisma as never, auditService as never).hardDelete(linkedAppointment.id, userId))
      .rejects.toThrow('linked to a visit');
    await expect(new VisitsService(prisma as never, auditService as never).hardDelete(completedVisit.id, userId))
      .rejects.toThrow('medical history');
    await expect(new VisitsService(prisma as never, auditService as never).hardDelete(invoicedVisit.id, userId))
      .rejects.toThrow('linked to invoice');

    expect(await prisma.visit.findUnique({ where: { id: linkedVisit.id } })).not.toBeNull();
    expect(await prisma.appointment.findUnique({ where: { id: linkedAppointment.id } })).not.toBeNull();
    expect(await prisma.visit.findUnique({ where: { id: completedVisit.id } })).not.toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: protectedInvoice.id } })).not.toBeNull();
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
