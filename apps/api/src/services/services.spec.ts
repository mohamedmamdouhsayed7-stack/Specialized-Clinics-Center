import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { cleanupTestData } from '../test-utils';

describe('Services Module Tests (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminUserId: string;
  let receptionistUserId: string;
  let testServiceId: string;
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

    // Clean up test data using shared utility (scoped to services test users)
    await cleanupTestData(prisma, '.services@test.com');

    // Create admin user
    const adminPasswordHash = await argon2.hash('admin123');
    const admin = await prisma.user.create({
      data: {
        email: 'testadmin.services@test.com',
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
        email: 'testreceptionist.services@test.com',
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
        email: 'testadmin.services@test.com',
        password: 'admin123',
      });
    adminAccessToken = adminResponse.body.accessToken;

    const receptionistResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'testreceptionist.services@test.com',
        password: 'receptionist123',
      });
    receptionistAccessToken = receptionistResponse.body.accessToken;
  });

  afterAll(async () => {
    // Clean up test data using shared utility (scoped to services test users)
    await cleanupTestData(prisma, '.services@test.com');
    await app.close();
  });

  describe('Service Creation', () => {
    it('should create service as admin', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          name: 'كشف عام',
          currentPrice: 30.00,
          description: 'فحص عام للمرضى',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('كشف عام');
      expect(parseFloat(response.body.currentPrice)).toBe(30.00);
      expect(response.body.isActive).toBe(true);
      testServiceId = response.body.id;
    });

    it('should reject service creation by receptionist', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .send({
          name: 'خدمة تجريبية',
          currentPrice: 50.00,
        })
        .expect(403);

      expect(response.body.message).toContain('Forbidden');
    });

    it('should reject unauthenticated service creation', async () => {
      await request(app.getHttpServer())
        .post('/api/services')
        .send({
          name: 'خدمة تجريبية',
          currentPrice: 50.00,
        })
        .expect(401);
    });

    it('should validate required name field', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          currentPrice: 30.00,
        })
        .expect(400);

      expect(response.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('name'),
        ])
      );
    });

    it('should validate required price field', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          name: 'خدمة',
        })
        .expect(400);

      expect(response.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('currentPrice'),
        ])
      );
    });

    it('should reject negative price', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          name: 'خدمة',
          currentPrice: -10.00,
        })
        .expect(400);

      expect(response.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('currentPrice'),
        ])
      );
    });

    it('should accept zero price', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          name: 'خدمة مجانية',
          currentPrice: 0,
        })
        .expect(201);

      expect(parseFloat(response.body.currentPrice)).toBe(0);
    });

    it('should reject prices with more than two decimal places', async () => {
      await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ name: 'Three decimal service', currentPrice: 1.001 })
        .expect(400);
    });

    it('should trim service name', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          name: '  خدمة مع مسافات  ',
          currentPrice: 25.00,
        })
        .expect(201);

      expect(response.body.name).toBe('خدمة مع مسافات');
    });
  });

  describe('Service Retrieval', () => {
    it('should get service by ID as admin', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/services/${testServiceId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.id).toBe(testServiceId);
      expect(response.body).toHaveProperty('createdBy');
    });

    it('should get service by ID as receptionist', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/services/${testServiceId}`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .expect(200);

      expect(response.body.id).toBe(testServiceId);
    });

    it('should reject unauthenticated service retrieval', async () => {
      await request(app.getHttpServer())
        .get(`/api/services/${testServiceId}`)
        .expect(401);
    });

    it('should return 404 for non-existent service', async () => {
      await request(app.getHttpServer())
        .get('/api/services/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(404);
    });
  });

  describe('Service Search and List', () => {
    it('should list all services as admin', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/services')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('meta');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should list all services as receptionist', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/services')
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should search by service name', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/services?search=كشف')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      response.body.data.forEach((service: any) => {
        expect(service.name).toContain('كشف');
      });
    });

    it('should filter by active status', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/services?isActive=true')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      response.body.data.forEach((service: any) => {
        expect(service.isActive).toBe(true);
      });
    });

    it('should filter by inactive status', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/services?isActive=false')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      response.body.data.forEach((service: any) => {
        expect(service.isActive).toBe(false);
      });
    });

    it('should support pagination', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/services?page=1&limit=1')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('meta');
      expect(response.body.meta.page).toBe(1);
      expect(response.body.meta.limit).toBe(1);
      expect(response.body.data.length).toBeLessThanOrEqual(1);
    });

    it('should reject unauthenticated service list', async () => {
      await request(app.getHttpServer())
        .get('/api/services')
        .expect(401);
    });

    it('should sort active services first', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/services')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      const data = response.body.data;
      // Active services should come before inactive
      let foundInactive = false;
      for (const service of data) {
        if (!service.isActive) {
          foundInactive = true;
        } else if (foundInactive) {
          // Found an active service after an inactive one - fail
          expect(false).toBe(true);
        }
      }
    });
  });

  describe('Service Update', () => {
    it('should update service as admin', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/services/${testServiceId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          name: 'كشف عام محدث',
          currentPrice: 35.00,
        })
        .expect(200);

      expect(response.body.name).toBe('كشف عام محدث');
      expect(parseFloat(response.body.currentPrice)).toBe(35.00);
    });

    it('should reject service update by receptionist', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/services/${testServiceId}`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .send({
          name: 'خدمة معدلة',
        })
        .expect(403);

      expect(response.body.message).toContain('Forbidden');
    });

    it('should reject unauthenticated service update', async () => {
      await request(app.getHttpServer())
        .patch(`/api/services/${testServiceId}`)
        .send({ name: 'خدمة' })
        .expect(401);
    });

    it('should handle decimal price correctly', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/services/${testServiceId}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          currentPrice: 45.50,
        })
        .expect(200);

      expect(parseFloat(response.body.currentPrice)).toBe(45.50);
    });
  });

  describe('Service Status Update (Activate/Deactivate)', () => {
    it('should deactivate service as admin', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/services/${testServiceId}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          isActive: false,
        })
        .expect(200);

      expect(response.body.isActive).toBe(false);
    });

    it('should activate service as admin', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/services/${testServiceId}/status`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          isActive: true,
        })
        .expect(200);

      expect(response.body.isActive).toBe(true);
    });

    it('should reject status update by receptionist', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/services/${testServiceId}/status`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .send({
          isActive: false,
        })
        .expect(403);

      expect(response.body.message).toContain('Forbidden');
    });

    it('should reject unauthenticated status update', async () => {
      await request(app.getHttpServer())
        .patch(`/api/services/${testServiceId}/status`)
        .send({ isActive: false })
        .expect(401);
    });
  });

  describe('Service Permanent Delete Authorization', () => {
    it('allows admins, rejects receptionists, and rejects unauthenticated users', async () => {
      const service = await prisma.service.create({
        data: {
          name: 'Permanent Delete Test Service',
          code: 'DELETE-TEST',
          currentPrice: 10,
          createdById: adminUserId,
        },
      });

      await request(app.getHttpServer())
        .delete(`/api/services/${service.id}/permanent`)
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/api/services/${service.id}/permanent`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/services/${service.id}/permanent`)
        .expect(401);
    });
  });

  describe('Audit Logging', () => {
    it('should log service creation', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          userId: adminUserId,
          entityType: 'Service',
          action: 'CREATE',
        },
      });

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should log service update', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          userId: adminUserId,
          entityType: 'Service',
          action: 'UPDATE',
        },
      });

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should log service deactivation', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          userId: adminUserId,
          entityType: 'Service',
          action: 'DEACTIVATE',
        },
      });

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should log service activation', async () => {
      const logs = await prisma.auditLog.findMany({
        where: {
          userId: adminUserId,
          entityType: 'Service',
          action: 'ACTIVATE',
        },
      });

      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
