import { IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { InvoiceStatus } from '@prisma/client';

// Restrict new payments to KNET, LINK, and OTHER only
// Historical CASH, VISA, and OTHER values are preserved in the database
// but should not be selectable for new payments
const ALLOWED_PAYMENT_METHODS = ['KNET', 'LINK', 'OTHER'] as const;
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
