import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  IsBoolean,
  IsObject,
} from 'class-validator'
import { ExpenseStatus, MobilityRow } from '../entities/expense.entity'

export class UpdateExpenseDto {
  @IsString()
  @IsOptional()
  proyectId?: string

  @IsString()
  @IsOptional()
  categoryId?: string

  @IsString()
  @IsOptional()
  data?: string

  @IsNumber()
  @IsOptional()
  total?: number

  @IsString()
  @IsOptional()
  description?: string

  @IsString()
  @IsOptional()
  fechaEmision?: string

  @IsEnum([
    'pending',
    'approved',
    'rejected',
    'sunat_valid',
    'sunat_valid_not_ours',
    'sunat_not_found',
    'sunat_error',
  ])
  @IsOptional()
  status?: ExpenseStatus

  @IsString()
  @IsOptional()
  clientId?: string

  @IsString()
  @IsOptional()
  rejectionReason?: string

  @IsString()
  @IsOptional()
  approvedBy?: string

  @IsString()
  @IsOptional()
  rejectedBy?: string

  @IsOptional()
  statusDate?: Date

  @IsString()
  @IsOptional()
  comentario?: string

  @IsString()
  @IsOptional()
  placaVehiculo?: string

  @IsArray()
  @IsOptional()
  mobilityRows?: MobilityRow[]

  // --- Desglose contable (asientos Contanet) ---
  @IsNumber()
  @IsOptional()
  baseAfecta?: number

  @IsNumber()
  @IsOptional()
  igv?: number

  @IsNumber()
  @IsOptional()
  tasaIgv?: number

  @IsNumber()
  @IsOptional()
  inafecto?: number

  @IsArray()
  @IsOptional()
  detalleAnalitico?: {
    proyectId?: string
    condicion: 'afecto' | 'inafecto'
    monto: number
  }[]

  @IsBoolean()
  @IsOptional()
  desgloseRevisado?: boolean

  /** Información completa del comprobante extraída por OCR/IA (objeto libre). */
  @IsObject()
  @IsOptional()
  comprobanteDetallado?: Record<string, any>
}
