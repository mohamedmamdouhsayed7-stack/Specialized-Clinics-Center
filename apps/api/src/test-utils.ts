import { PrismaService } from './database/prisma.service';

/**
 * Shared test cleanup utility to delete all test data in the correct order
 * to respect foreign key constraints. This should be called in beforeAll
 * and afterAll of each test suite to ensure proper isolation.
 *
 * All deletions are scoped to records created by or associated with test users
 * matching the email pattern. This ensures cleanup from one test suite does not
 * affect data from other suites or non-test data.
 *
 * @param emailPattern - Optional email pattern to limit cleanup to specific test users.
 *                          If not provided, cleans up all users with '@test.com' in email.
 */
export async function cleanupTestData(prisma: PrismaService, emailPattern?: string) {
  // Step 1: Find test users matching the pattern
  const testUsers = await prisma.user.findMany({
    where: { email: { contains: emailPattern || '@test.com' } },
    select: { id: true },
  });
  const testUserIds = testUsers.map(u => u.id);

  if (testUserIds.length === 0) {
    return; // No test users to clean up
  }

  // Step 2: Find all patients created by these test users
  const testPatients = await prisma.patient.findMany({
    where: { createdById: { in: testUserIds } },
    select: { id: true },
  });
  const testPatientIds = testPatients.map(p => p.id);

  // Step 3: Find all appointments for these patients
  const testAppointments = await prisma.appointment.findMany({
    where: { patientId: { in: testPatientIds } },
    select: { id: true },
  });
  const testAppointmentIds = testAppointments.map(a => a.id);

  // Step 4: Find all visits for these patients
  const testVisits = await prisma.visit.findMany({
    where: { patientId: { in: testPatientIds } },
    select: { id: true },
  });
  const testVisitIds = testVisits.map(v => v.id);

  // Step 5: Find all invoices for these visits/patients (and created by test users)
  const testInvoices = await prisma.invoice.findMany({
    where: {
      OR: [
        { visitId: { in: testVisitIds } },
        { patientId: { in: testPatientIds } },
        { createdById: { in: testUserIds } },
        { issuedById: { in: testUserIds } },
      ],
    },
    select: { id: true },
  });
  const testInvoiceIds = testInvoices.map(i => i.id);

  // Step 6: Find all payments for these invoices (and recorded by test users)
  const testPayments = await prisma.payment.findMany({
    where: {
      OR: [
        { invoiceId: { in: testInvoiceIds } },
        { recordedById: { in: testUserIds } },
      ],
    },
    select: { id: true },
  });
  const testPaymentIds = testPayments.map(p => p.id);

  // Step 7: Find all services created by test users
  const testServices = await prisma.service.findMany({
    where: { createdById: { in: testUserIds } },
    select: { id: true },
  });
  const testServiceIds = testServices.map(s => s.id);

  // Now delete in FK-safe order (child tables first)

  // PaymentAllocation depends on Payment and Invoice
  if (testPaymentIds.length > 0 || testInvoiceIds.length > 0) {
    await prisma.paymentAllocation.deleteMany({
      where: {
        OR: [
          { paymentId: { in: testPaymentIds } },
          { invoiceId: { in: testInvoiceIds } },
        ],
      },
    });
  }

  // Payment depends on Invoice (RESTRICT FK)
  if (testPaymentIds.length > 0) {
    await prisma.payment.deleteMany({
      where: { id: { in: testPaymentIds } },
    });
  }

  // InvoiceAdditionalCharge depends on Invoice
  if (testInvoiceIds.length > 0) {
    await prisma.invoiceAdditionalCharge.deleteMany({
      where: { invoiceId: { in: testInvoiceIds } },
    });
  }

  // InvoiceItem depends on Invoice and Service
  if (testInvoiceIds.length > 0 || testServiceIds.length > 0) {
    await prisma.invoiceItem.deleteMany({
      where: {
        OR: [
          { invoiceId: { in: testInvoiceIds } },
          { serviceId: { in: testServiceIds } },
        ],
      },
    });
  }

  // Invoice depends on Visit and Patient (both have RESTRICT FK)
  if (testInvoiceIds.length > 0) {
    await prisma.invoice.deleteMany({
      where: { id: { in: testInvoiceIds } },
    });
  }

  // Visit depends on Patient and User
  if (testVisitIds.length > 0) {
    await prisma.visit.deleteMany({
      where: { id: { in: testVisitIds } },
    });
  }

  // Appointment depends on Patient
  if (testAppointmentIds.length > 0) {
    await prisma.appointment.deleteMany({
      where: { id: { in: testAppointmentIds } },
    });
  }

  // Patient depends on User
  if (testPatientIds.length > 0) {
    await prisma.patient.deleteMany({
      where: { id: { in: testPatientIds } },
    });
  }

  // Service depends on User
  if (testServiceIds.length > 0) {
    await prisma.service.deleteMany({
      where: { id: { in: testServiceIds } },
    });
  }

  // RefreshToken depends on User
  await prisma.refreshToken.deleteMany({
    where: { userId: { in: testUserIds } },
  });

  // AuditLog depends on User
  await prisma.auditLog.deleteMany({
    where: { userId: { in: testUserIds } },
  });

  // Finally delete test users
  await prisma.user.deleteMany({
    where: { id: { in: testUserIds } },
  });
}

