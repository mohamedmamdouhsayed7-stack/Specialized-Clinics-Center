import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { cleanupReportsTestData } from '../test-utils';

// Import the timezone helper for unit testing
import { localDayStartToUtc, localDayEndToUtc } from './reports.service';

describe('Reports Module Tests (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminAccessToken: string;
  let adminUserId: string;
  let testPatientId: string;
  let testVisitId: string;
  let testInvoiceId: string;
  let testServiceId: string;

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

    // Clean up test data using shared utility (scoped to reports test users)
    await cleanupReportsTestData(prisma, '.reports@test.com');

    // Create admin user
    const adminPasswordHash = await argon2.hash('admin123');
    const admin = await prisma.user.create({
      data: {
        email: 'testadmin.reports@test.com',
        passwordHash: adminPasswordHash,
        name: 'Test Admin',
        role: 'ADMIN',
        isActive: true,
      },
    });
    adminUserId = admin.id;

    // Get admin token
    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'testadmin.reports@test.com', password: 'admin123' });
    adminAccessToken = loginResponse.body.accessToken;

    // Create test patient
    const patient = await prisma.patient.create({
      data: {
        civilId: '10000000',
        fullNameAr: 'تقارير اختبار',
        fullNameEn: 'Test Reports',
        phone: '5551234567',
        createdById: adminUserId,
      },
    });
    testPatientId = patient.id;

    // Create visit
    const visit = await prisma.visit.create({
      data: {
        patientId: testPatientId,
        type: 'OTHER',
        createdById: adminUserId,
      },
    });
    testVisitId = visit.id;

    // Create service
    const service = await prisma.service.create({
      data: {
        name: 'تقرير اختبار',
        code: 'TEST-001',
        currentPrice: 50,
        isActive: true,
        createdById: adminUserId,
      },
    });
    testServiceId = service.id;

    // Create invoice
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: 'DRAFT-test-reports',
        visitId: testVisitId,
        patientId: testPatientId,
        status: 'DRAFT',
        subtotal: 50,
        total: 50,
        paid: 0,
        remaining: 50,
        paymentStatus: 'UNPAID',
        createdById: adminUserId,
        invoiceItems: {
          create: {
            serviceNameSnapshot: 'تقرير اختبار',
            unitPriceSnapshot: 50,
            quantity: 1,
            lineTotal: 50,
            serviceId: service.id,
          },
        },
      },
    });
    testInvoiceId = invoice.id;
  });

  afterAll(async () => {
    // Clean up test data using shared utility (reports uses special patient cleanup)
    await cleanupReportsTestData(prisma);
    await app.close();
  });

  describe('Timezone Helper Unit Tests', () => {
    it('should convert 2026-09-18 to correct UTC range for Asia/Kuwait timezone', () => {
      const testDate = '2026-09-18';
      const startUtc = localDayStartToUtc(testDate);
      const endUtc = localDayEndToUtc(testDate);

      // Verify the UTC range spans exactly 24 hours minus 1 millisecond
      const duration = endUtc.getTime() - startUtc.getTime();
      expect(duration).toBe(24 * 60 * 60 * 1000 - 1);

      // Verify the start represents midnight in Kuwait timezone
      // Kuwait is UTC+3, so midnight local = 21:00 UTC previous day
      // For 2026-09-18 in Kuwait (UTC+3), start should be 2026-09-17T21:00:00.000Z
      const expectedStart = new Date('2026-09-17T21:00:00.000Z');
      expect(startUtc.getTime()).toBe(expectedStart.getTime());

      // End should be 2026-09-18T20:59:59.999Z
      const expectedEnd = new Date('2026-09-18T20:59:59.999Z');
      expect(endUtc.getTime()).toBe(expectedEnd.getTime());
    });
  });

  describe('Payment Reversal Exclusion', () => {
    it('should include RECORDED payment in summary total collected', async () => {
      // Create a RECORDED payment
      const payment = await prisma.payment.create({
        data: {
          invoiceId: testInvoiceId,
          amount: 30,
          method: 'KNET',
          status: 'RECORDED',
          recordedById: adminUserId,
        },
      });

      // Get summary including the new payment
      const response = await request(app.getHttpServer())
        .get('/api/reports/summary')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.totalCollected).toBeGreaterThan(0);
      
      // Clean up
      await prisma.payment.delete({ where: { id: payment.id } });
    });

    it('should exclude REVERSED payment from summary total collected', async () => {
      // Create a payment
      const payment = await prisma.payment.create({
        data: {
          invoiceId: testInvoiceId,
          amount: 30,
          method: 'KNET',
          status: 'RECORDED',
          recordedById: adminUserId,
        },
      });

      // Get summary including the new payment
      const summaryBefore = await request(app.getHttpServer())
        .get('/api/reports/summary')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const collectedBefore = summaryBefore.body.totalCollected;

      // Reverse the payment
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'REVERSED',
          reversedAt: new Date(),
          reversedBy: adminUserId,
          reversalNotes: 'Test reversal',
        },
      });

      // Get summary after reversal
      const summaryAfter = await request(app.getHttpServer())
        .get('/api/reports/summary')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const collectedAfter = summaryAfter.body.totalCollected;

      // Collected amount should decrease by the reversed payment amount
      expect(collectedAfter).toBeLessThan(collectedBefore);
      expect(collectedAfter).toBe(collectedBefore - 30);
    });

    it('should exclude REVERSED payments from payment method breakdown', async () => {
      // Create payments with different methods
      const cashPayment = await prisma.payment.create({
        data: {
          invoiceId: testInvoiceId,
          amount: 100,
          method: 'KNET',
          status: 'RECORDED',
          recordedById: adminUserId,
        },
      });

      const visaPayment = await prisma.payment.create({
        data: {
          invoiceId: testInvoiceId,
          amount: 75,
          method: 'LINK',
          status: 'RECORDED',
          recordedById: adminUserId,
        },
      });

      // Get payment method breakdown before reversal
      const breakdownBefore = await request(app.getHttpServer())
        .get('/api/reports/payment-methods')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const cashBefore = breakdownBefore.body.find((m: any) => m.method === 'KNET')?.amount || 0;
      const visaBefore = breakdownBefore.body.find((m: any) => m.method === 'LINK')?.amount || 0;

      // Reverse the VISA payment
      await prisma.payment.update({
        where: { id: visaPayment.id },
        data: {
          status: 'REVERSED',
          reversedAt: new Date(),
          reversedBy: adminUserId,
          reversalNotes: 'Test reversal',
        },
      });

      // Get payment method breakdown after reversal
      const breakdownAfter = await request(app.getHttpServer())
        .get('/api/reports/payment-methods')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const cashAfter = breakdownAfter.body.find((m: any) => m.method === 'KNET')?.amount || 0;
      const visaAfter = breakdownAfter.body.find((m: any) => m.method === 'LINK')?.amount || 0;

      // CASH should remain the same
      expect(cashAfter).toBe(cashBefore);

      // VISA should be excluded
      expect(visaAfter).toBe(0);

      // Clean up
      await prisma.payment.deleteMany({ where: { id: { in: [cashPayment.id, visaPayment.id] } } });
    });

    it('should exclude REVERSED payments from revenue timeseries', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const payment = await prisma.payment.create({
        data: {
          invoiceId: testInvoiceId,
          amount: 40,
          method: 'KNET',
          status: 'RECORDED',
          // Use UTC to ensure it falls within the report range regardless of timezone
          paymentDate: new Date(`${today}T12:00:00.000Z`),
          recordedById: adminUserId,
        },
      });

      // Get revenue timeseries before reversal
      const timeseriesBefore = await request(app.getHttpServer())
        .get(`/api/reports/revenue-timeseries?from=${today}&to=${today}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const collectedBefore = timeseriesBefore.body.find((t: any) => t.date === today)?.collected || 0;

      // Reverse the payment
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'REVERSED',
          reversedAt: new Date(),
          reversedBy: adminUserId,
          reversalNotes: 'Test reversal',
        },
      });

      // Get revenue timeseries after reversal
      const timeseriesAfter = await request(app.getHttpServer())
        .get(`/api/reports/revenue-timeseries?from=${today}&to=${today}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const collectedAfter = timeseriesAfter.body.find((t: any) => t.date === today)?.collected || 0;

      // Collected amount should decrease
      expect(collectedAfter).toBeLessThan(collectedBefore);
      expect(collectedAfter).toBe(collectedBefore - 40);
    });

    describe('Summary date range', () => {
      it('should include only in-range issued invoices, payments, and outstanding balances', async () => {
        const inRangeVisit = await prisma.visit.create({
          data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
        });
        const outOfRangeVisit = await prisma.visit.create({
          data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
        });
        const inRangeInvoice = await prisma.invoice.create({
          data: {
            invoiceNumber: 'INV-report-range-in',
            visitId: inRangeVisit.id,
            patientId: testPatientId,
            status: 'ISSUED',
            issuedAt: new Date('2026-01-15T12:00:00.000Z'),
            subtotal: 100,
            total: 100,
            paid: 60,
            remaining: 40,
            paymentStatus: 'PARTIALLY_PAID',
            createdById: adminUserId,
            issuedById: adminUserId,
          },
        });
        const outOfRangeInvoice = await prisma.invoice.create({
          data: {
            invoiceNumber: 'INV-report-range-out',
            visitId: outOfRangeVisit.id,
            patientId: testPatientId,
            status: 'ISSUED',
            issuedAt: new Date('2025-12-15T12:00:00.000Z'),
            subtotal: 200,
            total: 200,
            paid: 50,
            remaining: 150,
            paymentStatus: 'PARTIALLY_PAID',
            createdById: adminUserId,
            issuedById: adminUserId,
          },
        });
        const payment = await prisma.payment.create({
          data: {
            invoiceId: inRangeInvoice.id,
            amount: 60,
            method: 'KNET',
            status: 'RECORDED',
            paymentDate: new Date('2026-01-20T12:00:00.000Z'),
            recordedById: adminUserId,
          },
        });

        const response = await request(app.getHttpServer())
          .get('/api/reports/summary?from=2026-01-01&to=2026-01-31')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .expect(200);

        expect(response.body.totalRevenue).toBe(100);
        expect(response.body.totalCollected).toBe(60);
        expect(response.body.outstandingAmount).toBe(40);
        expect(response.body.totalInvoices).toBe(1);

        await prisma.payment.delete({ where: { id: payment.id } });
        await prisma.invoice.deleteMany({ where: { id: { in: [inRangeInvoice.id, outOfRangeInvoice.id] } } });
        await prisma.visit.deleteMany({ where: { id: { in: [inRangeVisit.id, outOfRangeVisit.id] } } });
      });
    });
  });
});
