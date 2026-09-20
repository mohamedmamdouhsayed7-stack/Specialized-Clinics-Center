import {
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

// Restrict new payments to KNET, LINK, and OTHER only.
// CASH and VISA remain valid historical database values,
// but are not selectable for new payments.
const ALLOWED_PAYMENT_METHODS = [
  PaymentMethod.KNET,
  PaymentMethod.LINK,
  PaymentMethod.OTHER,
] as const;

type AllowedPaymentMethod = (typeof ALLOWED_PAYMENT_METHODS)[number];

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

  @IsEnum(ALLOWED_PAYMENT_METHODS, {
    message: 'paymentMethod must be one of the following values: KNET, LINK, OTHER',
  })
  @IsOptional()
  paymentMethod?: AllowedPaymentMethod;
}


