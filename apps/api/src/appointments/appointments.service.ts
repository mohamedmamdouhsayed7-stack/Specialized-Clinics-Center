import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppointmentStatus } from '@prisma/client';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { localDayStartToUtc, localDayEndToUtc } from '../reports/reports.service';

@Injectable()
export class AppointmentsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) { }

  // Status transition rules
  private readonly VALID_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
    BOOKED: ['CONFIRMED', 'CANCELLED', 'NO_SHOW'],
    CONFIRMED: ['DONE', 'CANCELLED', 'NO_SHOW'],
    DONE: [], // Terminal state
    CANCELLED: [], // Terminal state
    NO_SHOW: [], // Terminal state
  };

  private validateStatusTransition(currentStatus: AppointmentStatus, newStatus: AppointmentStatus): void {
    if (currentStatus === newStatus) {
      return; // No change is allowed
    }

    const validTransitions = this.VALID_TRANSITIONS[currentStatus];
    if (!validTransitions.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${currentStatus} to ${newStatus}. Valid transitions: ${validTransitions.join(', ')}`
      );
    }
  }

  async create(createAppointmentDto: CreateAppointmentDto, userId: string, ipAddress?: string, userAgent?: string) {
    // Validate patient exists and is not archived
    const patient = await this.prisma.patient.findUnique({
      where: { id: createAppointmentDto.patientId },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    if (patient.isArchived) {
      throw new BadRequestException('Cannot create appointment for archived patient');
    }

    const appointment = await this.prisma.appointment.create({
      data: {
        ...createAppointmentDto,
        scheduledAt: new Date(createAppointmentDto.scheduledAt),
        status: AppointmentStatus.BOOKED,
        createdById: userId,
      },
      include: {
        patient: {
          select: {
            id: true,
            civilId: true,
            fullNameAr: true,
            fullNameEn: true,
            phone: true,
          },
        },
      },
    });

    // Audit log
    await this.auditService.log(
      userId,
      'CREATE',
      'Appointment',
      appointment.id,
      null,
      {
        patientId: appointment.patientId,
        scheduledAt: appointment.scheduledAt,
        status: appointment.status,
      },
      ipAddress,
      userAgent,
    );

    return appointment;
  }

  async findAll(
    date?: string,
    status?: AppointmentStatus,
    patientId?: string,
    page: number = 1,
    limit: number = 20
  ) {
    const skip = (page - 1) * limit;

    const where: {
      scheduledAt?: { gte: Date; lte: Date };
      status?: AppointmentStatus;
      patientId?: string;
    } = {};

    if (date) {
      const startDate = localDayStartToUtc(date);
      const endDate = localDayEndToUtc(date);
      where.scheduledAt = { gte: startDate, lte: endDate };
    }

    if (status) {
      where.status = status;
    }

    if (patientId) {
      where.patientId = patientId;
    }

    const [appointments, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { scheduledAt: 'asc' },
        include: {
          patient: {
            select: {
              id: true,
              civilId: true,
              fullNameAr: true,
              fullNameEn: true,
              phone: true,
            },
          },
        },
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return {
      data: appointments,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            civilId: true,
            fullNameAr: true,
            fullNameEn: true,
            phone: true,
          },
        },
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    return appointment;
  }

  async update(id: string, updateAppointmentDto: UpdateAppointmentDto, userId: string, ipAddress?: string, userAgent?: string) {
    const appointment = await this.findOne(id);

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: {
        ...updateAppointmentDto,
        ...(updateAppointmentDto.scheduledAt && { scheduledAt: new Date(updateAppointmentDto.scheduledAt) }),
      },
      include: {
        patient: {
          select: {
            id: true,
            civilId: true,
            fullNameAr: true,
            fullNameEn: true,
            phone: true,
          },
        },
      },
    });

    // Audit log
    await this.auditService.log(
      userId,
      'UPDATE',
      'Appointment',
      id,
      {
        patientId: appointment.patientId,
        scheduledAt: appointment.scheduledAt,
        status: appointment.status,
      },
      {
        patientId: updated.patientId,
        scheduledAt: updated.scheduledAt,
        status: updated.status,
      },
      ipAddress,
      userAgent,
    );

    return updated;
  }

  async updateStatus(id: string, updateStatusDto: UpdateStatusDto, userId: string, ipAddress?: string, userAgent?: string) {
    const appointment = await this.findOne(id);

    // Validate status transition
    this.validateStatusTransition(appointment.status, updateStatusDto.status);

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: { status: updateStatusDto.status },
      include: {
        patient: {
          select: {
            id: true,
            civilId: true,
            fullNameAr: true,
            fullNameEn: true,
            phone: true,
          },
        },
      },
    });

    // Audit log
    await this.auditService.log(
      userId,
      'STATUS_CHANGE',
      'Appointment',
      id,
      { status: appointment.status },
      { status: updated.status },
      ipAddress,
      userAgent,
    );

    return updated;
  }

  async hardDelete(id: string, userId: string, ipAddress?: string, userAgent?: string) {
    return this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({
        where: { id },
        include: { visit: { select: { id: true } } },
      });
      if (!appointment) throw new NotFoundException('Appointment not found');
      if (appointment.visit) {
        throw new ConflictException(
          'Appointment cannot be permanently deleted because it is linked to a visit. Preserve the appointment and visit history.',
        );
      }

      await tx.appointment.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'DELETE_PERMANENT',
          entityType: 'Appointment',
          entityId: id,
          beforeState: JSON.stringify({
            patientId: appointment.patientId,
            scheduledAt: appointment.scheduledAt,
            status: appointment.status,
            notes: appointment.notes,
          }),
          ipAddress,
          userAgent,
        },
      });
      return { id, deleted: true };
    });
  }

  async cancel(id: string, cancelDto: CancelAppointmentDto, userId: string, ipAddress?: string, userAgent?: string) {
    const appointment = await this.findOne(id);

    // Validate status transition
    this.validateStatusTransition(appointment.status, AppointmentStatus.CANCELLED);

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: {
        status: AppointmentStatus.CANCELLED,
        notes: cancelDto.reason ? `${appointment.notes || ''}\n\nCancellation reason: ${cancelDto.reason}`.trim() : appointment.notes,
      },
      include: {
        patient: {
          select: {
            id: true,
            civilId: true,
            fullNameAr: true,
            fullNameEn: true,
            phone: true,
          },
        },
      },
    });

    // Audit log
    await this.auditService.log(
      userId,
      'CANCEL',
      'Appointment',
      id,
      null,
      { reason: cancelDto.reason },
      ipAddress,
      userAgent,
    );

    return updated;
  }
}
