import { IsString, IsOptional, IsDateString, MaxLength, IsNotEmpty, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreatePatientDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() || null : value)
  @IsOptional()
  @IsString()
  @MaxLength(12)
  @Matches(/^\d+$/, { message: 'civilId must contain only digits' })
  civilId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fullNameAr: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  fullNameEn?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  address?: string;
}
