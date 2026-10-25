import { IsUUID, IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested, IsString, IsOptional, IsNumber, Min, Max, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateInvoiceChargeDto } from './create-invoice-charge.dto';

class TelephoneConsultationItemDto {
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  serviceName?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  unitPrice?: number;
}

export class CreateTelephoneConsultationDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  patientName?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1)
  @ValidateNested({ each: true })
  @Type(() => TelephoneConsultationItemDto)
  items: TelephoneConsultationItemDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceChargeDto)
  additionalCharges?: CreateInvoiceChargeDto[];
}
