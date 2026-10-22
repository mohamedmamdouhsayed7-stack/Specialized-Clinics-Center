import { IsUUID, IsArray, ArrayMinSize, ValidateNested, IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateInvoiceChargeDto } from './create-invoice-charge.dto';

class TelephoneConsultationItemDto {
  @IsUUID()
  serviceId: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  @IsOptional()
  quantity?: number;
}

export class CreateTelephoneConsultationDto {
  @IsUUID()
  patientId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TelephoneConsultationItemDto)
  items: TelephoneConsultationItemDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceChargeDto)
  additionalCharges?: CreateInvoiceChargeDto[];
}
