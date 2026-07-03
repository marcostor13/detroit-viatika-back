import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type ExpenseStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'sunat_valid'
  | 'sunat_valid_not_ours'
  | 'sunat_not_found'
  | 'sunat_error'

export interface ExpenseApproval {
  status: 'pending' | 'approved' | 'rejected'
  userId?: string
  userName?: string
  date?: Date
  reason?: string
}

export type ExpenseType =
  | 'factura'
  | 'planilla_movilidad'
  | 'otros_gastos'
  | 'recibo_caja'
  | 'comprobante_caja'

export interface MobilityRowCoords {
  lat: number
  lng: number
}

export interface MobilityRow {
  fecha: string
  total: number
  /** Proyecto / centro de costo propio de la fila (id). Usado en Rendiciones Directas. */
  proyectId?: string
  /** Categoría propia de la fila (id), según el perfil del proyecto de la fila. Usado en Rendiciones Directas. */
  categoryId?: string
  /** Colaborador (trabajador) al que corresponde la fila. Por defecto quien rinde; editable a un tercero. */
  colaboradorId?: string
  colaboradorNombre?: string
  clienteProveedor: string
  origen: string
  origenDepartamento?: string
  origenProvincia?: string
  origenDistrito?: string
  origenCoords?: MobilityRowCoords
  destino: string
  destinoDepartamento?: string
  destinoProvincia?: string
  destinoDistrito?: string
  destinoCoords?: MobilityRowCoords
  distanciaKm?: number
  gestion: string
}

export interface ExpenseReviewHistory {
  action: 'approved' | 'rejected'
  reviewerId?: string
  reviewedAt: Date
  reason?: string
}

/**
 * Reparto analítico de un comprobante para asientos contables.
 * Una factura puede dividirse en varias líneas (multiproyecto y/o afecto+inafecto).
 */
export interface ExpenseAnalyticDetail {
  /** Proyecto / centro de costo (id) al que se carga esta porción. */
  proyectId?: string
  /** Condición tributaria de la porción. */
  condicion: 'afecto' | 'inafecto'
  /** Monto de valor venta de esta porción (sin IGV). */
  monto: number
}

/**
 * Clasificación de un cargo del comprobante distinto al IGV
 * (otrosTributos/otrosCargos) para los asientos contables.
 */
export interface ExpenseCargoClasificado {
  /** Origen del cargo: 'otrosTributos' | 'otrosCargos'. */
  concepto: string
  monto: number
  deducible: boolean
  /** Serie de control interno (0001/0003/0008) cuando NO es deducible. */
  serieControlInterno?: string
}

/** Resultado de clasificación persistido; `hash` invalida si cambian los cargos. */
export interface ExpenseCargosClasificacion {
  hash: string
  cargos: ExpenseCargoClasificado[]
}

export interface ExpenseDocument extends Document {
  proyectId: Types.ObjectId
  total: number
  description: string
  categoryId: Types.ObjectId
  file?: string
  data: string
  status?: ExpenseStatus
  statusDate?: Date
  approvedBy?: string
  rejectedBy?: string
  rejectionReason?: string
  clientId: string
  fechaEmision?: string
  observado?: boolean
  observacionPlazo?: string
  diasRetraso?: number
  categoryLimitPercent?: number
  categoryLimitWarning?: string
  expenseReportId?: Types.ObjectId
  expenseType?: ExpenseType
  mobilityRows?: MobilityRow[]
  declaracionJurada?: boolean
  declaracionJuradaFirmante?: string
  reviewHistory?: ExpenseReviewHistory[]
  internalCode?: string
  comentario?: string
  placaVehiculo?: string
  approvalCoord?: ExpenseApproval
  approvalCont?: ExpenseApproval
  // --- Desglose contable (asientos Contanet) ---
  /** Base imponible afecta al IGV (valor venta gravado). */
  baseAfecta?: number
  /** Monto del IGV declarado en el comprobante. */
  igv?: number
  /** Tasa de IGV leída del comprobante (18, 10, 10.5). */
  tasaIgv?: number
  /** Monto inafecto (recargo al consumo, servicio, propina…). */
  inafecto?: number
  /** Reparto analítico por proyecto y condición afecto/inafecto. */
  detalleAnalitico?: ExpenseAnalyticDetail[]
  /** Marca si Contabilidad ya revisó/corrigió el desglose contable. */
  desgloseRevisado?: boolean
  /**
   * Información completa del comprobante extraída por el OCR/IA (estructura libre).
   * Aditivo: no reemplaza `data` ni los campos estructurados. Captura todos los
   * parámetros de la factura peruana (totales, tributos, ítems, detracción, etc.).
   */
  comprobanteDetallado?: Record<string, any>
  /**
   * Clasificación (IA/determinista) de cargos ≠ IGV, cacheada por hash para
   * no volver a consultar a la IA en cada generación de asientos.
   */
  otrosCargosClasificacion?: ExpenseCargosClasificacion
}

