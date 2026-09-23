import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { VisitStatus, VisitType } from '@prisma/client';
import { cleanupTestData } from '../test-utils';

describe('Visits Module Tests (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminUserId: string;
  let receptionistUserId: string;
  let testPatientId: string;
  let testVisitId: string;
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

    // Clean up test data using shared utility (scoped to visits test users)
    await cleanupTestData(prisma, '.visits@test.com');

    // Create admin user
    const adminPasswordHash = await argon2.hash('admin123');
    const admin = await prisma.user.create({
      data: {
        email: 'testadmin.visits@test.com',
        passwordHash: adminPasswordHash,
        name: 'Test Admin',
        role: 'ADMIN',
        isActive: true,
      },
    });
    adminUserId = admin.id;

    // Create receptionist user
    const receptionistPasswordHash = await argon2.hash('receptionist123');
    const receptionist = await prisma.user.create({
      data: {
        email: 'testreceptionist.visits@test.com',
        passwordHash: receptionistPasswordHash,
        name: 'Test Receptionist',
        role: 'RECEPTIONIST',
        isActive: true,
      },
    });
    receptionistUserId = receptionist.id;

    // Create test patient
    const patient = await prisma.patient.create({
      data: {
        civilId: '12345670003',
        fullNameAr: 'سارة أحمد',
        fullNameEn: 'Sara Ahmed',
        phone: '99912345',
        createdById: adminUserId,
      },
    });
    testPatientId = patient.id;

    // Get tokens once for all tests
    const adminResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'testadmin.visits@test.com',
        password: 'admin123',
      });
    adminAccessToken = adminResponse.body.accessToken;

    const receptionistResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'testreceptionist.visits@test.com',
        password: 'receptionist123',
      });
    receptionistAccessToken = receptionistResponse.body.accessToken;
  });

  afterAll(async () => {
    // Clean up test data using shared utility (scoped to visits test users)
    await cleanupTestData(prisma, '.visits@test.com');
    await app.close();
  });

  describe('Visit Creation', () => {
    it('should create visit as admin', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          patientId: testPatientId,
          type: VisitType.CHECKUP,
          notes: 'Test visit',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.type).toBe(VisitType.CHECKUP);
      expect(response.body.patientId).toBe(testPatientId);
      testVisitId = response.body.id;
    });

    it('should create walk-in visit as receptionist', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .send({
          patientId: testPatientId,
          type: VisitType.FOLLOW_UP,
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.type).toBe(VisitType.FOLLOW_UP);
    });

    it('should create visit linked to appointment', async () => {
      // Create test appointment inline
      const scheduledAt = new Date();
      scheduledAt.setDate(scheduledAt.getDate() + 1);
      scheduledAt.setHours(10, 0, 0, 0);

      const appointment = await prisma.appointment.create({
        data: {
          patientId: testPatientId,
          scheduledAt,
          status: 'BOOKED',
          createdById: adminUserId,
        },
      });

      const response = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          patientId: testPatientId,
          appointmentId: appointment.id,
          type: VisitType.CHECKUP,
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.appointmentId).toBe(appointment.id);
    });

    it('should reject visit for non-existent patient', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          patientId: '00000000-0000-0000-0000-000000000000',
          type: VisitType.CHECKUP,
        })
        .expect(404);

      expect(response.body.message).toContain('Patient not found');
    });

    it('should reject visit for archived patient', async () => {
      // Create and archive a patient
      const patient = await prisma.patient.create({
        data: {
          civilId: '98765432199',
          fullNameAr: 'مريم علي',
          isArchived: true,
          createdById: adminUserId,
        },
      });

      const response = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          patientId: patient.id,
          type: VisitType.CHECKUP,
        })
        .expect(400);

      expect(response.body.message).toContain('archived');
    });

    it('should reject visit with non-existent appointment', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          patientId: testPatientId,
          appointmentId: '00000000-0000-0000-0000-000000000000',
          type: VisitType.CHECKUP,
        })
        .expect(404);

      expect(response.body.message).toContain('Appointment not found');
    });

    it('should reject visit with appointment belonging to different patient', async () => {
      // Create another patient and appointment
      const otherPatient = await prisma.patient.create({
        data: {
          civilId: '11111111111',
          fullNameAr: 'فاطمة محمد',
          createdById: adminUserId,
        },
      });

      const scheduledAt = new Date();
      scheduledAt.setDate(scheduledAt.getDate() + 2);
      const otherAppointment = await prisma.appointment.create({
        data: {
          patientId: otherPatient.id,
          scheduledAt,
          status: 'BOOKED',
          createdById: adminUserId,
        },
      });

      const response = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          patientId: testPatientId,
          appointmentId: otherAppointment.id,
          type: VisitType.CHECKUP,
        })
        .expect(400);

      expect(response.body.message).toContain('does not belong to this patient');
    });

    it('should reject invalid visit type', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          patientId: testPatientId,
          type: 'INVALID_TYPE',
        })
        .expect(400);
    });

    it('should reject unauthenticated visit creation', async () => {
      await request(app.getHttpServer())
        .post('/api/visits')
        .send({
          patientId: testPatientId,
          type: VisitType.CHECKUP,
        })
        .expect(401);
    });

    it('should validate required fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          notes: 'Test',
        })
        .expect(400);

      expect(response.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('patientId'),
          expect.stringContaining('type'),
        ])
      );
    });
  });

  describe('Visit Retrieval', () => {
    it('should get visit by ID as admin', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/visits/${testVisitId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.id).toBe(testVisitId);
      expect(response.body).toHaveProperty('patient');
      expect(response.body.patient).toHaveProperty('civilId');
    });

    it('should get visit by ID as receptionist', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/visits/${testVisitId}`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .expect(200);

      expect(response.body.id).toBe(testVisitId);
    });

    it('should reject unauthenticated visit retrieval', async () => {
      await request(app.getHttpServer())
        .get(`/api/visits/${testVisitId}`)
        .expect(401);
    });

    it('should return 404 for non-existent visit', async () => {
      await request(app.getHttpServer())
        .get('/api/visits/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(404);
    });
  });

  describe('Visit Search and List', () => {
    it('should list all visits as admin', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/visits')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('meta');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should list all visits as receptionist', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/visits')
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should filter by patient', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/visits?patientId=${testPatientId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      response.body.data.forEach((visit: any) => {
        expect(visit.patientId).toBe(testPatientId);
      });
    });

    it('should filter by appointment', async () => {
      // Create test appointment inline
      const scheduledAt = new Date();
      scheduledAt.setDate(scheduledAt.getDate() + 1);
      scheduledAt.setHours(10, 0, 0, 0);

      const appointment = await prisma.appointment.create({
        data: {
          patientId: testPatientId,
          scheduledAt,
          status: 'BOOKED',
          createdById: adminUserId,
        },
      });

      const response = await request(app.getHttpServer())
        .get(`/api/visits?appointmentId=${appointment.id}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
    });

    it('should filter by type', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/visits?type=${VisitType.CHECKUP}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      response.body.data.forEach((visit: any) => {
        expect(visit.type).toBe(VisitType.CHECKUP);
      });
    });

    it('should filter by date range', async () => {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = today.toISOString().split('T')[0];
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      const response = await request(app.getHttpServer())
        .get(`/api/visits?from=${dateStr}&to=${tomorrowStr}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
    });

    it('should include follow-up visits throughout an end date', async () => {
      const visitDate = new Date(2026, 8, 9, 12, 0, 0, 0);
      const visit = await prisma.visit.create({
        data: {
          patientId: testPatientId,
          type: VisitType.FOLLOW_UP,
          visitDate,
          createdById: adminUserId,
        },
      });

      const response = await request(app.getHttpServer())
        .get('/api/visits?type=FOLLOW_UP&from=2026-09-09&to=2026-09-09')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.data.some((item: { id: string }) => item.id === visit.id)).toBe(true);
    });

    it('should support pagination', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/visits?page=1&limit=1')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('meta');
      expect(response.body.meta.page).toBe(1);
      expect(response.body.meta.limit).toBe(1);
      expect(response.body.data.length).toBeLessThanOrEqual(1);
    });

    it('should reject unauthenticated visit list', async () => {
      await request(app.getHttpServer())
        .get('/api/visits')
        .expect(401);
    });
  });

  describe('Visit Update', () => {
    it('should update visit as admin', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/visits/${testVisitId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          notes: 'Updated notes',
        })
        .expect(200);

      expect(response.body.notes).toBe('Updated notes');
    });

    it('should update visit as receptionist', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/visits/${testVisitId}`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .send({
          type: VisitType.FOLLOW_UP,
        })
        .expect(200);

      expect(response.body.type).toBe(VisitType.FOLLOW_UP);
    });

    it('should reject changing patient after creation', async () => {
      const otherPatient = await prisma.patient.create({
        data: {
          civilId: '22222222222',
          fullNameAr: 'خالد محمد',
          createdById: adminUserId,
        },
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/visits/${testVisitId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          patientId: otherPatient.id,
        })
        .expect(400);

      expect(response.body.message).toContain('Cannot change patient');
    });

    it('should reject unauthenticated visit update', async () => {
      await request(app.getHttpServer())
        .patch(`/api/visits/${testVisitId}`)
        .send({ notes: 'Test' })
        .expect(401);
    });
  });

  describe('Historical Visit Date Support', () => {
    it('should support historical visitDate', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 30);

      const response = await request(app.getHttpServer())
        .post('/api/visits')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          patientId: testPatientId,
          type: VisitType.OTHER,
          visitDate: pastDate.toISOString(),
        })
        .expect(201);

      expect(new Date(response.body.visitDate).getTime()).toBeLessThan(Date.now());
    });
  });

  describe('Visit Permanent Delete Authorization', () => {
    it('allows admins, rejects receptionists, and rejects unauthenticated users', async () => {
      const visit = await prisma.visit.create({
        data: {
          patientId: testPatientId,
          type: VisitType.OTHER,
          status: VisitStatus.CANCELLED,
          visitDate: new Date(),
          createdById: adminUserId,
        },
      });

      await request(app.getHttpServer())
        .delete(`/api/visits/${visit.id}/permanent`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/api/visits/${visit.id}/permanent`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/visits/${visit.id}/permanent`)
        .expect(401);
    });
  });

  describe('Audit Logging', () => {
    it('should log visit creation', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          userId: adminUserId,
          entityType: 'Visit',
          action: 'CREATE',
        },
      });

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should log visit update', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          userId: adminUserId,
          entityType: 'Visit',
          action: 'UPDATE',
        },
      });

      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
