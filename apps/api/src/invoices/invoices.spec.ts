import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { cleanupTestData } from '../test-utils';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

describe('Invoices Module Tests (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminUserId: string;
  let testPatientId: string;
  let testServiceAId: string;
  let testServiceBId: string;
  let inactiveServiceId: string;
  let testVisitId: string;
  let secondVisitId: string;
  let testInvoiceId: string;
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

    // Clean up test data using shared utility (scoped to invoices test users)
    await cleanupTestData(prisma, '.invoices@test.com');

    // Create admin user
    const adminPasswordHash = await argon2.hash('admin123');
    const admin = await prisma.user.create({
      data: {
        email: 'testadmin.invoices@test.com',
        passwordHash: adminPasswordHash,
        name: 'Test Admin',
        role: 'ADMIN',
        isActive: true,
      },
    });
    adminUserId = admin.id;

    // Create receptionist user
    const receptionistPasswordHash = await argon2.hash('receptionist123');
    await prisma.user.create({
      data: {
        email: 'testreceptionist.invoices@test.com',
        passwordHash: receptionistPasswordHash,
        name: 'Test Receptionist',
        role: 'RECEPTIONIST',
        isActive: true,
      },
    });

    // Create test patient
    const patient = await prisma.patient.create({
      data: {
        civilId: '12345670001',
        fullNameAr: 'سارة أحمد',
        fullNameEn: 'Sara Ahmed',
        phone: '99912345',
        createdById: adminUserId,
      },
    });
    testPatientId = patient.id;

    // Create services (mirrors the clinic's real catalog example)
    const serviceA = await prisma.service.create({
      data: { name: 'Follow-up', currentPrice: 30, isActive: true, createdById: adminUserId },
    });
    testServiceAId = serviceA.id;

    const serviceB = await prisma.service.create({
      data: { name: 'Sonar 4D', currentPrice: 40, isActive: true, createdById: adminUserId },
    });
    testServiceBId = serviceB.id;

    const inactiveService = await prisma.service.create({
      data: { name: 'Discontinued Service', currentPrice: 15, isActive: false, createdById: adminUserId },
    });
    inactiveServiceId = inactiveService.id;

    // Create visits to invoice against
    const visit = await prisma.visit.create({
      data: { patientId: testPatientId, type: 'CHECKUP', createdById: adminUserId },
    });
    testVisitId = visit.id;

    const secondVisit = await prisma.visit.create({
      data: { patientId: testPatientId, type: 'FOLLOW_UP', createdById: adminUserId },
    });
    secondVisitId = secondVisit.id;

    // Get tokens once for all tests
    const adminResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'testadmin.invoices@test.com', password: 'admin123' });
    adminAccessToken = adminResponse.body.accessToken;

    const receptionistResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'testreceptionist.invoices@test.com', password: 'receptionist123' });
    receptionistAccessToken = receptionistResponse.body.accessToken;
  });

  afterAll(async () => {
    // Clean up test data using shared utility (scoped to invoices test users)
    await cleanupTestData(prisma, '.invoices@test.com');
    await app.close();
  });

  describe('Invoice Creation', () => {
    it('should create an invoice as admin with multiple items, full payment, and correct totals', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: testVisitId,
          paymentMethod: 'KNET',
          items: [
            { serviceId: testServiceAId, quantity: 1 },
            { serviceId: testServiceBId, quantity: 1 },
          ],
        })
        .expect(201);

      expect(response.body.status).toBe('ISSUED');
      expect(Number(response.body.subtotal)).toBe(70);
      expect(Number(response.body.total)).toBe(70);
      expect(Number(response.body.paid)).toBe(70);
      expect(Number(response.body.remaining)).toBe(0);
      expect(response.body.paymentStatus).toBe('PAID');
      // Normal invoices get final INV-XXXXXX assigned at creation
      expect(response.body.invoiceNumber).toMatch(/^INV-\d{6}$/);
      expect(response.body.invoiceItems).toHaveLength(2);
      expect(response.body.payments).toHaveLength(1);
      expect(response.body.payments[0].method).toBe('KNET');
      expect(response.body.payments[0].status).toBe('RECORDED');
      expect(Number(response.body.payments[0].amount)).toBe(70);
      const completedVisit = await prisma.visit.findUnique({
        where: { id: testVisitId },
        select: { status: true },
      });
      expect(completedVisit?.status).toBe('COMPLETED');
      testInvoiceId = response.body.id;
    });

    it('should reject invoice creation without paymentMethod or with invalid method', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      // Missing paymentMethod
      await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(400);

      // Invalid paymentMethod (CASH and VISA are not allowed for new payments)
      await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'CASH',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(400);
    });

    it('should allow OTHER as a payment method for a new invoice', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const response = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'OTHER',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      expect(response.body.status).toBe('ISSUED');
      expect(response.body.paymentStatus).toBe('PAID');
      expect(response.body.payments).toHaveLength(1);
      expect(response.body.payments[0].method).toBe('OTHER');
      expect(Number(response.body.payments[0].amount)).toBe(30);
    });

    it('should reject downgrading a visit after an invoice exists', async () => {
      await request(app.getHttpServer())
        .patch(`/api/visits/${testVisitId}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(400);

      const visit = await prisma.visit.findUnique({
        where: { id: testVisitId },
        select: { status: true },
      });
      expect(visit?.status).toBe('COMPLETED');
    });

    it('should reject invoice prices with more than two decimal places', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1, unitPrice: 1.001 }],
        })
        .expect(400);

      const unchangedVisit = await prisma.visit.findUnique({
        where: { id: visit.id },
        select: { status: true },
      });
      expect(unchangedVisit?.status).toBe('SCHEDULED');
    });

    it('should not invoice a cancelled visit', async () => {
      const cancelledVisit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', status: 'CANCELLED', createdById: adminUserId },
      });

      await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: cancelledVisit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(400);

      const visit = await prisma.visit.findUnique({
        where: { id: cancelledVisit.id },
        select: { status: true },
      });
      expect(visit?.status).toBe('CANCELLED');
    });

    it('should snapshot the service name and price on the invoice item', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/invoices/${testInvoiceId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      const item = response.body.invoiceItems.find((i: { serviceId: string }) => i.serviceId === testServiceAId);
      expect(item.serviceNameSnapshot).toBe('Follow-up');
      expect(Number(item.unitPriceSnapshot)).toBe(30);
    });

    it('should create an invoice as receptionist', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .send({
          visitId: secondVisitId,
          paymentMethod: 'LINK',
          items: [{ serviceId: testServiceAId, quantity: 2 }],
        })
        .expect(201);

      expect(response.body.status).toBe('ISSUED');
      expect(response.body.paymentStatus).toBe('PAID');
      expect(Number(response.body.total)).toBe(60);
      expect(Number(response.body.paid)).toBe(60);
      expect(Number(response.body.remaining)).toBe(0);
      expect(response.body.invoiceNumber).toMatch(/^INV-\d{6}$/);
    });

    it('should reject a second active invoice for the same visit', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: testVisitId,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(409);

      expect(response.body.message).toBe('This visit already has an active invoice');
    });

    it('should allow invoice creation after original invoice is voided', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      // Create first invoice
      const firstInvoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      // Reverse payment before voiding (payments must be reversed before voiding)
      await request(app.getHttpServer())
        .post(`/api/payments/${firstInvoice.body.payments[0].id}/reverse`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ reversalNotes: 'Reversing before voiding' })
        .expect(201);

      // Void the first invoice
      await request(app.getHttpServer())
        .patch(`/api/invoices/${firstInvoice.body.id}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'VOID' })
        .expect(200);

      // Should be able to create a new invoice for the same visit
      const secondInvoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'LINK',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      expect(secondInvoice.body.visitId).toBe(visit.id);
      expect(secondInvoice.body.status).toBe('ISSUED');
      expect(secondInvoice.body.paymentStatus).toBe('PAID');
    });

    it('should prevent concurrent invoice creation for same visit', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      // Simulate two concurrent invoice creation requests
      const [invoice1, invoice2] = await Promise.allSettled([
        request(app.getHttpServer())
          .post('/api/invoices')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send({
            visitId: visit.id,
            paymentMethod: 'KNET',
            items: [{ serviceId: testServiceAId, quantity: 1 }],
          }),
        request(app.getHttpServer())
          .post('/api/invoices')
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send({
            visitId: visit.id,
            paymentMethod: 'KNET',
            items: [{ serviceId: testServiceAId, quantity: 1 }],
          }),
      ]);

      // Exactly one should succeed (201), one should fail (409)
      const successfulInvoices = [invoice1, invoice2].filter(p => p.status === 'fulfilled' && p.value.status === 201);
      const failedInvoices = [invoice1, invoice2].filter(p => p.status === 'fulfilled' && p.value.status === 409);

      expect(successfulInvoices.length).toBe(1);
      expect(failedInvoices.length).toBe(1);

      // Verify only one active invoice exists in database
      const activeInvoices = await prisma.invoice.findMany({
        where: { 
          visitId: visit.id,
          status: { in: ['DRAFT', 'ISSUED'] }
        },
      });

      expect(activeInvoices.length).toBe(1);
    });

    it('should reject an invoice for a non-existent visit', async () => {
      await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: '00000000-0000-0000-0000-000000000000',
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(404);
    });

    it('should reject an invoice referencing an inactive service', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: inactiveServiceId, quantity: 1 }],
        })
        .expect(400);
    });

    it('should reject an invoice with no items', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ visitId: visit.id, paymentMethod: 'KNET', items: [] })
        .expect(400);
    });

    it('should reject unauthenticated invoice creation', async () => {
      await request(app.getHttpServer())
        .post('/api/invoices')
        .send({ visitId: testVisitId, paymentMethod: 'KNET', items: [{ serviceId: testServiceAId, quantity: 1 }] })
        .expect(401);
    });
  });

  describe('Invoice Retrieval', () => {
    it('should generate a real Arabic invoice PDF', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/invoices/${testInvoiceId}/pdf?lang=ar`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200)
        .expect('Content-Type', /application\/pdf/);

      expect(response.headers['content-disposition']).toContain('.pdf');
      expect(response.body.subarray(0, 4).toString()).toBe('%PDF');
    }, 30_000);

    it('should get invoice by ID as admin', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/invoices/${testInvoiceId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.id).toBe(testInvoiceId);
    });

    it('should get invoice by ID as receptionist', async () => {
      await request(app.getHttpServer())
        .get(`/api/invoices/${testInvoiceId}`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .expect(200);
    });

    it('should return 404 for non-existent invoice', async () => {
      await request(app.getHttpServer())
        .get('/api/invoices/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(404);
    });

    it('should reject unauthenticated invoice retrieval', async () => {
      await request(app.getHttpServer())
        .get(`/api/invoices/${testInvoiceId}`)
        .expect(401);
    });
  });

  describe('Invoice List and Filters', () => {
    it('should list invoices as admin', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.meta.total).toBeGreaterThanOrEqual(2);
    });

    it('should filter by patientId', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/invoices?patientId=${testPatientId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.data.every((inv: { patientId: string }) => inv.patientId === testPatientId)).toBe(true);
    });

    it('should filter by status', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/invoices?status=ISSUED')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data.every((inv: { status: string }) => inv.status === 'ISSUED')).toBe(true);
    });

    it('should search invoices by invoice number', async () => {
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: testInvoiceId } });
      const response = await request(app.getHttpServer())
        .get(`/api/invoices?search=${encodeURIComponent(invoice.invoiceNumber)}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.data.some((inv: { id: string }) => inv.id === testInvoiceId)).toBe(true);
    });

    it('should search invoices by patient name and phone', async () => {
      const nameResponse = await request(app.getHttpServer())
        .get('/api/invoices?search=Sara')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      const phoneResponse = await request(app.getHttpServer())
        .get('/api/invoices?search=99912345')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(nameResponse.body.meta.total).toBeGreaterThan(0);
      expect(phoneResponse.body.meta.total).toBeGreaterThan(0);
    });

    it('should combine search with status and return no matches safely', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/invoices?search=does-not-exist&status=ISSUED')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.data).toEqual([]);
      expect(response.body.meta.total).toBe(0);
    });

    it('should preserve pagination when searching', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/invoices?search=Sara&limit=1&page=2')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.meta.limit).toBe(1);
      expect(response.body.meta.page).toBe(2);
    });

    it('should reject unauthenticated invoice list', async () => {
      await request(app.getHttpServer())
        .get('/api/invoices')
        .expect(401);
    });
  });

  describe('Invoice Status Transitions', () => {
    it('should reject re-issuing an already issued invoice', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/invoices/${testInvoiceId}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'ISSUED' })
        .expect(400);

      expect(response.body.message).toBe('Invoice is already issued and cannot be re-issued');
    });

    it('should reject transitioning an issued invoice back to draft', async () => {
      await request(app.getHttpServer())
        .patch(`/api/invoices/${testInvoiceId}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'DRAFT' })
        .expect(400);
    });

    it('should reject voiding an issued invoice with recorded payments', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/invoices/${testInvoiceId}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'VOID' })
        .expect(400);

      expect(response.body.message).toBe(
        'Invoice cannot be voided while recorded payments exist. Reverse all payments before voiding the invoice.',
      );
    });

    it('should void an issued invoice after reversing its payment', async () => {
      const invoice = await prisma.invoice.findUniqueOrThrow({
        where: { id: testInvoiceId },
        include: { payments: true },
      });
      const paymentId = invoice.payments[0].id;

      await request(app.getHttpServer())
        .post(`/api/payments/${paymentId}/reverse`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ reversalNotes: 'Reversing test payment before voiding' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .patch(`/api/invoices/${testInvoiceId}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'VOID' })
        .expect(200);

      expect(response.body.status).toBe('VOID');
    });

    it('should reject any transition out of a voided invoice', async () => {
      await request(app.getHttpServer())
        .patch(`/api/invoices/${testInvoiceId}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'ISSUED' })
        .expect(400);
    });

    it('should reject unauthenticated status change', async () => {
      await request(app.getHttpServer())
        .patch(`/api/invoices/${testInvoiceId}/status`)
        .send({ status: 'VOID' })
        .expect(401);
    });
  });

  describe('Audit Logging', () => {
    it('should log invoice creation', async () => {
      const logs = await prisma.auditLog.findMany({
        where: { entityType: 'Invoice', action: 'CREATE' },
      });

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should log invoice status changes', async () => {
      const logs = await prisma.auditLog.findMany({
        where: { entityType: 'Invoice', action: 'STATUS_CHANGE' },
      });

      expect(logs.length).toBeGreaterThan(0);
    });
  });

  describe('Additional Charges', () => {
    let chargeInvoiceId: string;

    it('should create invoice with percentage charge', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const response = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
          additionalCharges: [
            { chargeType: 'PERCENTAGE', chargeValue: 10, description: 'Tax' },
          ],
        })
        .expect(201);

      expect(response.body.status).toBe('ISSUED');
      expect(response.body.paymentStatus).toBe('PAID');
      expect(Number(response.body.subtotal)).toBe(30);
      expect(Number(response.body.total)).toBe(33); // 30 + 10%
      expect(Number(response.body.paid)).toBe(33);
      expect(Number(response.body.remaining)).toBe(0);
      expect(response.body.additionalCharges).toHaveLength(1);
      expect(response.body.additionalCharges[0].chargeType).toBe('PERCENTAGE');
      expect(Number(response.body.additionalCharges[0].calculatedAmount)).toBe(3);
      chargeInvoiceId = response.body.id;
    });

    it('should create invoice with fixed charge', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const response = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'LINK',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
          additionalCharges: [
            { chargeType: 'FIXED', chargeValue: 5, description: 'Service Fee' },
          ],
        })
        .expect(201);

      expect(response.body.status).toBe('ISSUED');
      expect(response.body.paymentStatus).toBe('PAID');
      expect(Number(response.body.subtotal)).toBe(30);
      expect(Number(response.body.total)).toBe(35); // 30 + 5
      expect(Number(response.body.paid)).toBe(35);
      expect(Number(response.body.remaining)).toBe(0);
      expect(response.body.additionalCharges).toHaveLength(1);
      expect(response.body.additionalCharges[0].chargeType).toBe('FIXED');
      expect(Number(response.body.additionalCharges[0].calculatedAmount)).toBe(5);
    });

    it('should reject charges with more than two decimal places', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
          additionalCharges: [{ chargeType: 'FIXED', chargeValue: 12.345 }],
        })
        .expect(400);
    });

    it('should add charge to existing draft invoice', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      const replacement = await request(app.getHttpServer())
        .post(`/api/invoices/${invoice.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      expect(replacement.body.status).toBe('DRAFT');

      const response = await request(app.getHttpServer())
        .post(`/api/invoices/${replacement.body.id}/charges`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          chargeType: 'PERCENTAGE',
          chargeValue: 15,
          description: 'Discount',
        })
        .expect(201);

      expect(Number(response.body.total)).toBe(34.5); // 30 + 15%
      expect(Number(response.body.paid)).toBe(30);
      expect(Number(response.body.remaining)).toBe(4.5);
      expect(response.body.paymentStatus).toBe('PARTIALLY_PAID');
      expect(response.body.additionalCharges).toHaveLength(1);
    });

    it('should reject adding charge to issued invoice', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/invoices/${chargeInvoiceId}/charges`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          chargeType: 'FIXED',
          chargeValue: 10,
        })
        .expect(400);

      expect(response.body.message).toBe('Additional charges can only be added to draft invoices');
    });

    it('should handle concurrent charge additions safely', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      const replacement = await request(app.getHttpServer())
        .post(`/api/invoices/${invoice.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      // Simulate two concurrent charge additions on draft replacement
      const [charge1, charge2] = await Promise.allSettled([
        request(app.getHttpServer())
          .post(`/api/invoices/${replacement.body.id}/charges`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send({
            chargeType: 'FIXED',
            chargeValue: 5,
            description: 'Charge 1',
          }),
        request(app.getHttpServer())
          .post(`/api/invoices/${replacement.body.id}/charges`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send({
            chargeType: 'FIXED',
            chargeValue: 10,
            description: 'Charge 2',
          }),
      ]);

      // Both should succeed
      expect(charge1.status).toBe('fulfilled');
      expect(charge2.status).toBe('fulfilled');

      // Verify final invoice total includes both charges
      const finalInvoice = await request(app.getHttpServer())
        .get(`/api/invoices/${replacement.body.id}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(finalInvoice.body.additionalCharges).toHaveLength(2);
      expect(Number(finalInvoice.body.total)).toBe(45); // 30 + 5 + 10
      expect(Number(finalInvoice.body.paid)).toBe(30);
      expect(Number(finalInvoice.body.remaining)).toBe(15);
      expect(finalInvoice.body.paymentStatus).toBe('PARTIALLY_PAID');
    });
  });

  describe('Invoice Revision and Replacement', () => {
    let originalInvoiceId: string;

    it('should allow admin to void issued invoice after payment reversal', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      // Must reverse the recorded payment before voiding
      await request(app.getHttpServer())
        .post(`/api/payments/${invoice.body.payments[0].id}/reverse`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ reversalNotes: 'Reversing before voiding' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .patch(`/api/invoices/${invoice.body.id}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'VOID' })
        .expect(200);

      expect(response.body.status).toBe('VOID');
      originalInvoiceId = invoice.body.id;
    });

    it('should reject voiding an issued invoice with a recorded payment', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .patch(`/api/invoices/${invoice.body.id}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'VOID' })
        .expect(400);

      expect(response.body.message).toBe(
        'Invoice cannot be voided while recorded payments exist. Reverse all payments before voiding the invoice.',
      );

      const unchangedInvoice = await prisma.invoice.findUnique({
        where: { id: invoice.body.id },
      });
      expect(unchangedInvoice?.status).toBe('ISSUED');

      const recordedPayments = await prisma.payment.findMany({
        where: { invoiceId: invoice.body.id, status: 'RECORDED' },
      });
      expect(recordedPayments).toHaveLength(1);
    });

    it('should allow voiding an issued invoice after all payments are reversed', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/payments/${invoice.body.payments[0].id}/reverse`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ reversalNotes: 'Correction before voiding' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .patch(`/api/invoices/${invoice.body.id}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'VOID' })
        .expect(200);

      expect(response.body.status).toBe('VOID');

      const historicalPayment = await prisma.payment.findUnique({
        where: { id: invoice.body.payments[0].id },
      });
      expect(historicalPayment?.status).toBe('REVERSED');
    });

    it('should reject receptionist voiding invoice', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/invoices/${invoice.body.id}/status`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .send({ status: 'VOID' })
        .expect(403);
    });

    it('should create replacement invoice for voided invoice', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      // Create replacement - the service voids the original automatically
      const response = await request(app.getHttpServer())
        .post(`/api/invoices/${invoice.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          items: [{ serviceId: testServiceBId, quantity: 1 }],
          additionalCharges: [
            { chargeType: 'FIXED', chargeValue: 5, description: 'Adjustment Fee' },
          ],
        })
        .expect(201);

      expect(response.body.status).toBe('DRAFT');
      expect(response.body.invoiceItems).toHaveLength(1);
      expect(response.body.additionalCharges).toHaveLength(1);
      // Replacement starts as DRAFT with temporary number
      expect(response.body.invoiceNumber).toMatch(/^DRAFT-/);

      // Verify original invoice is linked and voided
      const original = await prisma.invoice.findUnique({
        where: { id: invoice.body.id },
      });
      expect(original?.replacedByInvoiceId).toBe(response.body.id);
      expect(original?.status).toBe('VOID');
    });

    it('should handle replacement of fully paid invoice', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      // Invoice is already fully paid upon creation (paid: 30, total: 30)

      // Create replacement with higher amount
      const response = await request(app.getHttpServer())
        .post(`/api/invoices/${invoice.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          items: [{ serviceId: testServiceBId, quantity: 1 }],
        })
        .expect(201);

      // Replacement should inherit paid amount
      expect(Number(response.body.paid)).toBe(30);
      expect(Number(response.body.total)).toBe(40);
      expect(Number(response.body.remaining)).toBe(10);
      expect(response.body.paymentStatus).toBe('PARTIALLY_PAID');

      // Original payments should remain on original invoice
      const originalPayments = await prisma.payment.findMany({
        where: { invoiceId: invoice.body.id },
      });
      expect(originalPayments.length).toBe(1);
    });

    it('should handle replacement of partially paid invoice', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      // Reverse the initial payment to make invoice unpaid
      await request(app.getHttpServer())
        .post(`/api/payments/${invoice.body.payments[0].id}/reverse`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ reversalNotes: 'Reversing before recording partial payment' })
        .expect(201);

      // Record partial payment of 15
      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          invoiceId: invoice.body.id,
          amount: 15,
          method: 'KNET',
        })
        .expect(201);

      // Create replacement with same amount
      const response = await request(app.getHttpServer())
        .post(`/api/invoices/${invoice.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      // Replacement should inherit partial payment
      expect(Number(response.body.paid)).toBe(15);
      expect(Number(response.body.total)).toBe(30);
      expect(Number(response.body.remaining)).toBe(15);
      expect(response.body.paymentStatus).toBe('PARTIALLY_PAID');
    });

    it('should handle replacement of unpaid invoice', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      // Reverse the initial payment
      await request(app.getHttpServer())
        .post(`/api/payments/${invoice.body.payments[0].id}/reverse`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ reversalNotes: 'Reversing before replacement' })
        .expect(201);

      // Create replacement without any payments
      const response = await request(app.getHttpServer())
        .post(`/api/invoices/${invoice.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      // Replacement should have no paid amount
      expect(Number(response.body.paid)).toBe(0);
      expect(Number(response.body.total)).toBe(30);
      expect(Number(response.body.remaining)).toBe(30);
      expect(response.body.paymentStatus).toBe('UNPAID');
    });

    it('should preserve payment credit across repeated replacements', async () => {
      // Regression test for: Repeated replacements lose payment credit
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      // Create original invoice (40 KWD, KNET) -> fully paid upon creation
      const originalInvoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceBId, quantity: 1 }],
        })
        .expect(201);

      const payment = originalInvoice.body.payments[0];
      expect(payment.amount).toBe("40");
      expect(payment.status).toBe('RECORDED');

      // Create first replacement (Replacement A) with Service B (40 KWD)
      const replacementA = await request(app.getHttpServer())
        .post(`/api/invoices/${originalInvoice.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          items: [{ serviceId: testServiceBId, quantity: 1 }],
        })
        .expect(201);

      // Replacement A should have payment credit preserved from original
      expect(Number(replacementA.body.paid)).toBe(40);
      expect(Number(replacementA.body.remaining)).toBe(0);
      expect(replacementA.body.paymentStatus).toBe('PAID');

      // Issue Replacement A (fully allocated, remaining == 0, no paymentMethod needed)
      await request(app.getHttpServer())
        .patch(`/api/invoices/${replacementA.body.id}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'ISSUED' })
        .expect(200);

      // Create second replacement (Replacement B) from Replacement A with Service A (30 KWD)
      const replacementB = await request(app.getHttpServer())
        .post(`/api/invoices/${replacementA.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      // Replacement B should preserve payment credit from the chain (capped at total 30)
      expect(Number(replacementB.body.paid)).toBe(30);
      expect(Number(replacementB.body.remaining)).toBe(0);
      expect(replacementB.body.paymentStatus).toBe('PAID');

      // Verify PaymentAllocation records are consistent
      const allocationsB = await prisma.paymentAllocation.findMany({
        where: { invoiceId: replacementB.body.id },
        include: { payment: true },
      });
      expect(allocationsB.length).toBe(1);
      expect(Number(allocationsB[0].amount)).toBe(30);
      expect(allocationsB[0].payment.status).toBe('RECORDED');

      // Issue Replacement B
      await request(app.getHttpServer())
        .patch(`/api/invoices/${replacementB.body.id}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'ISSUED' })
        .expect(200);

      // A later correction can be cheaper than the source payment. Its
      // carried credit must be capped at its own total, never negative.
      const replacementC = await request(app.getHttpServer())
        .post(`/api/invoices/${replacementB.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ items: [{ serviceId: testServiceAId, quantity: 1, unitPrice: 20 }] })
        .expect(201);

      expect(Number(replacementC.body.total)).toBe(20);
      expect(Number(replacementC.body.paid)).toBe(20);
      expect(Number(replacementC.body.remaining)).toBe(0);
      expect(replacementC.body.paymentStatus).toBe('PAID');

      const allocationsC = await prisma.paymentAllocation.findMany({
        where: { invoiceId: replacementC.body.id },
      });
      expect(allocationsC).toHaveLength(1);
      expect(Number(allocationsC[0].amount)).toBe(20);

      await request(app.getHttpServer())
        .post(`/api/payments/${payment.id}/reverse`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ reversalNotes: 'Reverse original payment across chain' })
        .expect(201);

      const balancesAfterReversal = await prisma.invoice.findMany({
        where: { id: { in: [originalInvoice.body.id, replacementA.body.id, replacementB.body.id, replacementC.body.id] } },
        select: { total: true, paid: true, remaining: true, paymentStatus: true },
      });
      expect(balancesAfterReversal.every((invoice) => Number(invoice.paid) === 0)).toBe(true);
      expect(balancesAfterReversal.every((invoice) => Number(invoice.remaining) === Number(invoice.total))).toBe(true);
      expect(balancesAfterReversal.every((invoice) => invoice.paymentStatus === 'UNPAID')).toBe(true);
    });

    it('should keep unpaid status when adding charge to unpaid invoice', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      // Create invoice
      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      // Reverse payment to make it UNPAID
      await request(app.getHttpServer())
        .post(`/api/payments/${invoice.body.payments[0].id}/reverse`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ reversalNotes: 'Reversing before replacement' })
        .expect(201);

      // Create replacement from unpaid invoice
      const replacement = await request(app.getHttpServer())
        .post(`/api/invoices/${invoice.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      // Verify initial state is UNPAID
      expect(replacement.body.paymentStatus).toBe('UNPAID');
      expect(Number(replacement.body.paid)).toBe(0);
      expect(Number(replacement.body.remaining)).toBe(30);

      // Add charge to the draft replacement invoice
      const updatedInvoice = await request(app.getHttpServer())
        .post(`/api/invoices/${replacement.body.id}/charges`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          chargeType: 'FIXED',
          chargeValue: 10,
          description: 'Additional fee',
        })
        .expect(201);

      // Verify payment status is recalculated correctly
      expect(Number(updatedInvoice.body.total)).toBe(40); // 30 + 10
      expect(Number(updatedInvoice.body.paid)).toBe(0); // paid amount unchanged
      expect(Number(updatedInvoice.body.remaining)).toBe(40); // 40 - 0
      expect(updatedInvoice.body.paymentStatus).toBe('UNPAID');
    });

    it('should prevent concurrent replacement creation for same invoice', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      // Simulate two concurrent replacement requests
      const [replacement1, replacement2] = await Promise.allSettled([
        request(app.getHttpServer())
          .post(`/api/invoices/${invoice.body.id}/replacement`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send({
            items: [{ serviceId: testServiceBId, quantity: 1 }],
          }),
        request(app.getHttpServer())
          .post(`/api/invoices/${invoice.body.id}/replacement`)
          .set('Authorization', `Bearer ${adminAccessToken}`)
          .send({
            items: [{ serviceId: testServiceBId, quantity: 1 }],
          }),
      ]);

      // Exactly one should succeed (201), one should fail (409)
      const successfulReplacements = [replacement1, replacement2].filter(p => p.status === 'fulfilled' && p.value.status === 201);
      const failedReplacements = [replacement1, replacement2].filter(p => p.status === 'fulfilled' && p.value.status === 409);

      expect(successfulReplacements.length).toBe(1);
      expect(failedReplacements.length).toBe(1);

      // Verify original invoice links to exactly one replacement
      const originalInvoice = await prisma.invoice.findUnique({
        where: { id: invoice.body.id },
      });
      expect(originalInvoice?.replacedByInvoiceId).toBeTruthy();

      // Verify no orphan drafts exist
      const allDrafts = await prisma.invoice.findMany({
        where: {
          visitId: visit.id,
          status: 'DRAFT',
        },
      });
      expect(allDrafts.length).toBe(1);
      const successfulReplacement = successfulReplacements[0];
      if (successfulReplacement.status === 'fulfilled') {
        expect(allDrafts[0].id).toBe(successfulReplacement.value.body.id);
      }
    });

    it('should reject receptionist creating replacement', async () => {
      await request(app.getHttpServer())
        .post(`/api/invoices/${originalInvoiceId}/replacement`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .send({
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(403);
    });

    it('should reject replacement for non-issued invoice', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      const draftReplacement = await request(app.getHttpServer())
        .post(`/api/invoices/${invoice.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          items: [{ serviceId: testServiceBId, quantity: 1 }],
        })
        .expect(201);

      expect(draftReplacement.body.status).toBe('DRAFT');

      await request(app.getHttpServer())
        .post(`/api/invoices/${draftReplacement.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(400);
    });

    it('should issue a fully allocated replacement invoice without duplicate payment', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      const replacement = await request(app.getHttpServer())
        .post(`/api/invoices/${invoice.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      expect(Number(replacement.body.remaining)).toBe(0);

      // Issue without paymentMethod (since remaining is 0)
      const issued = await request(app.getHttpServer())
        .patch(`/api/invoices/${replacement.body.id}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'ISSUED' })
        .expect(200);

      expect(issued.body.status).toBe('ISSUED');
      expect(issued.body.paymentStatus).toBe('PAID');
      expect(issued.body.invoiceNumber).toMatch(/^INV-\d{6}$/);

      // Verify no direct payment was recorded on the replacement
      const directPayments = await prisma.payment.findMany({
        where: { invoiceId: replacement.body.id, status: 'RECORDED' },
      });
      expect(directPayments).toHaveLength(0);
    });

    it('should require paymentMethod when issuing draft replacement with remaining balance and charge only remaining', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      const replacement = await request(app.getHttpServer())
        .post(`/api/invoices/${invoice.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          items: [{ serviceId: testServiceBId, quantity: 1 }],
        })
        .expect(201);

      expect(Number(replacement.body.remaining)).toBe(10);

      // Issue without paymentMethod -> 400
      const missingMethodRes = await request(app.getHttpServer())
        .patch(`/api/invoices/${replacement.body.id}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'ISSUED' })
        .expect(400);

      expect(missingMethodRes.body.message).toBe(
        'Payment method is required when issuing a DRAFT invoice with remaining balance',
      );

      // Issue with invalid paymentMethod -> 400
      await request(app.getHttpServer())
        .patch(`/api/invoices/${replacement.body.id}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'ISSUED', paymentMethod: 'CASH' })
        .expect(400);

      // Issue with valid paymentMethod -> 200
      const issued = await request(app.getHttpServer())
        .patch(`/api/invoices/${replacement.body.id}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'ISSUED', paymentMethod: 'LINK' })
        .expect(200);

      expect(issued.body.status).toBe('ISSUED');
      expect(issued.body.paymentStatus).toBe('PAID');
      expect(Number(issued.body.paid)).toBe(40);
      expect(Number(issued.body.remaining)).toBe(0);

      // Exactly one payment of amount 10 should be created
      const directPayments = await prisma.payment.findMany({
        where: { invoiceId: replacement.body.id, status: 'RECORDED' },
      });
      expect(directPayments).toHaveLength(1);
      expect(Number(directPayments[0].amount)).toBe(10);
      expect(directPayments[0].method).toBe('LINK');
    });

    it('should allow admin to void a draft replacement invoice directly without payment reversal', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      const replacement = await request(app.getHttpServer())
        .post(`/api/invoices/${invoice.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      expect(replacement.body.status).toBe('DRAFT');

      // Void the draft replacement directly
      const voided = await request(app.getHttpServer())
        .patch(`/api/invoices/${replacement.body.id}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'VOID' })
        .expect(200);

      expect(voided.body.status).toBe('VOID');

      // Cannot transition out of VOID
      await request(app.getHttpServer())
        .patch(`/api/invoices/${replacement.body.id}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'ISSUED' })
        .expect(400);
    });

    it('should assign final invoice number at issuance of draft replacement', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      const draftInvoice = await request(app.getHttpServer())
        .post(`/api/invoices/${invoice.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      // Draft replacement should have temporary number
      expect(draftInvoice.body.invoiceNumber).toMatch(/^DRAFT-/);

      // After issuance, should have final number
      const issuedInvoice = await request(app.getHttpServer())
        .patch(`/api/invoices/${draftInvoice.body.id}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'ISSUED' })
        .expect(200);

      expect(issuedInvoice.body.invoiceNumber).toMatch(/^INV-\d{6}$/);
    });

    it('should reject repeated issuance of already issued invoice', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      // Normal invoice is already ISSUED upon creation
      const issuedInvoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          visitId: visit.id,
          paymentMethod: 'KNET',
          items: [{ serviceId: testServiceAId, quantity: 1 }],
        })
        .expect(201);

      expect(issuedInvoice.body.status).toBe('ISSUED');

      const originalInvoiceNumber = issuedInvoice.body.invoiceNumber;
      const originalIssuedAt = issuedInvoice.body.issuedAt;
      const originalIssuedById = issuedInvoice.body.issuedById;

      // Re-issuance should be rejected
      const secondIssuance = await request(app.getHttpServer())
        .patch(`/api/invoices/${issuedInvoice.body.id}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'ISSUED' })
        .expect(400);

      expect(secondIssuance.body.message).toBe('Invoice is already issued and cannot be re-issued');

      // Verify invoice data unchanged
      const unchangedInvoice = await request(app.getHttpServer())
        .get(`/api/invoices/${issuedInvoice.body.id}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(unchangedInvoice.body.invoiceNumber).toBe(originalInvoiceNumber);
      expect(unchangedInvoice.body.issuedAt).toBe(originalIssuedAt);
      expect(unchangedInvoice.body.issuedById).toBe(originalIssuedById);
    });

    it('serializes concurrent issuance of the same draft without overwriting issuance metadata', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ visitId: visit.id, paymentMethod: 'KNET', items: [{ serviceId: testServiceAId, quantity: 1 }] })
        .expect(201);

      const draft = await request(app.getHttpServer())
        .post(`/api/invoices/${invoice.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ items: [{ serviceId: testServiceAId, quantity: 1 }] })
        .expect(201);

      const [first, second] = await Promise.all([
        request(app.getHttpServer()).patch(`/api/invoices/${draft.body.id}/status`).set('Authorization', `Bearer ${adminAccessToken}`).send({ status: 'ISSUED' }),
        request(app.getHttpServer()).patch(`/api/invoices/${draft.body.id}/status`).set('Authorization', `Bearer ${adminAccessToken}`).send({ status: 'ISSUED' }),
      ]);
      const succeeded = [first, second].filter((response) => response.status === 200);
      const rejected = [first, second].filter((response) => response.status === 400);
      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const persisted = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.body.id } });
      expect(persisted.status).toBe('ISSUED');
      expect(persisted.invoiceNumber).toBe(succeeded[0].body.invoiceNumber);
      expect(persisted.issuedAt?.toISOString()).toBe(new Date(succeeded[0].body.issuedAt).toISOString());
      expect(persisted.issuedById).toBe(succeeded[0].body.issuedById);
    });

    it('should generate unique sequential invoice numbers on invoice creation', async () => {
      const visits = await Promise.all([
        prisma.visit.create({ data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId } }),
        prisma.visit.create({ data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId } }),
      ]);

      const invoice1 = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ visitId: visits[0].id, paymentMethod: 'KNET', items: [{ serviceId: testServiceAId, quantity: 1 }] })
        .expect(201);

      const invoice2 = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ visitId: visits[1].id, paymentMethod: 'KNET', items: [{ serviceId: testServiceAId, quantity: 1 }] })
        .expect(201);

      // Both invoices are immediately assigned sequential numbers
      const num1 = parseInt(invoice1.body.invoiceNumber.replace('INV-', ''), 10);
      const num2 = parseInt(invoice2.body.invoiceNumber.replace('INV-', ''), 10);
      expect(Math.abs(num1 - num2)).toBe(1);
    });

    it('should assign invoice number transactionally with status change on draft issuance', async () => {
      const visit = await prisma.visit.create({
        data: { patientId: testPatientId, type: 'OTHER', createdById: adminUserId },
      });

      const invoice = await request(app.getHttpServer())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ visitId: visit.id, paymentMethod: 'KNET', items: [{ serviceId: testServiceAId, quantity: 1 }] })
        .expect(201);

      const draftInvoice = await request(app.getHttpServer())
        .post(`/api/invoices/${invoice.body.id}/replacement`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ items: [{ serviceId: testServiceAId, quantity: 1 }] })
        .expect(201);

      // Verify draft has temporary number
      expect(draftInvoice.body.invoiceNumber).toMatch(/^DRAFT-/);
      expect(draftInvoice.body.status).toBe('DRAFT');

      // Issue the draft replacement - this should allocate final number and change status atomically
      const issuedInvoice = await request(app.getHttpServer())
        .patch(`/api/invoices/${draftInvoice.body.id}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: 'ISSUED' })
        .expect(200);

      // Verify both status and number changed together (atomic transaction)
      expect(issuedInvoice.body.status).toBe('ISSUED');
      expect(issuedInvoice.body.invoiceNumber).toMatch(/^INV-\d{6}$/);
      expect(issuedInvoice.body.issuedAt).toBeTruthy();
      expect(issuedInvoice.body.issuedById).toBeTruthy();

      // Verify the number is not the temporary draft number
      expect(issuedInvoice.body.invoiceNumber).not.toBe(draftInvoice.body.invoiceNumber);
    });
  });

  describe('Concurrency-Safe Invoice Numbering', () => {
    // Empty - tests moved to main describe block
  });
});