export interface GetExpenseDocument extends Omit<ExpenseDocument, '_id'> {
  _id: string
}

@Schema({ timestamps: true })
export class Expense {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Project' })
  proyectId: Types.ObjectId

  @Prop()
  total: number

  @Prop()
  description: string

  @Prop({ required: true, type: Types.ObjectId, ref: 'Category' })
  categoryId: Types.ObjectId

  @Prop({ required: false })
  file?: string

  @Prop()
  data: string

  @Prop({ default: 'pending' })
  status: ExpenseStatus

  @Prop()
  statusDate: Date

  @Prop()
  approvedBy: string

  @Prop()
  rejectedBy: string

  @Prop()
  rejectionReason: string

  @Prop()
  createdBy: string

  @Prop({ type: 'ObjectId', ref: 'Client', required: true })
  clientId: string

  @Prop({ type: String, required: false })
  fechaEmision?: string

  @Prop({ type: Boolean, default: false })
  observado?: boolean

  @Prop({ type: String, required: false })
  observacionPlazo?: string

  @Prop({ type: Number, required: false })
  diasRetraso?: number

  @Prop({ type: Number, required: false })
  categoryLimitPercent?: number

  @Prop({ type: String, required: false })
  categoryLimitWarning?: string

  @Prop({
    type: [
      {
        action: {
          type: String,
          enum: ['approved', 'rejected'],
          required: true,
        },
        reviewerId: { type: String, required: false },
        reviewedAt: { type: Date, required: true },
        reason: { type: String, required: false },
        _id: false,
      },
    ],
    default: [],
  })
  reviewHistory?: ExpenseReviewHistory[]

  @Prop({ type: String, required: false })
  internalCode?: string

  @Prop({ type: Types.ObjectId, ref: 'ExpenseReport', required: false })
  expenseReportId?: Types.ObjectId

  @Prop({
    type: String,
    default: 'factura',
    enum: [
      'factura',
      'planilla_movilidad',
      'otros_gastos',
      'recibo_caja',
      'comprobante_caja',
    ],
  })
  expenseType?: ExpenseType

  @Prop({
    type: [
      {
        fecha: { type: String },
        total: { type: Number },
        proyectId: { type: String },
        categoryId: { type: String },
        colaboradorId: { type: String },
        colaboradorNombre: { type: String },
        clienteProveedor: { type: String },
        origen: { type: String },
        origenDepartamento: { type: String },
        origenProvincia: { type: String },
        origenDistrito: { type: String },
        origenCoords: {
          lat: { type: Number },
          lng: { type: Number },
        },
        destino: { type: String },
        destinoDepartamento: { type: String },
        destinoProvincia: { type: String },
        destinoDistrito: { type: String },
        destinoCoords: {
          lat: { type: Number },
          lng: { type: Number },
        },
        distanciaKm: { type: Number },
        gestion: { type: String },
      },
    ],
    required: false,
    default: undefined,
  })
  mobilityRows?: MobilityRow[]

  @Prop({ type: Boolean, required: false })
  declaracionJurada?: boolean

  @Prop({ type: String, required: false })
  declaracionJuradaFirmante?: string

  @Prop({ type: String, required: false })
  comentario?: string

  @Prop({ type: String, required: false })
  placaVehiculo?: string

  @Prop({
    type: {
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
      },
      userId: { type: String },
      userName: { type: String },
      date: { type: Date },
      reason: { type: String },
      _id: false,
    },
    required: false,
  })
  approvalCoord?: ExpenseApproval

  @Prop({
    type: {
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
      },
      userId: { type: String },
      userName: { type: String },
      date: { type: Date },
      reason: { type: String },
      _id: false,
    },
    required: false,
  })
  approvalCont?: ExpenseApproval

  /** Sub-tipo para 'otros_gastos': TK (Ticket), RC (Recibos diversos), DJ (Declaración Jurada), OT (Otros) */
  @Prop({ type: String, required: false })
  subTipo?: string

  // --- Desglose contable (asientos Contanet) ---
  @Prop({ type: Number, required: false })
  baseAfecta?: number

  @Prop({ type: Number, required: false })
  igv?: number

  @Prop({ type: Number, required: false })
  tasaIgv?: number

  @Prop({ type: Number, required: false })
  inafecto?: number

  @Prop({
    type: [
      {
        proyectId: { type: String, required: false },
        condicion: {
          type: String,
          enum: ['afecto', 'inafecto'],
          required: true,
        },
        monto: { type: Number, required: true },
        _id: false,
      },
    ],
    required: false,
    default: undefined,
  })
  detalleAnalitico?: ExpenseAnalyticDetail[]

  @Prop({ type: Boolean, default: false })
  desgloseRevisado?: boolean

  @Prop({ type: Object, required: false })
  comprobanteDetallado?: Record<string, any>

  @Prop({ type: Object, required: false })
  otrosCargosClasificacion?: ExpenseCargosClasificacion
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense)
