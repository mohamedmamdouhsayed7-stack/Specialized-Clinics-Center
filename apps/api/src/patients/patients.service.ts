import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { AuditService } from '../audit/audit.service';

function normalizeCivilIdSearch(value: string): string {
  return value
    .trim()
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06F0))
    .replace(/[\s-]/g, '');
}

@Injectable()
export class PatientsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async create(createPatientDto: CreatePatientDto, userId: string, ipAddress?: string, userAgent?: string) {
    // Check for duplicate Civil ID
    if (createPatientDto.civilId) {
      const existingPatient = await this.prisma.patient.findUnique({
        where: { civilId: createPatientDto.civilId },
      });

      if (existingPatient) {
        throw new ConflictException('Patient with this Civil ID already exists');
      }
    }

    const patient = await this.prisma.patient.create({
      data: {
        ...createPatientDto,
        createdById: userId,
      },
    });

    await this.auditService.logUserAction(
      userId,
      'PATIENT_CREATED',
      'Patient',
      patient.id,
      ipAddress,
      userAgent,
    );

    return patient;
  }

  async findAll(search?: string, isArchived?: boolean, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const where: {
      isArchived?: boolean;
      OR?: Array<{
        id?: { in: string[] };
        civilId?: { contains: string; mode: 'insensitive' };
        fullNameAr?: { contains: string; mode: 'insensitive' };
        fullNameEn?: { contains: string; mode: 'insensitive' };
        phone?: { contains: string; mode: 'insensitive' };
      }>;
    } = {};

    if (isArchived !== undefined) {
      where.isArchived = isArchived;
    }

    if (search?.trim()) {
      const normalizedSearch = normalizeCivilIdSearch(search);
      const maskedCivilId = /^[0-9x]+$/i.test(normalizedSearch) && /x/i.test(normalizedSearch)
        ? normalizedSearch.replace(/x/gi, '[0-9]')
        : null;
      const maskedPatientIds = maskedCivilId
        ? (await this.prisma.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM "Patient"
            WHERE "civilId" ~ ${`^${maskedCivilId}$`}
          `).map((patient) => patient.id)
        : [];

      const civilIdFilter = maskedCivilId
        ? { id: { in: maskedPatientIds } }
        : { civilId: { contains: normalizedSearch, mode: 'insensitive' as const } };
      where.OR = [
        civilIdFilter,
        { fullNameAr: { contains: search.trim(), mode: 'insensitive' } },
        { fullNameEn: { contains: search.trim(), mode: 'insensitive' } },
        { phone: { contains: normalizedSearch, mode: 'insensitive' } },
      ];
    }

    const [patients, total] = await Promise.all([
      this.prisma.patient.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.patient.count({ where }),
    ]);

    const patientIds = patients.map((p) => p.id);

    // Last visit per patient: most recent Visit.visitDate, one query for the whole page
    // (not one query per row) using groupBy + max aggregation.
    const lastVisits = patientIds.length
      ? await this.prisma.visit.groupBy({
          by: ['patientId'],
          where: { patientId: { in: patientIds } },
          _max: { visitDate: true },
        })
      : [];
    const lastVisitByPatientId = new Map(lastVisits.map((v) => [v.patientId, v._max.visitDate]));

    // Next upcoming appointment per patient: earliest still-scheduled Appointment
    // in the future. Fetched once for the whole page, then reduced in memory to
    // the earliest per patient (groupBy has no MIN-then-pick-row equivalent here
    // since we'd still need the appointment's own fields, so this avoids N+1
    // without needing a raw SQL query).
    const upcomingAppointments = patientIds.length
      ? await this.prisma.appointment.findMany({
          where: {
            patientId: { in: patientIds },
            status: { in: ['BOOKED', 'CONFIRMED'] },
            scheduledAt: { gte: new Date() },
          },
          orderBy: { scheduledAt: 'asc' },
          select: { patientId: true, scheduledAt: true },
        })
      : [];
    const nextAppointmentByPatientId = new Map<string, Date>();
    for (const appt of upcomingAppointments) {
      if (!nextAppointmentByPatientId.has(appt.patientId)) {
        nextAppointmentByPatientId.set(appt.patientId, appt.scheduledAt);
      }
    }

    const data = patients.map((patient) => ({
      ...patient,
      lastVisitDate: lastVisitByPatientId.get(patient.id) || null,
      nextAppointmentDate: nextAppointmentByPatientId.get(patient.id) || null,
    }));

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
    const patient = await this.prisma.patient.findUnique({
      where: { id },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    return patient;
  }

  async update(id: string, updatePatientDto: UpdatePatientDto, userId: string, ipAddress?: string, userAgent?: string) {
    const existingPatient = await this.findOne(id);

    // Check for Civil ID conflict if being updated
    if (updatePatientDto.civilId && updatePatientDto.civilId !== existingPatient.civilId) {
      const duplicatePatient = await this.prisma.patient.findUnique({
        where: { civilId: updatePatientDto.civilId },
      });

      if (duplicatePatient) {
        throw new ConflictException('Patient with this Civil ID already exists');
      }
    }

    const updatedPatient = await this.prisma.patient.update({
      where: { id },
      data: updatePatientDto,
    });

    await this.auditService.logUserAction(
      userId,
      'PATIENT_UPDATED',
      'Patient',
      id,
      ipAddress,
      userAgent,
    );

    return updatedPatient;
  }

  async archive(id: string, userId: string, ipAddress?: string, userAgent?: string) {
    const patient = await this.findOne(id);

    if (patient.isArchived) {
      return patient; // Already archived
    }

    const archivedPatient = await this.prisma.patient.update({
      where: { id },
      data: { isArchived: true },
    });

    await this.auditService.logUserAction(
      userId,
      'PATIENT_ARCHIVED',
      'Patient',
      id,
      ipAddress,
      userAgent,
    );

    return archivedPatient;
  }

  async restore(id: string, userId: string, ipAddress?: string, userAgent?: string) {
    const patient = await this.findOne(id);

    if (!patient.isArchived) {
      return patient; // Already active
    }

    const restoredPatient = await this.prisma.patient.update({
      where: { id },
      data: { isArchived: false },
    });

    await this.auditService.logUserAction(
      userId,
      'PATIENT_RESTORED',
      'Patient',
      id,
      ipAddress,
      userAgent,
    );

    return restoredPatient;
  }

  async hardDelete(id: string, userId: string, ipAddress?: string, userAgent?: string) {
    return this.prisma.$transaction(async (tx) => {
      const patient = await tx.patient.findUnique({
        where: { id },
      });
      if (!patient) throw new NotFoundException('Patient not found');

      // Delete all dependent records in the correct order to respect foreign key constraints
      // 1. Delete payment allocations (links payments to invoices)
      await tx.paymentAllocation.deleteMany({
        where: {
          payment: {
            invoice: {
              visit: { patientId: id },
            },
          },
        },
      });

      // 2. Delete payments
      await tx.payment.deleteMany({
        where: {
          invoice: {
            visit: { patientId: id },
          },
        },
      });

      // 3. Delete invoice items
      await tx.invoiceItem.deleteMany({
        where: {
          invoice: {
            visit: { patientId: id },
          },
        },
      });

      // 4. Delete additional charges
      await tx.invoiceAdditionalCharge.deleteMany({
        where: {
          invoice: {
            visit: { patientId: id },
          },
        },
      });

      // 5. Delete invoices
      await tx.invoice.deleteMany({
        where: {
          visit: { patientId: id },
        },
      });

      // 6. Delete visits
      await tx.visit.deleteMany({
        where: { patientId: id },
      });

      // 7. Delete appointments
      await tx.appointment.deleteMany({
        where: { patientId: id },
      });

      // 8. Finally delete the patient
      await tx.patient.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'DELETE_PERMANENT',
          entityType: 'Patient',
          entityId: id,
          beforeState: JSON.stringify({
            civilId: patient.civilId,
            fullNameAr: patient.fullNameAr,
            fullNameEn: patient.fullNameEn,
            isArchived: patient.isArchived,
          }),
          ipAddress,
          userAgent,
        },
      });
      return { id, deleted: true };
    });
  }
}
