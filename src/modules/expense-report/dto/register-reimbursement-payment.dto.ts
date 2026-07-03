import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsDateString,
  IsUrl,
  IsNumber,
} from 'class-validator'

export class RegisterReimbursementPaymentDto {
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

  @IsOptional()
  @IsUrl()
  paymentReceiptUrl?: string

  @IsString()
  @IsOptional()
  paymentReceiptFileName?: string

  @IsString()
  @IsOptional()
  paymentReceiptMimeType?: string

  @IsOptional()
  @IsNumber()
  paymentReceiptSizeBytes?: number

  // Datos extraídos del comprobante por OCR/visión (informativos)
  @IsOptional()
  @IsNumber()
  scannedAmount?: number

  @IsString()
  @IsOptional()
  operationNumber?: string

  @IsString()
  @IsOptional()
  operationDate?: string

  @IsString()
  @IsOptional()
  operationTime?: string

  @IsString()
  @IsOptional()
  titular?: string
}