/**
 * Extended cleanup for reports that includes test patients by civilId
 * This is needed because reports test creates a patient with a specific civilId
 * that may not be traceable through createdById in all scenarios.
 *
 * @param emailPattern - Optional email pattern to limit cleanup to specific test users.
 */
export async function cleanupReportsTestData(prisma: PrismaService, emailPattern?: string) {
  // Step 1: Find test users matching the pattern
  const testUsers = await prisma.user.findMany({
    where: { email: { contains: emailPattern || '@test.com' } },
    select: { id: true },
  });
  const testUserIds = testUsers.map(u => u.id);

  if (testUserIds.length === 0) {
    return; // No test users to clean up
  }

  // Step 2: Find all patients created by these test users OR with the test civilId
  const testPatients = await prisma.patient.findMany({
    where: {
      OR: [
        { createdById: { in: testUserIds } },
        { civilId: '10000000' },
      ],
    },
    select: { id: true },
  });
  const testPatientIds = testPatients.map(p => p.id);

  // Step 3: Find all appointments for these patients
  const testAppointments = await prisma.appointment.findMany({
    where: { patientId: { in: testPatientIds } },
    select: { id: true },
  });
  const testAppointmentIds = testAppointments.map(a => a.id);

  // Step 4: Find all visits for these patients
  const testVisits = await prisma.visit.findMany({
    where: { patientId: { in: testPatientIds } },
    select: { id: true },
  });
  const testVisitIds = testVisits.map(v => v.id);

  // Step 5: Find all invoices for these visits/patients (and created by test users)
  const testInvoices = await prisma.invoice.findMany({
    where: {
      OR: [
        { visitId: { in: testVisitIds } },
        { patientId: { in: testPatientIds } },
        { createdById: { in: testUserIds } },
        { issuedById: { in: testUserIds } },
      ],
    },
    select: { id: true },
  });
  const testInvoiceIds = testInvoices.map(i => i.id);

  // Step 6: Find all payments for these invoices (and recorded by test users)
  const testPayments = await prisma.payment.findMany({
    where: {
      OR: [
        { invoiceId: { in: testInvoiceIds } },
        { recordedById: { in: testUserIds } },
      ],
    },
    select: { id: true },
  });
  const testPaymentIds = testPayments.map(p => p.id);

  // Step 7: Find all services created by test users
  const testServices = await prisma.service.findMany({
    where: { createdById: { in: testUserIds } },
    select: { id: true },
  });
  const testServiceIds = testServices.map(s => s.id);

  // Now delete in FK-safe order (child tables first)

  // PaymentAllocation depends on Payment and Invoice
  if (testPaymentIds.length > 0 || testInvoiceIds.length > 0) {
    await prisma.paymentAllocation.deleteMany({
      where: {
        OR: [
          { paymentId: { in: testPaymentIds } },
          { invoiceId: { in: testInvoiceIds } },
        ],
      },
    });
  }

  // Payment depends on Invoice (RESTRICT FK)
  if (testPaymentIds.length > 0) {
    await prisma.payment.deleteMany({
      where: { id: { in: testPaymentIds } },
    });
  }

  // InvoiceAdditionalCharge depends on Invoice
  if (testInvoiceIds.length > 0) {
    await prisma.invoiceAdditionalCharge.deleteMany({
      where: { invoiceId: { in: testInvoiceIds } },
    });
  }

  // InvoiceItem depends on Invoice and Service
  if (testInvoiceIds.length > 0 || testServiceIds.length > 0) {
    await prisma.invoiceItem.deleteMany({
      where: {
        OR: [
          { invoiceId: { in: testInvoiceIds } },
          { serviceId: { in: testServiceIds } },
        ],
      },
    });
  }

  // Invoice depends on Visit and Patient (both have RESTRICT FK)
  if (testInvoiceIds.length > 0) {
    await prisma.invoice.deleteMany({
      where: { id: { in: testInvoiceIds } },
    });
  }

  // Visit depends on Patient and User
  if (testVisitIds.length > 0) {
    await prisma.visit.deleteMany({
      where: { id: { in: testVisitIds } },
    });
  }

  // Appointment depends on Patient
  if (testAppointmentIds.length > 0) {
    await prisma.appointment.deleteMany({
      where: { id: { in: testAppointmentIds } },
    });
  }

  // Patient depends on User
  if (testPatientIds.length > 0) {
    await prisma.patient.deleteMany({
      where: { id: { in: testPatientIds } },
    });
  }

  // Service depends on User
  if (testServiceIds.length > 0) {
    await prisma.service.deleteMany({
      where: { id: { in: testServiceIds } },
    });
  }

  // RefreshToken depends on User
  await prisma.refreshToken.deleteMany({
    where: { userId: { in: testUserIds } },
  });

  // AuditLog depends on User
  await prisma.auditLog.deleteMany({
    where: { userId: { in: testUserIds } },
  });

  // Finally delete test users
  await prisma.user.deleteMany({
    where: { id: { in: testUserIds } },
  });
}
