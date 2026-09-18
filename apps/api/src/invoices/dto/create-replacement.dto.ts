import { IsArray, ArrayMinSize, ValidateNested, IsOptional, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateInvoiceItemDto } from './create-invoice-item.dto';
import { CreateInvoiceChargeDto } from './create-invoice-charge.dto';
import { PaymentMethod } from '@prisma/client';

export class CreateReplacementDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceChargeDto)
  additionalCharges?: CreateInvoiceChargeDto[];

  @IsEnum(PaymentMethod)
  @IsOptional()
  paymentMethod?: PaymentMethod;
}
