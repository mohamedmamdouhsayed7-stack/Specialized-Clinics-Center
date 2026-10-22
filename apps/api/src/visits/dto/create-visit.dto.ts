import { IsString, IsUUID, IsDateString, IsOptional, IsNotEmpty, IsEnum, MaxLength, Matches } from 'class-validator';
import { VisitType } from '@prisma/client';

export class CreateVisitDto {
  @IsUUID()
  @IsNotEmpty()
  patientId: string;

  @IsEnum(VisitType)
  @IsNotEmpty()
  type: VisitType;

  @IsUUID()
  @IsOptional()
  appointmentId?: string;

  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:?\d{2})$/i, { message: 'visitDate must include an explicit timezone offset' })
  @IsOptional()
  visitDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  diagnosis?: string;
}
