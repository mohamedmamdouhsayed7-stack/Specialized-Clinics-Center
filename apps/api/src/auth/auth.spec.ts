import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { cleanupTestData } from '../test-utils';

describe('Authentication Security Tests (E2E)', () => {
  jest.setTimeout(120000);
  let app: INestApplication;
  let prisma: PrismaService;
  let adminAccessToken: string;
  let receptionistAccessToken: string;
  let adminUserId: string;
  let receptionistUserId: string;

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

    // Clean up test data using shared utility (auth creates dynamic users, so clean all @test.com)
    await cleanupTestData(prisma);

    // Create admin user
    const adminPasswordHash = await argon2.hash('admin123');
    const admin = await prisma.user.create({
      data: {
        email: 'testadmin.auth@test.com',
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
        email: 'testreceptionist.auth@test.com',
        passwordHash: receptionistPasswordHash,
        name: 'Test Receptionist',
        role: 'RECEPTIONIST',
        isActive: true,
      },
    });
    receptionistUserId = receptionist.id;

    // Create inactive user
    const inactivePasswordHash = await argon2.hash('inactive123');
    await prisma.user.create({
      data: {
        email: 'testinactive@test.com',
        passwordHash: inactivePasswordHash,
        name: 'Test Inactive',
        role: 'RECEPTIONIST',
        isActive: false,
      },
    });
  });

  afterAll(async () => {
    // Clean up test data using shared utility
    await cleanupTestData(prisma);
    await app.close();
  });

  describe('Registration Security', () => {
    it('should reject unauthenticated registration attempts', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: 'unauth@test.com',
          password: 'password123',
          name: 'Test User',
          role: 'ADMIN',
        })
        .expect(401);
    });

    it('should allow authenticated admin to create users', async () => {
      // Login as admin
      const loginResponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'testadmin.auth@test.com',
          password: 'admin123',
        });

      adminAccessToken = loginResponse.body.accessToken;

      // Register new user as admin
      const registerResponse = await request(app.getHttpServer())
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          email: 'newuser@test.com',
          password: 'password123',
          name: 'New User',
          role: 'RECEPTIONIST',
        })
        .expect(201);

      expect(registerResponse.body.email).toBe('newuser@test.com');
    });
  });

  describe('Login Security', () => {
    it('should reject invalid credentials with generic message', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'wrongpassword',
        })
        .expect(401);

      expect(response.body.message).toBe('Invalid credentials');
    });

    it('should reject inactive user login with generic message', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'testinactive@test.com',
          password: 'inactive123',
        })
        .expect(401);

      expect(response.body.message).toBe('Invalid credentials');
    });

    it('should successfully login with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'testadmin.auth@test.com',
          password: 'admin123',
        })
        .expect(200);

      expect(response.body.accessToken).toBeDefined();
      expect(response.body.user).toBeDefined();
      expect(response.body.user.email).toBe('testadmin.auth@test.com');
      adminAccessToken = response.body.accessToken;
    });

    it('should successfully login receptionist', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'testreceptionist.auth@test.com',
          password: 'receptionist123',
        })
        .expect(200);

      expect(response.body.accessToken).toBeDefined();
      receptionistAccessToken = response.body.accessToken;
    });
  });

  describe('Access Token Protection', () => {
    it('should reject requests without access token', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .expect(401);
    });

    it('should reject requests with invalid access token', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should accept requests with valid access token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(response.body.email).toBeDefined();
    });
  });

  describe('RBAC - Admin vs Receptionist', () => {
    it('should allow admin to access user management', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/users')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should forbid receptionist from accessing admin routes', async () => {
      await request(app.getHttpServer())
        .get('/api/users')
        .set('Authorization', `Bearer ${receptionistAccessToken}`)
        .expect(403);
    });
  });

  describe('Refresh Token Security', () => {
    it('should successfully refresh with valid token', async () => {
      const agent = request.agent(app.getHttpServer());

      const loginResponse = await agent
        .post('/api/auth/login')
        .send({
          email: 'testadmin.auth@test.com',
          password: 'admin123',
        })
        .expect(200);

      const refreshResponse = await agent
        .post('/api/auth/refresh')
        .expect(200);

      expect(refreshResponse.body.accessToken).toBeDefined();
      // Verify the new token works by setting it in Authorization header
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${refreshResponse.body.accessToken}`)
        .expect(200);
    });

    it('should restore user data on successful refresh', async () => {
      const agent = request.agent(app.getHttpServer());

      const loginResponse = await agent
        .post('/api/auth/login')
        .send({
          email: 'testadmin.auth@test.com',
          password: 'admin123',
        })
        .expect(200);

      const originalUser = loginResponse.body.user;
      expect(originalUser).toBeDefined();
      expect(originalUser.id).toBeDefined();
      expect(originalUser.email).toBeDefined();
      expect(originalUser.name).toBeDefined();
      expect(originalUser.role).toBeDefined();

      const refreshResponse = await agent
        .post('/api/auth/refresh')
        .expect(200);

      // Verify user data is returned on refresh
      expect(refreshResponse.body.user).toBeDefined();
      expect(refreshResponse.body.user.id).toBe(originalUser.id);
      expect(refreshResponse.body.user.email).toBe(originalUser.email);
      expect(refreshResponse.body.user.name).toBe(originalUser.name);
      expect(refreshResponse.body.user.role).toBe(originalUser.role);
    });

    it('should reject refresh with invalid token', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', 'refreshToken=invalid-token')
        .expect(401);
    });

    it('should reject refresh with expired token', async () => {
      const agent = request.agent(app.getHttpServer());

      const loginResponse = await agent
        .post('/api/auth/login')
        .send({
          email: 'testadmin.auth@test.com',
          password: 'admin123',
        })
        .expect(200);

      const refreshToken = loginResponse.body.refreshToken;

      // Manually expire the token in database
      await prisma.refreshToken.updateMany({
        where: { userId: adminUserId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await agent
        .post('/api/auth/refresh')
        .expect(401);
    });

    it('should reject reuse of old refresh token after rotation', async () => {
      const agent = request.agent(app.getHttpServer());

      const loginResponse = await agent
        .post('/api/auth/login')
        .send({
          email: 'testadmin.auth@test.com',
          password: 'admin123',
        })
        .expect(200);

      const oldRefreshToken = loginResponse.body.refreshToken;

      // First refresh
      await agent
        .post('/api/auth/refresh')
        .expect(200);

      // Try to reuse old token with a new agent (no cookies)
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', `refreshToken=${oldRefreshToken}`)
        .expect(401);
    });

    it('should reject invalid refresh token', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', 'refreshToken=invalid-token')
        .expect(401);
    });

    it('should reject expired refresh token', async () => {
      // Create an expired token in database
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 1);

      const tokenHash = await argon2.hash('expired-token');
      await prisma.refreshToken.create({
        data: {
          token: tokenHash,
          userId: adminUserId,
          expiresAt: expiredDate,
        },
      });

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', 'refreshToken=expired-token')
        .expect(401);
    });

    it('should return 401 on refresh failure with invalid token', async () => {
      // Regression test: verify refresh failure clears auth state properly
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', 'refreshToken=nonexistent-token')
        .expect(401);
    });

    it('should allow multi-device refresh without invalidating other sessions', async () => {
      // Wait for rate limiting window to clear from previous tests
      await new Promise(resolve => setTimeout(resolve, 65000));

      // Simulate Device A login
      const deviceA = request.agent(app.getHttpServer());
      const loginA = await deviceA
        .post('/api/auth/login')
        .send({
          email: 'testadmin.auth@test.com',
          password: 'admin123',
        })
        .expect(200);

      // Simulate Device B login
      const deviceB = request.agent(app.getHttpServer());
      const loginB = await deviceB
        .post('/api/auth/login')
        .send({
          email: 'testadmin.auth@test.com',
          password: 'admin123',
        })
        .expect(200);

      // Refresh Device A's session
      const refreshA = await deviceA
        .post('/api/auth/refresh')
        .expect(200);

      expect(refreshA.body.accessToken).toBeDefined();
      expect(refreshA.body.user).toBeDefined();

      // Device B should still be able to refresh its own session
      const refreshB = await deviceB
        .post('/api/auth/refresh')
        .expect(200);

      expect(refreshB.body.accessToken).toBeDefined();
      expect(refreshB.body.user).toBeDefined();

      // Verify both sessions are still functional
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${refreshA.body.accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${refreshB.body.accessToken}`)
        .expect(200);
    }, 90000);

    it('should invalidate only the rotated refresh token, not other sessions', async () => {
      // Wait for rate limiting window to clear from previous tests
      await new Promise(resolve => setTimeout(resolve, 65000));

      // Device A login
      const deviceA = request.agent(app.getHttpServer());
      const loginA = await deviceA
        .post('/api/auth/login')
        .send({
          email: 'testadmin.auth@test.com',
          password: 'admin123',
        })
        .expect(200);

      const oldRefreshTokenA = loginA.body.refreshToken;

      // Device B login
      const deviceB = request.agent(app.getHttpServer());
      await deviceB
        .post('/api/auth/login')
        .send({
          email: 'testadmin.auth@test.com',
          password: 'admin123',
        })
        .expect(200);

      // Refresh Device A (rotates its token)
      await deviceA
        .post('/api/auth/refresh')
        .expect(200);

      // Old refresh token from Device A should now be invalid
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', `refreshToken=${oldRefreshTokenA}`)
        .expect(401);

      // Device B should still be able to refresh
      await deviceB
        .post('/api/auth/refresh')
        .expect(200);
    }, 90000);

    it('should handle concurrent refresh requests correctly', async () => {
      // Wait for rate limiting window to clear from previous tests
      await new Promise(resolve => setTimeout(resolve, 65000));

      // Login once
      const agent = request.agent(app.getHttpServer());
      await agent
        .post('/api/auth/login')
        .send({
          email: 'testadmin.auth@test.com',
          password: 'admin123',
        })
        .expect(200);

      // Issue concurrent refresh requests
      const [refresh1, refresh2] = await Promise.all([
        agent.post('/api/auth/refresh').expect(200),
        agent.post('/api/auth/refresh').expect(200),
      ]);

      // Both should succeed and return new tokens
      expect(refresh1.body.accessToken).toBeDefined();
      expect(refresh2.body.accessToken).toBeDefined();
      expect(refresh1.body.user).toBeDefined();
      expect(refresh2.body.user).toBeDefined();
    }, 70000);
  });

  describe('Logout Security', () => {
    it('should revoke the rotated refresh token on logout and reject session recovery after reload', async () => {
      const agent = request.agent(app.getHttpServer());
      await agent
        .post('/api/auth/login')
        .send({
          email: 'testadmin.auth@test.com',
          password: 'admin123',
        })
        .expect(200);

      const refreshResponse = await agent
        .post('/api/auth/refresh')
        .expect(200);
      const rotatedCookie = refreshResponse.headers['set-cookie'][0].split(';')[0];

      const logoutResponse = await agent
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${refreshResponse.body.accessToken}`)
        .expect(200);

      expect(logoutResponse.body.message).toBe('Logged out successfully');
      expect(logoutResponse.headers['set-cookie'][0]).toMatch(/refreshToken=; Path=\/; Expires=/i);

      // A browser reload uses the HttpOnly cookie to recover its session.
      // Even if an old cookie value is replayed, its server-side token is revoked.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', rotatedCookie)
        .expect(401);

      // The corresponding page API is protected too when no recovered access token exists.
      await request(app.getHttpServer())
        .get('/api/reports/daily-closing?date=2026-09-25')
        .expect(401);
    });

    it('should invalidate only the logged-out session, not other active sessions', async () => {
      // Wait for rate limiting window to clear from previous tests
      await new Promise(resolve => setTimeout(resolve, 65000));

      // Device A login
      const deviceA = request.agent(app.getHttpServer());
      const loginA = await deviceA
        .post('/api/auth/login')
        .send({
          email: 'testadmin.auth@test.com',
          password: 'admin123',
        })
        .expect(200);

      const accessTokenA = loginA.body.accessToken;

      // Device B login
      const deviceB = request.agent(app.getHttpServer());
      const loginB = await deviceB
        .post('/api/auth/login')
        .send({
          email: 'testadmin.auth@test.com',
          password: 'admin123',
        })
        .expect(200);

      // Logout Device A using the same agent (which has the cookie)
      await deviceA
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessTokenA}`)
        .expect(200);

      // Device A's refresh should now fail
      await deviceA
        .post('/api/auth/refresh')
        .expect(401);

      // Device B should still be able to refresh
      await deviceB
        .post('/api/auth/refresh')
        .expect(200);
    }, 90000);
  });

  describe('Password Security', () => {
    it('should hash passwords with Argon2', async () => {
      const user = await prisma.user.findUnique({
        where: { email: 'testadmin.auth@test.com' },
      });

      expect(user.passwordHash).not.toBe('admin123');
      expect(user.passwordHash.length).toBeGreaterThan(50);
    });

    it('should allow password change with correct current password', async () => {
      // Create a dedicated test user specifically for password change testing
      // This avoids interference from rate limiting accumulated by other tests
      const registerResponse = await request(app.getHttpServer())
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          email: 'testpasswordchange@test.com',
          password: 'oldpassword123',
          name: 'Password Change Test',
          role: 'RECEPTIONIST',
        });

      // Wait for rate limiting window to clear from previous tests
      await new Promise(resolve => setTimeout(resolve, 65000));

      // Login once for this dedicated test user
      const loginResponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'testpasswordchange@test.com',
          password: 'oldpassword123',
        });

      expect(loginResponse.status).toBe(200);
      const testUserAccessToken = loginResponse.body.accessToken;

      // Change password using the dedicated test user's token
      const response = await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${testUserAccessToken}`)
        .send({
          currentPassword: 'oldpassword123',
          newPassword: 'newpassword123',
        })
        .expect(200);

      expect(response.body.message).toBe('Password changed successfully');

      // Verify new password works
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'testpasswordchange@test.com',
          password: 'newpassword123',
        })
        .expect(200);

      // Clean up the dedicated test user
      const testUser = await prisma.user.findUnique({
        where: { email: 'testpasswordchange@test.com' },
        select: { id: true },
      });
      if (testUser) {
        await prisma.auditLog.deleteMany({
          where: { userId: testUser.id },
        });
        await prisma.user.delete({
          where: { email: 'testpasswordchange@test.com' },
        });
      }
    }, 90000);

    it('should reject password change with incorrect current password', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          currentPassword: 'wrongpassword',
          newPassword: 'anotherpassword',
        })
        .expect(401);
    });
  });

  describe('Password Reset Security', () => {
    it('should return generic message for forgot-password regardless of email existence', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({
          email: 'nonexistent@test.com',
        })
        .expect(200);

      expect(response.body.message).toContain('verification code');
    });

    it('should return generic message for forgot-password with existing email', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({
          email: 'testadmin.auth@test.com',
        })
        .expect(200);

      expect(response.body.message).toContain('verification code');
    });

    it('should reject password reset with invalid code', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({
          email: 'testadmin.auth@test.com',
          code: '000000',
          newPassword: 'NewPassword123',
        })
        .expect(400);
    });

    it('should successfully reset password with valid token', async () => {
      // First, request a password reset
      await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({
          email: 'testadmin.auth@test.com',
        })
        .expect(200);

      // Get the created code record from database
      const resetToken = await prisma.passwordResetToken.findFirst({
        where: {
          userId: adminUserId,
          usedAt: null,
          expiresAt: { gte: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(resetToken).toBeDefined();

      const newCode = '123456';
      const tokenHash = await argon2.hash(newCode);

      // Update the token in database with our known token
      await prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { tokenHash },
      });

      await request(app.getHttpServer())
        .post('/api/auth/verify-reset-code')
        .send({
          email: 'testadmin.auth@test.com',
          code: newCode,
        })
        .expect(200);

      // Reset password with the known code
      const response = await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({
          email: 'testadmin.auth@test.com',
          code: newCode,
          newPassword: 'NewPassword123',
        })
        .expect(200);

      expect(response.body.message).toBe('Password reset successfully');

      // Verify token is marked as used
      const updatedToken = await prisma.passwordResetToken.findUnique({
        where: { id: resetToken.id },
      });
      expect(updatedToken.usedAt).toBeDefined();

      // Verify all refresh tokens are revoked
      const refreshTokens = await prisma.refreshToken.findMany({
        where: { userId: adminUserId, revokedAt: null },
      });
      expect(refreshTokens.length).toBe(0);

      // Verify new password works
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'testadmin.auth@test.com',
          password: 'NewPassword123',
        })
        .expect(200);

      // Reset password back to original for other tests
      const newPasswordHash = await argon2.hash('admin123');
      await prisma.user.update({
        where: { id: adminUserId },
        data: { passwordHash: newPasswordHash },
      });
    });

    it('should reject password reset with expired code', async () => {
      // Create an expired code
      const expiredDate = new Date();
      expiredDate.setHours(expiredDate.getHours() - 2);

      const code = '123456';
      const tokenHash = await argon2.hash(code);

      await prisma.passwordResetToken.create({
        data: {
          tokenHash,
          userId: adminUserId,
          expiresAt: expiredDate,
        },
      });

      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({
          email: 'testadmin.auth@test.com',
          code,
          newPassword: 'NewPassword123',
        })
        .expect(400);
    });

    it('should reject password reset with already used code', async () => {
      // Create a code and mark it as used
      const code = '123456';
      const tokenHash = await argon2.hash(code);

      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);

      await prisma.passwordResetToken.create({
        data: {
          tokenHash,
          userId: adminUserId,
          expiresAt,
          usedAt: new Date(),
        },
      });

      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({
          email: 'testadmin.auth@test.com',
          code,
          newPassword: 'NewPassword123',
        })
        .expect(400);
    });

    it('should revoke all refresh tokens after password reset', async () => {
      // Login to create refresh tokens
      const agent = request.agent(app.getHttpServer());
      await agent
        .post('/api/auth/login')
        .send({
          email: 'testadmin.auth@test.com',
          password: 'admin123',
        })
        .expect(200);

      // Verify refresh token exists
      const refreshTokensBefore = await prisma.refreshToken.findMany({
        where: { userId: adminUserId, revokedAt: null },
      });
      expect(refreshTokensBefore.length).toBeGreaterThan(0);

      // Request password reset
      await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({
          email: 'testadmin.auth@test.com',
        })
        .expect(200);

      // Get the created code record
      const resetToken = await prisma.passwordResetToken.findFirst({
        where: {
          userId: adminUserId,
          usedAt: null,
          expiresAt: { gte: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });

      const newCode = '123456';
      const tokenHash = await argon2.hash(newCode);

      await prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { tokenHash },
      });

      // Reset password
      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({
          email: 'testadmin.auth@test.com',
          code: newCode,
          newPassword: 'AnotherPassword123',
        })
        .expect(200);

      // Verify all refresh tokens are revoked
      const refreshTokensAfter = await prisma.refreshToken.findMany({
        where: { userId: adminUserId, revokedAt: null },
      });
      expect(refreshTokensAfter.length).toBe(0);

      // Reset password back to original
      const newPasswordHash = await argon2.hash('admin123');
      await prisma.user.update({
        where: { id: adminUserId },
        data: { passwordHash: newPasswordHash },
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limiting on login', async () => {
      // Create a dedicated test user for rate limiting test to avoid contamination
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          email: 'ratelimit@test.com',
          password: 'ratelimit123',
          name: 'Rate Limit Test',
          role: 'RECEPTIONIST',
        });

      // Wait for rate limiting window to clear from previous tests
      await new Promise(resolve => setTimeout(resolve, 65000));

      const responses = [];
      for (let i = 0; i < 15; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({
            email: 'ratelimit@test.com',
            password: 'ratelimit123',
          });
        responses.push(res);
        // Small delay to avoid overwhelming the test environment
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const rateLimitedResponse = responses[responses.length - 1];

      expect(rateLimitedResponse.status).toBe(429);

      // Clean up the dedicated test user
      const testUser = await prisma.user.findUnique({
        where: { email: 'ratelimit@test.com' },
        select: { id: true },
      });
      if (testUser) {
        await prisma.auditLog.deleteMany({
          where: { userId: testUser.id },
        });
        await prisma.user.delete({
          where: { email: 'ratelimit@test.com' },
        });
      }
    }, 90000);
  });
});
