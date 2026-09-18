import { IsUUID, IsArray, ArrayMinSize, ValidateNested, IsOptional, IsEnum, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateInvoiceItemDto } from './create-invoice-item.dto';
import { CreateInvoiceChargeDto } from './create-invoice-charge.dto';

// Restrict new payments to KNET, LINK, and OTHER only
// Historical CASH, VISA, and OTHER values are preserved in the database
// but should not be selectable for new payments
const ALLOWED_PAYMENT_METHODS = ['KNET', 'LINK', 'OTHER'] as const;
type AllowedPaymentMethod = (typeof ALLOWED_PAYMENT_METHODS)[number];

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
  @IsNotEmpty()
  paymentMethod: AllowedPaymentMethod;
}
