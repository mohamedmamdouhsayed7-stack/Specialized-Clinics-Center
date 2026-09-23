import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { cleanupTestData } from '../test-utils';

describe('Patients Module Tests (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminUserId: string;
  let receptionistUserId: string;
  let testPatientId: string;
  let legacyPatientId: string;
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

    // Clean up test data using shared utility (scoped to patients test users)
    await cleanupTestData(prisma, '.patients@test.com');

    // Create admin user
    const adminPasswordHash = await argon2.hash('admin123');
    const admin = await prisma.user.create({
      data: {
        email: 'testadmin.patients@test.com',
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
        email: 'testreceptionist.patients@test.com',
        passwordHash: receptionistPasswordHash,
        name: 'Test Receptionist',
        role: 'RECEPTIONIST',
        isActive: true,
      },
    });
    receptionistUserId = receptionist.id;

    // Get tokens once for all tests
    const adminResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'testadmin.patients@test.com',
        password: 'admin123',
      });
    adminAccessToken = adminResponse.body.accessToken;

    const receptionistResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'testreceptionist.patients@test.com',
        password: 'receptionist123',
      });
    receptionistAccessToken = receptionistResponse.body.accessToken;
  });

  afterAll(async () => {
    // Clean up test data using shared utility (scoped to patients test users)
    await cleanupTestData(prisma, '.patients@test.com');
    await app.close();
  });

  describe('Patient Creation', () => {
    it('should create patient as admin', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          civilId: '12345678901',
          fullNameAr: 'سارة أحمد',
          fullNameEn: 'Sara Ahmed',
          phone: '99912345',
          dateOfBirth: '1990-01-15T00:00:00Z',
          address: 'الكويت',
        })
        .expect(201);

      expect(response.body.civilId).toBe('12345678901');
      expect(response.body.fullNameAr).toBe('سارة أحمد');
      expect(response.body.id).toBeDefined();
      testPatientId = response.body.id;
    });

    it('should create patient as receptionist', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .send({
          civilId: '12345678902',
          fullNameAr: 'مريم علي',
        })
        .expect(201);

      expect(response.body.civilId).toBe('12345678902');
      expect(response.body.fullNameAr).toBe('مريم علي');
    });

    it('should reject duplicate Civil ID', async () => {
      await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          civilId: '12345678901',
          fullNameAr: 'Another Name',
        })
        .expect(409);
    });

    it('should reject unauthenticated patient creation', async () => {
      await request(app.getHttpServer())
        .post('/api/patients')
        .send({
          civilId: '12345678903',
          fullNameAr: 'Test Name',
        })
        .expect(401);
    });

    it('should validate required fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          fullNameAr: 'Test Name',
        })
        .expect(400);

      expect(response.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('civilId')
        ])
      );
    });
  });

  describe('Patient Retrieval', () => {
    it('should get patient by ID as admin', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/patients/${testPatientId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.id).toBe(testPatientId);
      expect(response.body.civilId).toBe('12345678901');
    });

    it('should get patient by ID as receptionist', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/patients/${testPatientId}`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .expect(200);

      expect(response.body.id).toBe(testPatientId);
    });

    it('should reject unauthenticated patient retrieval', async () => {
      await request(app.getHttpServer())
        .get(`/api/patients/${testPatientId}`)
        .expect(401);
    });

    it('should return 404 for non-existent patient', async () => {
      await request(app.getHttpServer())
        .get('/api/patients/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(404);
    });
  });

  describe('Patient Search and List', () => {
    it('should list all patients as admin', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/patients')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.meta).toBeDefined();
      expect(response.body.meta.total).toBeGreaterThanOrEqual(2);
    });

    it('should list all patients as receptionist', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/patients')
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
    });

    it('should search by Civil ID', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/patients?search=12345678901')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].civilId).toBe('12345678901');
    });

    it('should search by a masked Civil ID pattern and Arabic-Indic digits', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/patients?search=١٢٣٤٥X٧٨٩٠١')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].civilId).toBe('12345678901');
    });

    it('should search by Arabic name', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/patients?search=سارة')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data[0].fullNameAr).toContain('سارة');
    });

    it('should search by English name', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/patients?search=Sara')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should search by phone', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/patients?search=99912345')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter by archived status', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/patients?isArchived=false')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.data.every(p => p.isArchived === false)).toBe(true);
    });

    it('should support pagination', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/patients?page=1&limit=1')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.data.length).toBeLessThanOrEqual(1);
      expect(response.body.meta.page).toBe(1);
      expect(response.body.meta.limit).toBe(1);
    });

    it('should reject unauthenticated patient list', async () => {
      await request(app.getHttpServer())
        .get('/api/patients')
        .expect(401);
    });
  });

  describe('Patient Update', () => {
    it('should allow two legacy patients without Civil IDs and later assign one', async () => {
      const first = await prisma.patient.create({
        data: { civilId: null, fullNameAr: 'Legacy One', createdById: receptionistUserId },
      });
      const second = await prisma.patient.create({
        data: { civilId: null, fullNameAr: 'Legacy Two', createdById: receptionistUserId },
      });
      legacyPatientId = first.id;

      expect(first.civilId).toBeNull();
      expect(second.civilId).toBeNull();

      const response = await request(app.getHttpServer())
        .patch(`/api/patients/${legacyPatientId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ civilId: '12345678905' })
        .expect(200);

      expect(response.body.civilId).toBe('12345678905');
    });

    it('should reject assigning a duplicate Civil ID to a legacy patient', async () => {
      const legacyPatient = await prisma.patient.create({
        data: { civilId: null, fullNameAr: 'Legacy Duplicate', createdById: receptionistUserId },
      });

      await request(app.getHttpServer())
        .patch(`/api/patients/${legacyPatient.id}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ civilId: '12345678901' })
        .expect(409);
    });

    it('should update patient as admin', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/patients/${testPatientId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          phone: '99999999',
        })
        .expect(200);

      expect(response.body.phone).toBe('99999999');
    });

    it('should update patient as receptionist', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/patients/${testPatientId}`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .send({
          address: 'Updated Address',
        })
        .expect(200);

      expect(response.body.address).toBe('Updated Address');
    });

    it('should reject Civil ID conflict on update', async () => {
      await request(app.getHttpServer())
        .patch(`/api/patients/${testPatientId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          civilId: '12345678902',
        })
        .expect(409);
    });

    it('should reject unauthenticated patient update', async () => {
      await request(app.getHttpServer())
        .patch(`/api/patients/${testPatientId}`)
        .send({
          phone: '11111111',
        })
        .expect(401);
    });
  });

  describe('Patient Archive', () => {
    it('should archive patient as admin', async () => {
      const response = await request(app.getHttpServer())
        .put(`/api/patients/${testPatientId}/archive`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.isArchived).toBe(true);
    });

    it('should archive patient as receptionist', async () => {
      // Create a new patient to archive
      const newPatient = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .send({
          civilId: '12345678904',
          fullNameAr: 'Test Patient',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .put(`/api/patients/${newPatient.body.id}/archive`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .expect(200);

      expect(response.body.isArchived).toBe(true);
    });

    it('should exclude archived patients from default list', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/patients?isArchived=false')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      const archivedPatient = response.body.data.find(p => p.id === testPatientId);
      expect(archivedPatient).toBeUndefined();
    });

    it('should include archived patients when filtered', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/patients?isArchived=true')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      const archivedPatient = response.body.data.find(p => p.id === testPatientId);
      expect(archivedPatient).toBeDefined();
      expect(archivedPatient.isArchived).toBe(true);
    });

    it('should reject unauthenticated archive', async () => {
      await request(app.getHttpServer())
        .put(`/api/patients/${testPatientId}/archive`)
        .expect(401);
    });
  });

  describe('Patient Restore', () => {
    it('should restore patient as admin', async () => {
      const response = await request(app.getHttpServer())
        .put(`/api/patients/${testPatientId}/restore`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.isArchived).toBe(false);
    });

    it('should reject restore by receptionist', async () => {
      await request(app.getHttpServer())
        .put(`/api/patients/${testPatientId}/restore`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .expect(403);
    });

    it('should reject unauthenticated restore', async () => {
      await request(app.getHttpServer())
        .put(`/api/patients/${testPatientId}/restore`)
        .expect(401);
    });
  });

  describe('Patient Permanent Delete Authorization', () => {
    it('allows admins, rejects receptionists, and rejects unauthenticated users', async () => {
      const patient = await prisma.patient.create({
        data: {
          civilId: '12345678906',
          fullNameAr: 'Permanent Delete Test',
          createdById: adminUserId,
        },
      });

      await request(app.getHttpServer())
        .delete(`/api/patients/${patient.id}/permanent`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/api/patients/${patient.id}/permanent`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/patients/${patient.id}/permanent`)
        .expect(401);
    });
  });

  describe('Audit Logging', () => {
    it('should log patient creation', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          entityType: 'Patient',
          action: 'PATIENT_CREATED',
        },
      });

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should log patient update', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          entityType: 'Patient',
          action: 'PATIENT_UPDATED',
        },
      });

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should log patient archive', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          entityType: 'Patient',
          action: 'PATIENT_ARCHIVED',
        },
      });

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should log patient restore', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          entityType: 'Patient',
          action: 'PATIENT_RESTORED',
        },
      });

      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
