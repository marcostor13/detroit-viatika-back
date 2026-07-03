import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, IsDateString } from 'class-validator'

export class PayViaticoDto {
  @IsString()
  @IsNotEmpty()
  method: 'transferencia_bancaria' | 'efectivo' | 'cheque'

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  amount?: number

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
  transferDate: string

  @IsString()
  @IsOptional()
  reference?: string

  @IsString()
  @IsOptional()
  paymentReceiptUrl?: string

  @IsString()
  @IsOptional()
  paymentReceiptFileName?: string

  @IsString()
  @IsOptional()
  paymentReceiptMimeType?: string

  @IsNumber()
  @IsOptional()
  paymentReceiptSizeBytes?: number

  @IsNumber()
  @IsOptional()
  scannedAmount?: number

  @IsString()
  @IsOptional()
  scannedTitular?: string

  @IsString()
  @IsOptional()
  operationNumber?: string

  @IsString()
  @IsOptional()
  operationDate?: string

  @IsString()
  @IsOptional()
  operationTime?: string
}
