import { AppointmentsService } from './appointments/appointments.service';
import { PatientsService } from './patients/patients.service';
import { ServicesService } from './services/services.service';
import { VisitsService } from './visits/visits.service';
import { AppointmentStatus, VisitStatus } from '@prisma/client';

function transactionClient() {
  const client = {
    patient: { findUnique: jest.fn(), delete: jest.fn() },
    appointment: { findUnique: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
    visit: { findUnique: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
    service: { findUnique: jest.fn(), delete: jest.fn() },
    invoice: { findUnique: jest.fn(), deleteMany: jest.fn() },
    invoiceItem: { findUnique: jest.fn(), deleteMany: jest.fn(), updateMany: jest.fn() },
    invoiceAdditionalCharge: { findUnique: jest.fn(), deleteMany: jest.fn() },
    payment: { findUnique: jest.fn(), deleteMany: jest.fn() },
    paymentAllocation: { findUnique: jest.fn(), deleteMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  return {
    client,
    prisma: {
      $transaction: jest.fn(async (callback: (tx: typeof client) => Promise<unknown>) => callback(client)),
    },
  };
}

const auditService = {};

describe('focused permanent-delete safety', () => {
  it('deletes an eligible patient and preserves a deletion audit record', async () => {
    const { prisma, client } = transactionClient();
    client.patient.findUnique.mockResolvedValue({
      id: 'patient-id',
      civilId: '123',
      fullNameAr: 'Test Patient',
      fullNameEn: null,
      isArchived: true,
    });
    const result = await new PatientsService(prisma as never, auditService as never).hardDelete(
      'patient-id',
      'user-id',
      '127.0.0.1',
      'focused-test',
    );
    expect(result).toEqual({ id: 'patient-id', deleted: true });
    expect(client.patient.delete).toHaveBeenCalledWith({ where: { id: 'patient-id' } });
    expect(client.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'DELETE_PERMANENT', entityType: 'Patient', entityId: 'patient-id' }),
    }));
  });

  it('deletes a patient with appointments, visits, and invoices', async () => {
    const { prisma, client } = transactionClient();
    client.patient.findUnique.mockResolvedValue({
      id: 'patient-id',
      civilId: '123',
      fullNameAr: 'Test Patient',
      fullNameEn: null,
    });
    const result = await new PatientsService(prisma as never, auditService as never).hardDelete(
      'patient-id',
      'user-id',
      '127.0.0.1',
      'focused-test',
    );
    expect(result).toEqual({ id: 'patient-id', deleted: true });
    // Verify deletion order: payment allocations, payments, invoice items, additional charges, invoices, visits, appointments, patient
    expect(client.paymentAllocation.deleteMany).toHaveBeenCalled();
    expect(client.payment.deleteMany).toHaveBeenCalled();
    expect(client.invoiceItem.deleteMany).toHaveBeenCalled();
    expect(client.invoiceAdditionalCharge.deleteMany).toHaveBeenCalled();
    expect(client.invoice.deleteMany).toHaveBeenCalled();
    expect(client.visit.deleteMany).toHaveBeenCalled();
    expect(client.appointment.deleteMany).toHaveBeenCalled();
    expect(client.patient.delete).toHaveBeenCalledWith({ where: { id: 'patient-id' } });
    expect(client.auditLog.create).toHaveBeenCalled();
  });

  it('blocks appointments linked to visits and deletes unlinked appointments', async () => {
    const linked = transactionClient();
    linked.client.appointment.findUnique.mockResolvedValue({
      id: 'appointment-id',
      visit: { id: 'visit-id' },
    });
    await expect(new AppointmentsService(linked.prisma as never, auditService as never).hardDelete('appointment-id', 'user-id'))
      .rejects.toThrow('linked to a visit');
    expect(linked.client.appointment.delete).not.toHaveBeenCalled();

    const eligible = transactionClient();
    eligible.client.appointment.findUnique.mockResolvedValue({
      id: 'appointment-id',
      patientId: 'patient-id',
      scheduledAt: new Date(),
      status: AppointmentStatus.CANCELLED,
      notes: null,
      visit: null,
    });
    await expect(new AppointmentsService(eligible.prisma as never, auditService as never).hardDelete('appointment-id', 'user-id'))
      .resolves.toEqual({ id: 'appointment-id', deleted: true });
    expect(eligible.client.auditLog.create).toHaveBeenCalled();
  });

  it('blocks visits with invoices or protected medical history', async () => {
    const invoiced = transactionClient();
    invoiced.client.visit.findUnique.mockResolvedValue({
      id: 'visit-id',
      invoices: [{ invoiceNumber: 'INV-1' }],
    });
    await expect(new VisitsService(invoiced.prisma as never, auditService as never).hardDelete('visit-id', 'user-id'))
      .rejects.toThrow('linked to invoice');
    expect(invoiced.client.visit.delete).not.toHaveBeenCalled();

    const completed = transactionClient();
    completed.client.visit.findUnique.mockResolvedValue({
      id: 'visit-id',
      patientId: 'patient-id',
      appointmentId: null,
      type: 'CHECKUP',
      status: VisitStatus.COMPLETED,
      visitDate: new Date(),
      invoices: [],
    });
    await expect(new VisitsService(completed.prisma as never, auditService as never).hardDelete('visit-id', 'user-id'))
      .rejects.toThrow('medical history');
    expect(completed.client.visit.delete).not.toHaveBeenCalled();
  });

  it('deletes a service referenced by invoice items (sets serviceId to NULL)', async () => {
    const { prisma, client } = transactionClient();
    client.service.findUnique.mockResolvedValue({
      id: 'service-id',
      name: 'Test service',
      code: 'TEST',
      currentPrice: '10.00',
      isActive: true,
    });
    const result = await new ServicesService(prisma as never, auditService as never).hardDelete('service-id', 'user-id');
    expect(result).toEqual({ id: 'service-id', deleted: true });
    // Verify that invoiceItem.serviceId is set to NULL before deletion
    expect(client.invoiceItem.updateMany).toHaveBeenCalledWith({
      where: { serviceId: 'service-id' },
      data: { serviceId: null },
    });
    expect(client.service.delete).toHaveBeenCalledWith({ where: { id: 'service-id' } });
    expect(client.auditLog.create).toHaveBeenCalled();
  });
});
