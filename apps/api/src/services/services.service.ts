import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Injectable()
export class ServicesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async create(createServiceDto: CreateServiceDto, userId: string, ipAddress?: string, userAgent?: string) {
    // Trim service name
    const name = createServiceDto.name.trim();

    let service;
    try {
      service = await this.prisma.service.create({
        data: {
          name,
          code: createServiceDto.code?.trim() || undefined,
          description: createServiceDto.description?.trim() || undefined,
          currentPrice: createServiceDto.currentPrice,
          isActive: createServiceDto.isActive !== undefined ? createServiceDto.isActive : true,
          createdById: userId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A service with this code already exists');
      }
      throw error;
    }

    await this.auditService.log(
      userId,
      'CREATE',
      'Service',
      service.id,
      null,
      {
        name: service.name,
        currentPrice: service.currentPrice,
        isActive: service.isActive,
      },
      ipAddress,
      userAgent,
    );

    return service;
  }

  async findAll(search?: string, isActive?: boolean, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const where: {
      OR?: Array<
        | { name: { contains: string; mode: 'insensitive' } }
        | { code: { contains: string; mode: 'insensitive' } }
      >;
      isActive?: boolean;
    } = {};

    if (search) {
      const term = search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { code: { contains: term, mode: 'insensitive' } },
      ];
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [data, total] = await Promise.all([
      this.prisma.service.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.service.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    return service;
  }

  async update(id: string, updateServiceDto: UpdateServiceDto, userId: string, ipAddress?: string, userAgent?: string) {
    const service = await this.findOne(id);

    const updated = await this.prisma.service.update({
      where: { id },
      data: {
        name: updateServiceDto.name !== undefined ? updateServiceDto.name.trim() : undefined,
        code: updateServiceDto.code,
        description: updateServiceDto.description,
        currentPrice: updateServiceDto.currentPrice,
        isActive: updateServiceDto.isActive,
      },
    });

    await this.auditService.log(
      userId,
      'UPDATE',
      'Service',
      id,
      {
        name: service.name,
        currentPrice: service.currentPrice,
        isActive: service.isActive,
      },
      {
        name: updated.name,
        currentPrice: updated.currentPrice,
        isActive: updated.isActive,
      },
      ipAddress,
      userAgent,
    );

    return updated;
  }

  async updateStatus(id: string, updateStatusDto: UpdateStatusDto, userId: string, ipAddress?: string, userAgent?: string) {
    const service = await this.findOne(id);

    const updated = await this.prisma.service.update({
      where: { id },
      data: {
        isActive: updateStatusDto.isActive,
      },
    });

    const action = updateStatusDto.isActive ? 'ACTIVATE' : 'DEACTIVATE';

    await this.auditService.log(
      userId,
      action,
      'Service',
      id,
      {
        isActive: service.isActive,
      },
      {
        isActive: updated.isActive,
      },
      ipAddress,
      userAgent,
    );

    return updated;
  }

  async hardDelete(id: string, userId: string, ipAddress?: string, userAgent?: string) {
    return this.prisma.$transaction(async (tx) => {
      const service = await tx.service.findUnique({
        where: { id },
      });
      if (!service) throw new NotFoundException('Service not found');

      // Update InvoiceItem.serviceId to NULL to preserve invoice history
      await tx.invoiceItem.updateMany({
        where: { serviceId: id },
        data: { serviceId: null },
      });

      await tx.service.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'DELETE_PERMANENT',
          entityType: 'Service',
          entityId: id,
          beforeState: JSON.stringify({
            name: service.name,
            code: service.code,
            currentPrice: service.currentPrice,
            isActive: service.isActive,
          }),
          ipAddress,
          userAgent,
        },
      });
      return { id, deleted: true };
    });
  }
}
