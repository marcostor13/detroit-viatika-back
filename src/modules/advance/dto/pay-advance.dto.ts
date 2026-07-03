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
  /** Monto de este pago parcial (acumula en paidAmount). Si no llega, se usa el monto del viático. */
  @IsOptional()
  @IsNumber()
  amount?: number

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

  // Opcional: el efectivo no lleva comprobante. La obligatoriedad para
  // transferencia/cheque se valida en advance.service.registerPayment.
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
