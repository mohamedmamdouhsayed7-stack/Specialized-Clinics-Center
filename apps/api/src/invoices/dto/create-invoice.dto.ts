import {
  IsUUID,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsOptional,
  IsEnum,
} from 'class-validator';

import { Type } from 'class-transformer';
import { PaymentMethod } from '@prisma/client';

import { CreateInvoiceItemDto } from './create-invoice-item.dto';
import { CreateInvoiceChargeDto } from './create-invoice-charge.dto';

const ALLOWED_PAYMENT_METHODS = [
  PaymentMethod.KNET,
  PaymentMethod.LINK,
  PaymentMethod.OTHER,
] as const;

export class CreateInvoiceDto {
  @IsUUID()
  visitId: string;

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

  @IsEnum(ALLOWED_PAYMENT_METHODS, {
    message: 'paymentMethod must be one of the following values: KNET, LINK, OTHER',
  })
  paymentMethod: PaymentMethod;
}
