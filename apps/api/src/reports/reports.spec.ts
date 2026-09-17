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
        status: 'ISSUED',
        subtotal: 50,
        total: 50,
        paid: 0,
        remaining: 50,
        paymentStatus: 'UNPAID',
        createdById: adminUserId,
        issuedById: adminUserId,
        issuedAt: new Date(),
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

      // Verify exact UTC values for Kuwait (UTC+3)
      // 2026-09-18 00:00:00 Asia/Kuwait = 2026-09-17T21:00:00.000Z
      expect(startUtc.toISOString()).toBe('2026-09-17T21:00:00.000Z');

      // 2026-09-18 23:59:59.999 Asia/Kuwait = 2026-09-18T20:59:59.999Z
      expect(endUtc.toISOString()).toBe('2026-09-18T20:59:59.999Z');
    });
  });

  describe('Payment Reversal Exclusion', () => {
    it('should include RECORDED payment in summary total collected', async () => {
      // Create a RECORDED payment with a paymentDate within the default range
      const today = new Date();
      const payment = await prisma.payment.create({
        data: {
          invoiceId: testInvoiceId,
          amount: 30,
          method: 'KNET',
          status: 'RECORDED',
          paymentDate: today,
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
      const today = new Date();
      // Create a payment
      const payment = await prisma.payment.create({
        data: {
          invoiceId: testInvoiceId,
          amount: 30,
          method: 'KNET',
          status: 'RECORDED',
          paymentDate: today,
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
      const today = new Date();
      // Create payments with different methods
      const knetPayment1 = await prisma.payment.create({
        data: {
          invoiceId: testInvoiceId,
          amount: 100,
          method: 'KNET',
          status: 'RECORDED',
          paymentDate: today,
          recordedById: adminUserId,
        },
      });

      const knetPayment2 = await prisma.payment.create({
        data: {
          invoiceId: testInvoiceId,
          amount: 75,
          method: 'KNET',
          status: 'RECORDED',
          paymentDate: today,
          recordedById: adminUserId,
        },
      });

      // Get payment method breakdown before reversal
      const breakdownBefore = await request(app.getHttpServer())
        .get('/api/reports/payment-methods')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const knetBefore = breakdownBefore.body.find((m: any) => m.method === 'KNET')?.amount || 0;

      // Reverse the second KNET payment
      await prisma.payment.update({
        where: { id: knetPayment2.id },
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
      const knetAfter = breakdownAfter.body.find((m: any) => m.method === 'KNET')?.amount || 0;

      // KNET should decrease by the reversed payment amount
      expect(knetAfter).toBe(knetBefore - 75);

      // Clean up
      await prisma.payment.deleteMany({ where: { id: { in: [knetPayment1.id, knetPayment2.id] } } });
    });

    it('should exclude REVERSED payments from revenue timeseries', async () => {
      const today = new Date();
      const payment = await prisma.payment.create({
        data: {
          invoiceId: testInvoiceId,
          amount: 40,
          method: 'KNET',
          status: 'RECORDED',
          paymentDate: today,
          recordedById: adminUserId,
        },
      });

      // Get revenue timeseries with today's date (will use default range which includes today)
      const timeseriesBefore = await request(app.getHttpServer())
        .get('/api/reports/revenue-timeseries')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const collectedBefore = timeseriesBefore.body.reduce((sum: number, t: any) => sum + (t.collected || 0), 0);

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
        .get('/api/reports/revenue-timeseries')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const collectedAfter = timeseriesAfter.body.reduce((sum: number, t: any) => sum + (t.collected || 0), 0);

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

    describe('Daily Closing Timezone', () => {
      it('should return data for the exact Kuwait calendar day when queried with date=2026-09-18', async () => {
        // Create a new visit for this test
        const timezoneTestVisit = await prisma.visit.create({
          data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
        });

        // Create an invoice issued on 2026-09-18 Kuwait time
        // 2026-09-18 12:00:00 Asia/Kuwait = 2026-09-18T09:00:00.000Z
        const invoice = await prisma.invoice.create({
          data: {
            invoiceNumber: 'INV-timezone-test',
            visitId: timezoneTestVisit.id,
            patientId: testPatientId,
            status: 'ISSUED',
            issuedAt: new Date('2026-09-18T09:00:00.000Z'),
            subtotal: 100,
            total: 100,
            paid: 100,
            remaining: 0,
            paymentStatus: 'PAID',
            createdById: adminUserId,
            issuedById: adminUserId,
          },
        });

        // Query daily closing for 2026-09-18
        const response = await request(app.getHttpServer())
          .get('/api/reports/daily-closing?date=2026-09-18')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .expect(200);

        // Verify the response date matches the queried date
        expect(response.body.date).toBe('2026-09-18');

        // Verify the invoice is included in the count
        expect(response.body.invoiceCount).toBeGreaterThanOrEqual(1);

        // Clean up
        await prisma.invoice.delete({ where: { id: invoice.id } });
        await prisma.visit.delete({ where: { id: timezoneTestVisit.id } });
      });
    });
  });
});
