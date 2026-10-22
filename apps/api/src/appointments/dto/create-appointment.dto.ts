import { IsString, IsUUID, IsDateString, IsOptional, IsNotEmpty, MaxLength, Matches } from 'class-validator';

export class CreateAppointmentDto {
  @IsUUID()
  @IsOptional()
  patientId?: string;

  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:?\d{2})$/i, { message: 'scheduledAt must include an explicit timezone offset' })
  @IsNotEmpty()
  scheduledAt: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}
