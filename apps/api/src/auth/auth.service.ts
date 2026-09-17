import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import * as argon2 from 'argon2';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private auditService: AuditService,
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
}
