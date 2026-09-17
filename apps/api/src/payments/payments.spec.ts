import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { cleanupTestData } from '../test-utils';

describe('Payments Module Tests (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminUserId: string;
  let testPatientId: string;
  let testServiceId: string;
  let draftInvoiceId: string;
  let issuedInvoiceId: string; // total 50, used across the payment flow tests
  let fullyPaidInvoiceId: string;
  let adminAccessToken: string;
  let receptionistAccessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Clean up test data using shared utility (scoped to payments test users)
    await cleanupTestData(prisma, '.payments@test.com');

    const adminPasswordHash = await argon2.hash('admin123');
    const admin = await prisma.user.create({
      data: {
        email: 'testadmin.payments@test.com',
        passwordHash: adminPasswordHash,
        name: 'Test Admin',
        role: 'ADMIN',
        isActive: true,
      },
    });
    adminUserId = admin.id;

    const receptionistPasswordHash = await argon2.hash('receptionist123');
    await prisma.user.create({
      data: {
        email: 'testreceptionist.payments@test.com',
        passwordHash: receptionistPasswordHash,
        name: 'Test Receptionist',
        role: 'RECEPTIONIST',
        isActive: true,
      },
    });

    const patient = await prisma.patient.create({
      data: {
        civilId: '98765432101',
        fullNameAr: 'منى خالد',
        phone: '99987654',
        createdById: adminUserId,
      },
    });
    testPatientId = patient.id;

    const service = await prisma.service.create({
      data: { name: 'Consultation', currentPrice: 50, isActive: true, createdById: adminUserId },
    });
    testServiceId = service.id;

    // A draft invoice (should reject payments)
    const draftVisit = await prisma.visit.create({
      data: { patientId: testPatientId, type: 'CHECKUP', createdById: adminUserId },
    });
    const draftInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: 'INV-TEST01',
        visitId: draftVisit.id,
        patientId: testPatientId,
        status: 'DRAFT',
        subtotal: 50,
        total: 50,
        paid: 0,
        remaining: 50,
        paymentStatus: 'UNPAID',
        createdById: adminUserId,
        invoiceItems: {
          create: [{ serviceId: testServiceId, serviceNameSnapshot: 'Consultation', unitPriceSnapshot: 50, quantity: 1, lineTotal: 50 }],
        },
      },
    });
    draftInvoiceId = draftInvoice.id;

    // An issued invoice with a 50 KD balance, used for the main payment flow
    const issuedVisit = await prisma.visit.create({
      data: { patientId: testPatientId, type: 'FOLLOW_UP', createdById: adminUserId },
    });
    const issuedInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: 'INV-TEST02',
        visitId: issuedVisit.id,
        patientId: testPatientId,
        status: 'ISSUED',
        subtotal: 50,
        total: 50,
        paid: 0,
        remaining: 50,
        paymentStatus: 'UNPAID',
        createdById: adminUserId,
        issuedAt: new Date(),
        issuedById: adminUserId,
        invoiceItems: {
          create: [{ serviceId: testServiceId, serviceNameSnapshot: 'Consultation', unitPriceSnapshot: 50, quantity: 1, lineTotal: 50 }],
        },
      },
    });
    issuedInvoiceId = issuedInvoice.id;

    // An already fully-paid invoice (should reject further payments)
    const paidVisit = await prisma.visit.create({
      data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
    });
    const paidInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: 'INV-TEST03',
        visitId: paidVisit.id,
        patientId: testPatientId,
        status: 'ISSUED',
        subtotal: 50,
        total: 50,
        paid: 50,
        remaining: 0,
        paymentStatus: 'PAID',
        createdById: adminUserId,
        issuedAt: new Date(),
        issuedById: adminUserId,
        invoiceItems: {
          create: [{ serviceId: testServiceId, serviceNameSnapshot: 'Consultation', unitPriceSnapshot: 50, quantity: 1, lineTotal: 50 }],
        },
      },
    });
    fullyPaidInvoiceId = paidInvoice.id;

    const adminResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'testadmin.payments@test.com', password: 'admin123' });
    adminAccessToken = adminResponse.body.accessToken;

    const receptionistResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'testreceptionist.payments@test.com', password: 'receptionist123' });
    receptionistAccessToken = receptionistResponse.body.accessToken;
  });

  afterAll(async () => {
    // Clean up test data using shared utility (scoped to payments test users)
    await cleanupTestData(prisma, '.payments@test.com');
    await app.close();
  });

  describe('Payment Creation', () => {
    it('should reject a payment on a draft invoice', async () => {
      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ invoiceId: draftInvoiceId, amount: 10, method: 'KNET' })
        .expect(400);
    });

    it('should reject a payment on an already fully-paid invoice', async () => {
      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ invoiceId: fullyPaidInvoiceId, amount: 10, method: 'KNET' })
        .expect(400);
    });

    it('should reject a payment for a non-existent invoice', async () => {
      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ invoiceId: '00000000-0000-0000-0000-000000000000', amount: 10, method: 'KNET' })
        .expect(404);
    });

    it('should reject a payment exceeding the remaining balance', async () => {
      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ invoiceId: issuedInvoiceId, amount: 999, method: 'KNET' })
        .expect(400);
    });

    it('should reject a zero or negative amount', async () => {
      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ invoiceId: issuedInvoiceId, amount: 0, method: 'KNET' })
        .expect(400);
    });

    it('should reject a payment with more than two decimal places', async () => {
      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ invoiceId: issuedInvoiceId, amount: 1.001, method: 'KNET' })
        .expect(400);
    });

    it('should reject an invalid payment method', async () => {
      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ invoiceId: issuedInvoiceId, amount: 10, method: 'BITCOIN' })
        .expect(400);
    });

    it('should record a partial payment and move the invoice to PARTIALLY_PAID', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ invoiceId: issuedInvoiceId, amount: 20, method: 'KNET' })
        .expect(201);

      expect(Number(response.body.amount)).toBe(20);
      expect(response.body.method).toBe('KNET');

      const invoice = await prisma.invoice.findUnique({ where: { id: issuedInvoiceId } });
      expect(Number(invoice.paid)).toBe(20);
      expect(Number(invoice.remaining)).toBe(30);
      expect(invoice.paymentStatus).toBe('PARTIALLY_PAID');
    });

    it('should record a payment as receptionist', async () => {
      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .send({ invoiceId: issuedInvoiceId, amount: 10, method: 'LINK', notes: 'Bank transfer' })
        .expect(201);

      const invoice = await prisma.invoice.findUnique({ where: { id: issuedInvoiceId } });
      expect(Number(invoice.paid)).toBe(30);
      expect(invoice.paymentStatus).toBe('PARTIALLY_PAID');
    });

    it('should record the final payment and move the invoice to PAID', async () => {
      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ invoiceId: issuedInvoiceId, amount: 20, method: 'KNET' })
        .expect(201);

      const invoice = await prisma.invoice.findUnique({ where: { id: issuedInvoiceId } });
      expect(Number(invoice.paid)).toBe(50);
      expect(Number(invoice.remaining)).toBe(0);
      expect(invoice.paymentStatus).toBe('PAID');
    });

    it('should reject a further payment now that the invoice is fully paid', async () => {
      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ invoiceId: issuedInvoiceId, amount: 5, method: 'KNET' })
        .expect(400);
    });

    it('should reject unauthenticated payment creation', async () => {
      await request(app.getHttpServer())
        .post('/api/payments')
        .send({ invoiceId: issuedInvoiceId, amount: 5, method: 'KNET' })
        .expect(401);
    });
  });

  describe('Payment Retrieval', () => {
    it('should list all payments for an invoice', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/payments?invoiceId=${issuedInvoiceId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBe(3);
    });

    it('should require invoiceId query param', async () => {
      await request(app.getHttpServer())
        .get('/api/payments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(400);
    });

    it('should reject unauthenticated payment list', async () => {
      await request(app.getHttpServer())
        .get(`/api/payments?invoiceId=${issuedInvoiceId}`)
        .expect(401);
    });
  });

  describe('Payment Reversal (Admin only)', () => {
    let paymentToReverseId: string;

    beforeAll(async () => {
      const payment = await prisma.payment.findFirst({ where: { invoiceId: issuedInvoiceId, amount: 10 } });
      paymentToReverseId = payment.id;
    });

    it('should reject reversal by receptionist', async () => {
      await request(app.getHttpServer())
        .post(`/api/payments/${paymentToReverseId}/reverse`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .send({})
        .expect(403);
    });

    it('should reverse a payment as admin and update invoice totals', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/payments/${paymentToReverseId}/reverse`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ reversalNotes: 'Customer refund request' })
        .expect(201);

      expect(response.body.reversed).toBe(true);

      const invoice = await prisma.invoice.findUnique({ where: { id: issuedInvoiceId } });
      expect(Number(invoice.paid)).toBe(40);
      expect(Number(invoice.remaining)).toBe(10);
      expect(invoice.paymentStatus).toBe('PARTIALLY_PAID');

      // Payment should be marked as REVERSED, not deleted
      const reversedPayment = await prisma.payment.findUnique({ where: { id: paymentToReverseId } });
      expect(reversedPayment.status).toBe('REVERSED');
      expect(reversedPayment.reversedAt).toBeDefined();
      expect(reversedPayment.reversedBy).toBe(adminUserId);
      expect(reversedPayment.reversalNotes).toBe('Customer refund request');
    });

    it('should reject reversing the same payment twice', async () => {
      await request(app.getHttpServer())
        .post(`/api/payments/${paymentToReverseId}/reverse`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({})
        .expect(400);
    });

    it('should not show reversed payments in invoice payment list', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/payments?invoiceId=${issuedInvoiceId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      // Should only show non-reversed payments
      expect(response.body.every((p: { status: string }) => p.status === 'RECORDED')).toBe(true);
    });

    it('should reject unauthenticated reversal', async () => {
      await request(app.getHttpServer())
        .post(`/api/payments/${paymentToReverseId}/reverse`)
        .send({})
        .expect(401);
    });
  });

  describe('Concurrency Safety', () => {
    let concurrentInvoiceId: string;

    beforeAll(async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber: 'INV-CONCURRENT',
          visitId: visit.id,
          patientId: testPatientId,
          status: 'ISSUED',
          subtotal: 100,
          total: 100,
          paid: 0,
          remaining: 100,
          paymentStatus: 'UNPAID',
          createdById: adminUserId,
          issuedAt: new Date(),
          issuedById: adminUserId,
          invoiceItems: {
            create: [{ serviceId: testServiceId, serviceNameSnapshot: 'Consultation', unitPriceSnapshot: 100, quantity: 1, lineTotal: 100 }],
          },
        },
      });
      concurrentInvoiceId = invoice.id;
    });

    it('should prevent overpayment through concurrent requests', async () => {
      // Simulate two concurrent payment requests for the same amount
      const [payment1, payment2] = await Promise.allSettled([
        request(app.getHttpServer())
          .post('/api/payments')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send({ invoiceId: concurrentInvoiceId, amount: 80, method: 'KNET' }),
        request(app.getHttpServer())
          .post('/api/payments')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send({ invoiceId: concurrentInvoiceId, amount: 80, method: 'KNET' }),
      ]);

      // At least one should succeed
      const fulfilledPayments = [payment1, payment2].filter(p => p.status === 'fulfilled');
      expect(fulfilledPayments.length).toBeGreaterThan(0);

      // Verify final state is consistent - total should not exceed 100
      const invoice = await prisma.invoice.findUnique({ where: { id: concurrentInvoiceId } });
      expect(Number(invoice.paid)).toBeLessThanOrEqual(100);
      expect(Number(invoice.remaining)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Audit Logging', () => {
    it('should log payment creation', async () => {
      const logs = await prisma.auditLog.findMany({ where: { entityType: 'Payment', action: 'CREATE' } });
      expect(logs.length).toBeGreaterThan(0);
    });

    it('should log payment reversal', async () => {
      const logs = await prisma.auditLog.findMany({ where: { entityType: 'Payment', action: 'REVERSE' } });
      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
