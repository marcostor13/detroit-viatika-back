import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsEnum,
  IsBoolean,
  IsArray,
  IsNumber,
  IsObject,
} from 'class-validator'
import {
  ExpenseStatus,
  ExpenseType,
  MobilityRow,
} from '../entities/expense.entity'

export class CreateExpenseDto {
  @IsString()
  @IsNotEmpty()
  proyectId: string

  /** Orden de Trabajo (opcional salvo en planilla_movilidad, ver ADF-FOR-005). */
  @IsString()
  @IsOptional()
  ordenTrabajoId?: string

  /**
   * Categoría del gasto. Opcional a nivel de DTO porque en planilla_movilidad
   * la resuelve el frontend (única categoría "Planilla de movilidad" asignada,
   * o la que el colaborador elige si tiene más de una); el servicio la valida
   * y la exige en ese caso. El resto de tipos de gasto siempre la envían desde
   * el formulario.
   */
  @IsString()
  @IsOptional()
  categoryId?: string

  @IsString()
  @IsOptional()
  imageUrl?: string

  @IsString()
  @IsOptional()
  data?: string

  @IsOptional()
  @IsNumber()
  total?: number

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
  @IsNotEmpty()
  clientId: string

  @IsString()
  @IsOptional()
  userId?: string

  @IsString()
  @IsOptional()
  expenseReportId?: string

  @IsEnum([
    'factura',
    'planilla_movilidad',
    'otros_gastos',
    'recibo_caja',
  ])
  @IsOptional()
  expenseType?: ExpenseType

  @IsArray()
  @IsOptional()
  mobilityRows?: MobilityRow[]

  @IsBoolean()
  @IsOptional()
  declaracionJurada?: boolean

  @IsString()
  @IsOptional()
  declaracionJuradaFirmante?: string

  @IsString()
  @IsOptional()
  fechaEmision?: string

  @IsString()
  @IsOptional()
  comentario?: string

  @IsString()
  @IsOptional()
  placaVehiculo?: string

  @IsString()
  @IsOptional()
  subTipo?: string

  @IsString()
  @IsOptional()
  serie?: string

  @IsString()
  @IsOptional()
  correlativo?: string

  @IsString()
  @IsOptional()
  rucEmisor?: string

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
