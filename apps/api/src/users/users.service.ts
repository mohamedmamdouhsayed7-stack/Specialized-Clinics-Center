import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import * as argon2 from 'argon2';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async create(dto: CreateUserDto, createdBy: string, ipAddress?: string, userAgent?: string) {
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
        createdById: createdBy,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditService.logUserAction(
      createdBy,
      'USER_CREATED',
      'User',
      user.id,
      ipAddress,
      userAgent,
    );

    return user;
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    updatedBy: string,
    updatedByRole: UserRole,
    ipAddress?: string,
    userAgent?: string,
  ) {
    if (dto.role && updatedByRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admin users can change user roles');
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.role && dto.role !== UserRole.ADMIN) {
        await tx.$queryRaw`
          SELECT "id"
          FROM "User"
          WHERE "role"::text = ${UserRole.ADMIN}
          ORDER BY "id"
          FOR UPDATE
        `;
      }

      const user = await tx.user.findUnique({
        where: { id },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (dto.email && dto.email !== user.email) {
        const existingUser = await tx.user.findUnique({
          where: { email: dto.email },
        });

        if (existingUser) {
          throw new ConflictException('Email already exists');
        }
      }

      if (
        dto.role &&
        dto.role !== user.role &&
        user.role === UserRole.ADMIN &&
        dto.role !== UserRole.ADMIN
      ) {
        const adminCount = await tx.user.count({ where: { role: UserRole.ADMIN } });
        if (adminCount <= 1) {
          throw new ConflictException('Cannot demote the last remaining administrator');
        }
      }

      const updateData: Record<string, string | boolean> = {};

      if (dto.email) updateData.email = dto.email;
      if (dto.name) updateData.name = dto.name;
      if (dto.role) updateData.role = dto.role;
      if (dto.password) {
        updateData.passwordHash = await argon2.hash(dto.password);
      }

      const updatedUser = await tx.user.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: updatedBy,
          action: 'USER_UPDATED',
          entityType: 'User',
          entityId: id,
          ipAddress,
          userAgent,
        },
      });

      return updatedUser;
    });
  }

  async updateStatus(id: string, isActive: boolean, updatedBy: string, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditService.logUserAction(
      updatedBy,
      isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
      'User',
      id,
      ipAddress,
      userAgent,
    );

    return updatedUser;
  }

  async updatePassword(id: string, newPassword: string, updatedBy: string, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const passwordHash = await argon2.hash(newPassword);

    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });

    await this.auditService.logUserAction(
      updatedBy,
      'USER_PASSWORD_RESET',
      'User',
      id,
      ipAddress,
      userAgent,
    );

    return { message: 'Password updated successfully' };
  }

  async remove(id: string, deletedBy: string, ipAddress?: string, userAgent?: string) {
    if (id === deletedBy) {
      throw new ConflictException('You cannot delete your current account');
    }

    return this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: { id: true, email: true, name: true, role: true, isActive: true },
      });

      if (!target) {
        throw new NotFoundException('User not found');
      }

      if (target.role === 'ADMIN') {
        const adminCount = await tx.user.count({ where: { role: 'ADMIN' } });
        if (adminCount <= 1) {
          throw new ConflictException('Cannot delete the last remaining administrator');
        }
      }

      await tx.auditLog.create({
        data: {
          userId: deletedBy,
          action: 'USER_DELETED',
          entityType: 'User',
          entityId: target.id,
          beforeState: target,
          ipAddress,
          userAgent,
        },
      });

      await tx.user.delete({ where: { id: target.id } });
      return { message: 'User deleted successfully' };
    });
  }
}
