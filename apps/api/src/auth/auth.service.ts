import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import * as argon2 from 'argon2';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyResetCodeDto } from './dto/verify-reset-code.dto';
import { UserRole } from '@prisma/client';
import { randomInt } from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private auditService: AuditService,
    private emailService: EmailService,
  ) {}

  async register(dto: RegisterDto, ipAddress?: string, userAgent?: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: dto.role,
      },
    });

    await this.auditService.logUserAction(
      user.id,
      'USER_CREATED',
      'User',
      user.id,
      ipAddress,
      userAgent,
    );

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  async login(loginDto: LoginDto, ipAddress?: string, userAgent?: string, rememberMe: boolean = false) {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
    });

    if (!user) {
      await this.auditService.logUserAction(
        'system',
        'LOGIN_FAILED',
        'User',
        'unknown',
        ipAddress,
        userAgent,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      await this.auditService.logUserAction(
        user.id,
        'LOGIN_FAILED_INACTIVE',
        'User',
        user.id,
        ipAddress,
        userAgent,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, loginDto.password);

    if (!isPasswordValid) {
      await this.auditService.logUserAction(
        user.id,
        'LOGIN_FAILED',
        'User',
        user.id,
        ipAddress,
        userAgent,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user.id, user.role);

    await this.saveRefreshToken(user.id, tokens.refreshToken, rememberMe);

    await this.auditService.logUserAction(
      user.id,
      'USER_LOGGED_IN',
      'User',
      user.id,
      ipAddress,
      userAgent,
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async refreshTokens(refreshToken: string, ipAddress?: string, userAgent?: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const allUserTokens = await this.prisma.refreshToken.findMany({
        where: { userId: payload.sub },
        include: { user: true },
      });

      let storedToken = null;
      for (const token of allUserTokens) {
        if (await argon2.verify(token.token, refreshToken)) {
          storedToken = token;
          break;
        }
      }

      if (!storedToken || storedToken.revokedAt || storedToken.expiresAt < new Date()) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      if (!storedToken.user.isActive) {
        throw new UnauthorizedException('Account is inactive');
      }

      await this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      });

      const tokens = await this.generateTokens(storedToken.user.id, storedToken.user.role);

      await this.saveRefreshToken(storedToken.user.id, tokens.refreshToken, false);

      await this.auditService.logUserAction(
        storedToken.user.id,
        'TOKEN_REFRESHED',
        'User',
        storedToken.user.id,
        ipAddress,
        userAgent,
      );

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: storedToken.user.id,
          email: storedToken.user.email,
          name: storedToken.user.name,
          role: storedToken.user.role,
        },
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(refreshToken: string, userId?: string, ipAddress?: string, userAgent?: string) {
    if (refreshToken) {
      // Revoke only the specific refresh token being used
      const allUserTokens = await this.prisma.refreshToken.findMany({
        where: { userId },
      });

      for (const token of allUserTokens) {
        if (await argon2.verify(token.token, refreshToken)) {
          await this.prisma.refreshToken.update({
            where: { id: token.id },
            data: { revokedAt: new Date() },
          });
          break; // Only revoke the matched token
        }
      }
    }

    if (userId) {
      await this.auditService.logUserAction(
        userId,
        'USER_LOGGED_OUT',
        'User',
        userId,
        ipAddress,
        userAgent,
      );
    }
  }

  async validateUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const passwordValid = await argon2.verify(user.passwordHash, currentPassword);

    if (!passwordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await argon2.hash(newPassword);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    await this.auditService.logUserAction(
      userId,
      'PASSWORD_CHANGED',
      'User',
      userId,
      ipAddress,
      userAgent,
    );

    return { message: 'Password changed successfully' };
  }

  private async generateTokens(userId: string, role: UserRole) {
    const payload = { sub: userId, role };
    const jti = Math.random().toString(36).substring(2);

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign({ ...payload, jti }, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }

  private async saveRefreshToken(userId: string, token: string, rememberMe: boolean = false) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (rememberMe ? 30 : 7));

    const tokenHash = await argon2.hash(token);

    await this.prisma.refreshToken.create({
      data: {
        token: tokenHash,
        userId,
        expiresAt,
      },
    });
  }

  async forgotPassword(dto: ForgotPasswordDto, ipAddress?: string, userAgent?: string) {
    // Generic response - don't reveal if email exists
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (user && user.isActive) {
      const verificationCode = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const tokenHash = await argon2.hash(verificationCode);

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      await this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      const resetToken = await this.prisma.passwordResetToken.create({
        data: { tokenHash, userId: user.id, expiresAt },
      });

      try {
        await this.emailService.sendPasswordResetEmail(user.email, verificationCode);
      } catch (error) {
        await this.prisma.passwordResetToken.update({
          where: { id: resetToken.id },
          data: { usedAt: new Date() },
        });
        this.logger.error('Failed to send password reset email', error instanceof Error ? error.message : String(error));
      }

      await this.auditService.logUserAction(
        user.id,
        'PASSWORD_RESET_REQUESTED',
        'User',
        user.id,
        ipAddress,
        userAgent,
      );
    }

    // Always return generic success message
    return { message: 'If an account with this email exists, a verification code has been sent.' };
  }

  private async findValidResetToken(email: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (!user || !user.isActive) return null;

    const resetTokens = await this.prisma.passwordResetToken.findMany({
      where: {
        userId: user.id,
        expiresAt: { gte: new Date() },
        usedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    for (const resetToken of resetTokens) {
      if (await argon2.verify(resetToken.tokenHash, code)) {
        return { resetToken, user };
      }
    }
    return null;
  }

  async verifyResetCode(dto: VerifyResetCodeDto) {
    const matchedToken = await this.findValidResetToken(dto.email, dto.code);
    if (!matchedToken) {
      throw new BadRequestException('Invalid or expired verification code');
    }
    return { verified: true };
  }

  async resetPassword(dto: ResetPasswordDto, ipAddress?: string, userAgent?: string) {
    const matchedToken = await this.findValidResetToken(dto.email, dto.code);
    if (!matchedToken) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    const passwordHash = await argon2.hash(dto.newPassword);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const claimedToken = await tx.passwordResetToken.updateMany({
        where: {
          id: matchedToken.resetToken.id,
          usedAt: null,
          expiresAt: { gte: now },
        },
        data: { usedAt: now },
      });
      if (claimedToken.count !== 1) {
        throw new BadRequestException('Invalid or expired verification code');
      }

      await tx.user.update({
        where: { id: matchedToken.user.id },
        data: { passwordHash },
      });

      await tx.refreshToken.updateMany({
        where: { userId: matchedToken.user.id },
        data: { revokedAt: now },
      });
    });

    await this.auditService.logUserAction(
      matchedToken.user.id,
      'PASSWORD_RESET',
      'User',
      matchedToken.user.id,
      ipAddress,
      userAgent,
    );

    return { message: 'Password reset successfully' };
  }
}
