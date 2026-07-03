import { IsString, IsNumber, IsOptional, IsMongoId, Min, IsIn } from 'class-validator'

/** Forma en que Contabilidad entregó el dinero. */
export type MetodoPago = 'deposito' | 'efectivo'

/**
 * Registro de un pago directo de Contabilidad. Genera un Saldo tipo `pago`
 * (sin centro de costo) para el colaborador destino.
 */
export class CreatePagoSaldoDto {
  @IsMongoId()
  userId: string // colaborador destino

  @IsNumber()
  @Min(0.01)
  amount: number // monto confirmado del depósito

  @IsNumber()
  @IsOptional()
  scannedAmount?: number // monto crudo del OCR (auditoría)

  @IsString()
  @IsOptional()
  concepto?: string // gestión / motivo libre del pago (opcional)

  @IsIn(['deposito', 'efectivo'])
  @IsOptional()
  metodoPago?: MetodoPago // forma de pago; por defecto `deposito`

  @IsString()
  @IsOptional()
  receiptUrl?: string // comprobante; opcional (p. ej. pagos en efectivo)

  @IsString()
  @IsOptional()
  receiptFileName?: string

  @IsString()
  @IsOptional()
  receiptMimeType?: string

  @IsNumber()
  @IsOptional()
  receiptSizeBytes?: number

  @IsString()
  @IsOptional()
  depositDate?: string

  // Datos extraídos del comprobante (OCR/visión)
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
