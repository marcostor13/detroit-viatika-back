import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsDateString,
  IsUrl,
  IsNumber,
} from 'class-validator'

export class PayAdvanceDto {
  @IsEnum(['transferencia_bancaria', 'efectivo', 'cheque'])
  method: 'transferencia_bancaria' | 'efectivo' | 'cheque'

  @IsString()
  @IsOptional()
  bankName?: string

  @IsString()
  @IsOptional()
  accountNumber?: string

  @IsString()
  @IsOptional()
  cci?: string

  @IsDateString()
  @IsNotEmpty()
  transferDate: string

  @IsString()
  @IsOptional()
  reference?: string

  @IsUrl()
  @IsNotEmpty()
  paymentReceiptUrl: string

  @IsString()
  @IsOptional()
  paymentReceiptFileName?: string

  @IsString()
  @IsOptional()
  paymentReceiptMimeType?: string

  @IsOptional()
  @IsNumber()
  paymentReceiptSizeBytes?: number
}
