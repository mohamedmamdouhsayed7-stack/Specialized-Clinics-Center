import { IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { InvoiceStatus, PaymentMethod } from '@prisma/client';

// Restrict new payments to KNET, LINK, and OTHER only.
// CASH and VISA remain valid historical database values,
// but are not selectable for new payments.
const ALLOWED_PAYMENT_METHODS = [
  PaymentMethod.KNET,
  PaymentMethod.LINK,
  PaymentMethod.OTHER,
] as const;

type AllowedPaymentMethod = (typeof ALLOWED_PAYMENT_METHODS)[number];

export class UpdateInvoiceStatusDto {
  @IsEnum(InvoiceStatus)
  @IsNotEmpty()
  status: InvoiceStatus;

  @IsEnum(ALLOWED_PAYMENT_METHODS, {
    message: 'paymentMethod must be one of the following values: KNET, LINK, OTHER',
  })
  @IsOptional()
  paymentMethod?: AllowedPaymentMethod;
}
