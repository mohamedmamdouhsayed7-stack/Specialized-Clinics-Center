import { IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { InvoiceStatus, PaymentMethod } from '@prisma/client';

export class UpdateInvoiceStatusDto {
  @IsEnum(InvoiceStatus)
  @IsNotEmpty()
  status: InvoiceStatus;

  @IsEnum(PaymentMethod)
  @IsOptional()
  paymentMethod?: PaymentMethod;
}
