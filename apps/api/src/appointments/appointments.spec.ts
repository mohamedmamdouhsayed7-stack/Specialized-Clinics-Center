import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { AppointmentStatus } from '@prisma/client';
import { cleanupTestData } from '../test-utils';

describe('Appointments Module Tests (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminUserId: string;
  let receptionistUserId: string;
  let testPatientId: string;
  let testAppointmentId: string;
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

    // Clean up test data using shared utility (scoped to appointments test users)
    await cleanupTestData(prisma, '.appointments@test.com');

    // Create admin user
    const adminPasswordHash = await argon2.hash('admin123');
    const admin = await prisma.user.create({
      data: {
        email: 'testadmin.appointments@test.com',
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
        email: 'testreceptionist.appointments@test.com',
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
        civilId: '12345670002',
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
        email: 'testadmin.appointments@test.com',
        password: 'admin123',
      });
    adminAccessToken = adminResponse.body.accessToken;

    const receptionistResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'testreceptionist.appointments@test.com',
        password: 'receptionist123',
      });
    receptionistAccessToken = receptionistResponse.body.accessToken;
  });

  afterAll(async () => {
    // Clean up test data using shared utility (scoped to appointments test users)
    await cleanupTestData(prisma, '.appointments@test.com');
    await app.close();
  });

  describe('Appointment Creation', () => {
    it('should create appointment as admin', async () => {
      const scheduledAt = new Date();
      scheduledAt.setDate(scheduledAt.getDate() + 1);
      scheduledAt.setHours(10, 0, 0, 0);

      const response = await request(app.getHttpServer())
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          patientId: testPatientId,
          scheduledAt: scheduledAt.toISOString(),
          notes: 'Test appointment',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.status).toBe(AppointmentStatus.BOOKED);
      expect(response.body.patientId).toBe(testPatientId);
      testAppointmentId = response.body.id;
    });

    it('should create appointment as receptionist', async () => {
      const scheduledAt = new Date();
      scheduledAt.setDate(scheduledAt.getDate() + 2);
      scheduledAt.setHours(14, 0, 0, 0);

      const response = await request(app.getHttpServer())
        .post('/api/appointments')
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .send({
          patientId: testPatientId,
          scheduledAt: scheduledAt.toISOString(),
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.status).toBe(AppointmentStatus.BOOKED);
    });

    it('should reject appointment for non-existent patient', async () => {
      const scheduledAt = new Date();
      scheduledAt.setDate(scheduledAt.getDate() + 1);
      scheduledAt.setHours(10, 0, 0, 0);

      const response = await request(app.getHttpServer())
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          patientId: '00000000-0000-0000-0000-000000000000',
          scheduledAt: scheduledAt.toISOString(),
        })
        .expect(404);

      expect(response.body.message).toContain('Patient not found');
    });

    it('should reject unauthenticated appointment creation', async () => {
      const scheduledAt = new Date();
      scheduledAt.setDate(scheduledAt.getDate() + 1);
      scheduledAt.setHours(10, 0, 0, 0);

      await request(app.getHttpServer())
        .post('/api/appointments')
        .send({
          patientId: testPatientId,
          scheduledAt: scheduledAt.toISOString(),
        })
        .expect(401);
    });

    it('should validate required fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          notes: 'Test',
        })
        .expect(400);

      expect(response.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('patientId'),
          expect.stringContaining('scheduledAt'),
        ])
      );
    });
  });

  describe('Appointment Retrieval', () => {
    it('should get appointment by ID as admin', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/appointments/${testAppointmentId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.id).toBe(testAppointmentId);
      expect(response.body).toHaveProperty('patient');
      expect(response.body.patient).toHaveProperty('civilId');
    });

    it('should get appointment by ID as receptionist', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/appointments/${testAppointmentId}`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .expect(200);

      expect(response.body.id).toBe(testAppointmentId);
    });

    it('should reject unauthenticated appointment retrieval', async () => {
      await request(app.getHttpServer())
        .get(`/api/appointments/${testAppointmentId}`)
        .expect(401);
    });

    it('should return 404 for non-existent appointment', async () => {
      await request(app.getHttpServer())
        .get('/api/appointments/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(404);
    });
  });

  describe('Appointment Search and List', () => {
    it('should list all appointments as admin', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/appointments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('meta');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should list all appointments as receptionist', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/appointments')
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should filter by date', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      const response = await request(app.getHttpServer())
        .get(`/api/appointments?date=${dateStr}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
    });

    it('should filter by status', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/appointments?status=${AppointmentStatus.BOOKED}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      response.body.data.forEach((apt: any) => {
        expect(apt.status).toBe(AppointmentStatus.BOOKED);
      });
    });

    it('should filter by patient', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/appointments?patientId=${testPatientId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      response.body.data.forEach((apt: any) => {
        expect(apt.patientId).toBe(testPatientId);
      });
    });

    it('should support pagination', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/appointments?page=1&limit=1')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('meta');
      expect(response.body.meta.page).toBe(1);
      expect(response.body.meta.limit).toBe(1);
      expect(response.body.data.length).toBeLessThanOrEqual(1);
    });

    it('should reject unauthenticated appointment list', async () => {
      await request(app.getHttpServer())
        .get('/api/appointments')
        .expect(401);
    });
  });

  describe('Appointment Update', () => {
    it('should update appointment as admin', async () => {
      const scheduledAt = new Date();
      scheduledAt.setDate(scheduledAt.getDate() + 3);
      scheduledAt.setHours(16, 0, 0, 0);

      const response = await request(app.getHttpServer())
        .patch(`/api/appointments/${testAppointmentId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          scheduledAt: scheduledAt.toISOString(),
          notes: 'Updated notes',
        })
        .expect(200);

      expect(response.body.notes).toBe('Updated notes');
    });

    it('should update appointment as receptionist', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/appointments/${testAppointmentId}`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .send({
          notes: 'Receptionist update',
        })
        .expect(200);

      expect(response.body.notes).toBe('Receptionist update');
    });

    it('should reject unauthenticated appointment update', async () => {
      await request(app.getHttpServer())
        .patch(`/api/appointments/${testAppointmentId}`)
        .send({ notes: 'Test' })
        .expect(401);
    });
  });

  describe('Status Transitions', () => {
    it('should transition from BOOKED to CONFIRMED', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/appointments/${testAppointmentId}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: AppointmentStatus.CONFIRMED })
        .expect(200);

      expect(response.body.status).toBe(AppointmentStatus.CONFIRMED);
    });

    it('should transition from CONFIRMED to DONE', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/appointments/${testAppointmentId}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: AppointmentStatus.DONE })
        .expect(200);

      expect(response.body.status).toBe(AppointmentStatus.DONE);
    });

    it('should reject invalid status transition (DONE to BOOKED)', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/appointments/${testAppointmentId}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ status: AppointmentStatus.BOOKED })
        .expect(400);

      expect(response.body.message).toContain('Cannot transition');
    });

    it('should reject unauthenticated status change', async () => {
      await request(app.getHttpServer())
        .patch(`/api/appointments/${testAppointmentId}/status`)
        .send({ status: AppointmentStatus.CONFIRMED })
        .expect(401);
    });
  });

  describe('Appointment Cancellation', () => {
    let cancellableAppointmentId: string;

    beforeAll(async () => {
      // Create a new appointment for cancellation tests
      const scheduledAt = new Date();
      scheduledAt.setDate(scheduledAt.getDate() + 5);
      scheduledAt.setHours(11, 0, 0, 0);

      const appointment = await prisma.appointment.create({
        data: {
          patientId: testPatientId,
          scheduledAt,
          status: AppointmentStatus.BOOKED,
          createdById: adminUserId,
        },
      });
      cancellableAppointmentId = appointment.id;
    });

    it('should cancel appointment with reason', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/appointments/${cancellableAppointmentId}/cancel`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ reason: 'Patient request' })
        .expect(200);

      expect(response.body.status).toBe(AppointmentStatus.CANCELLED);
    });

    it('should cancel appointment without reason', async () => {
      const scheduledAt = new Date();
      scheduledAt.setDate(scheduledAt.getDate() + 6);
      scheduledAt.setHours(12, 0, 0, 0);

      const appointment = await prisma.appointment.create({
        data: {
          patientId: testPatientId,
          scheduledAt,
          status: AppointmentStatus.BOOKED,
          createdById: adminUserId,
        },
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/appointments/${appointment.id}/cancel`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({})
        .expect(200);

      expect(response.body.status).toBe(AppointmentStatus.CANCELLED);
    });

    it('should reject cancellation of DONE appointment', async () => {
      const scheduledAt = new Date();
      scheduledAt.setDate(scheduledAt.getDate() + 7);
      scheduledAt.setHours(13, 0, 0, 0);

      const appointment = await prisma.appointment.create({
        data: {
          patientId: testPatientId,
          scheduledAt,
          status: AppointmentStatus.DONE,
          createdById: adminUserId,
        },
      });

      await request(app.getHttpServer())
        .patch(`/api/appointments/${appointment.id}/cancel`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ reason: 'Test' })
        .expect(400);
    });

    it('should reject unauthenticated cancellation', async () => {
      await request(app.getHttpServer())
        .patch(`/api/appointments/${cancellableAppointmentId}/cancel`)
        .send({ reason: 'Test' })
        .expect(401);
    });
  });

  describe('Archived Patient Handling', () => {
    let archivedPatientId: string;

    beforeAll(async () => {
      // Create and archive a patient
      const patient = await prisma.patient.create({
        data: {
          civilId: '98765432109',
          fullNameAr: 'مريم علي',
          isArchived: true,
          createdById: adminUserId,
        },
      });
      archivedPatientId = patient.id;
    });

    it('should reject appointment creation for archived patient', async () => {
      const scheduledAt = new Date();
      scheduledAt.setDate(scheduledAt.getDate() + 8);
      scheduledAt.setHours(15, 0, 0, 0);

      const response = await request(app.getHttpServer())
        .post('/api/appointments')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          patientId: archivedPatientId,
          scheduledAt: scheduledAt.toISOString(),
        })
        .expect(400);

      expect(response.body.message).toContain('archived');
    });
  });

  describe('Appointment Permanent Delete Authorization', () => {
    it('allows admins, rejects receptionists, and rejects unauthenticated users', async () => {
      const appointment = await prisma.appointment.create({
        data: {
          patientId: testPatientId,
          scheduledAt: new Date(Date.now() + 86400000),
          status: AppointmentStatus.CANCELLED,
          createdById: adminUserId,
        },
      });

      await request(app.getHttpServer())
        .delete(`/api/appointments/${appointment.id}/permanent`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/api/appointments/${appointment.id}/permanent`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/appointments/${appointment.id}/permanent`)
        .expect(401);
    });
  });

  describe('Audit Logging', () => {
    it('should log appointment creation', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          userId: adminUserId,
          entityType: 'Appointment',
          action: 'CREATE',
        },
      });

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should log appointment update', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          userId: adminUserId,
          entityType: 'Appointment',
          action: 'UPDATE',
        },
      });

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should log status change', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          userId: adminUserId,
          entityType: 'Appointment',
          action: 'STATUS_CHANGE',
        },
      });

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should log cancellation', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          userId: adminUserId,
          entityType: 'Appointment',
          action: 'CANCEL',
        },
      });

      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
