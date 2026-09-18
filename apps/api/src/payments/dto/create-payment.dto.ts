import {
  IsUUID,
  IsNumber,
  Min,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '@prisma/client';

export class CreatePaymentDto {
  @IsUUID()
  invoiceId: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsIn(['LINK', 'KNET', 'OTHER'])
  method: PaymentMethod;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
