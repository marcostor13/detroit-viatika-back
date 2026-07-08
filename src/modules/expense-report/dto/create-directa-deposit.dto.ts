import { IsString, IsNumber, IsOptional, IsMongoId, IsIn, Min } from 'class-validator'

/**
 * Creación de una rendición directa con depósito inicial, iniciada por Contabilidad.
 * El usuario destino (colaborador/coordinador) recibe el saldo disponible.
 */
export class CreateDirectaDepositDto {
  @IsMongoId()
  userId: string // colaborador/coordinador destino

  @IsString()
  @IsOptional()
  gestion?: string

  @IsMongoId()
  projectId: string // centro de costo: arma la cadena de aprobadores al enviar

  @IsMongoId()
  ordenTrabajoId: string // heredada por los comprobantes de planilla de movilidad

  @IsNumber()
  @Min(0.01)
  amount: number // monto confirmado del depósito

  @IsIn(['deposito', 'efectivo'])
  @IsOptional()
  metodoPago?: 'deposito' | 'efectivo'

  @IsNumber()
  @IsOptional()
  scannedAmount?: number // monto crudo del OCR (auditoría)

  @IsString()
  @IsOptional()
  receiptUrl?: string // requerido salvo metodoPago='efectivo'

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
