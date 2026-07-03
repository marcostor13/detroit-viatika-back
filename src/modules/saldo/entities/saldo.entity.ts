import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

/**
 * Origen del saldo:
 * - `pago`: pago directo registrado por Contabilidad (sin centro de costo).
 * - `rendicion_directa`: remanente positivo de una rendición directa liquidada.
 * - `rendicion`: remanente positivo de una rendición que vino de una solicitud de viáticos.
 */
export type SaldoType = 'pago' | 'rendicion_directa' | 'rendicion'

export type SaldoStatus = 'available' | 'consumed'

/** Contexto de consumo: define qué tipos de saldo son elegibles. */
export type SaldoContext = 'rendicion_directa' | 'viatico'

/** Forma en que Contabilidad entregó el dinero. */
export type MetodoPago = 'deposito' | 'efectivo'

/** Datos del comprobante del pago directo de Contabilidad (solo type `pago`). */
export interface SaldoDepositInfo {
  amount: number
  /** Forma de pago; por defecto `deposito`. En `efectivo` el comprobante es opcional. */
  metodoPago?: MetodoPago
  scannedAmount?: number
  receiptUrl?: string
  receiptFileName?: string
  receiptMimeType?: string
  receiptSizeBytes?: number
  depositDate?: string
  operationNumber?: string
  operationDate?: string
  operationTime?: string
  titular?: string
  createdBy: Types.ObjectId
  createdAt: Date
}

export interface SaldoDocument extends Document {
  clientId: Types.ObjectId
  userId: Types.ObjectId
  type: SaldoType
  amount: number
  status: SaldoStatus
  /** Gestión / motivo libre que escribe quien origina el saldo (opcional). */
  concepto?: string
  projectId?: Types.ObjectId
  sourceReportId?: Types.ObjectId
  changeFromReportId?: Types.ObjectId
  deposit?: SaldoDepositInfo
  consumedByReportId?: Types.ObjectId
  consumedByAdvanceId?: Types.ObjectId
  consumedAt?: Date
  createdBy: Types.ObjectId
  createdAt?: Date
  updatedAt?: Date
}

@Schema({ timestamps: true })
export class Saldo {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Client' })
  clientId: Types.ObjectId

  /** Colaborador dueño del saldo. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId

  @Prop({
    required: true,
    enum: ['pago', 'rendicion_directa', 'rendicion'],
  })
  type: SaldoType

  @Prop({ required: true, default: 0 })
  amount: number

  @Prop({ required: true, default: 'available', enum: ['available', 'consumed'] })
  status: SaldoStatus

  /** Gestión / motivo libre que escribe quien origina el saldo (opcional). */
  @Prop({ type: String, required: false, trim: true })
  concepto?: string

  /** Centro de costo. Nulo para type `pago`. */
  @Prop({ type: Types.ObjectId, ref: 'Project', required: false })
  projectId?: Types.ObjectId

  /** Rendición que originó el saldo (rendicion / rendicion_directa). */
  @Prop({ type: Types.ObjectId, ref: 'ExpenseReport', required: false })
  sourceReportId?: Types.ObjectId

  /**
   * Viático cuyo saldo seleccionado superó el total: el sobrante (vuelto) volvió a
   * la bolsa como este saldo. Se usa en lugar de `sourceReportId` para no chocar con
   * su índice único (la liquidación de ese mismo viático puede crear otro remanente).
   */
  @Prop({ type: Types.ObjectId, ref: 'ExpenseReport', required: false })
  changeFromReportId?: Types.ObjectId

  @Prop({
    type: {
      amount: { type: Number, required: true },
      metodoPago: { type: String, enum: ['deposito', 'efectivo'], default: 'deposito' },
      scannedAmount: { type: Number },
      receiptUrl: { type: String, required: false },
      receiptFileName: { type: String },
      receiptMimeType: { type: String },
      receiptSizeBytes: { type: Number },
      depositDate: { type: String },
      operationNumber: { type: String },
      operationDate: { type: String },
      operationTime: { type: String },
      titular: { type: String },
      createdBy: { type: Types.ObjectId, ref: 'User' },
      createdAt: { type: Date },
      _id: false,
    },
    required: false,
  })
  deposit?: SaldoDepositInfo

  /** Nueva rendición directa que consumió este saldo. */
  @Prop({ type: Types.ObjectId, ref: 'ExpenseReport', required: false })
  consumedByReportId?: Types.ObjectId

  /** Nueva solicitud de viáticos (advance) que consumió este saldo. */
  @Prop({ type: Types.ObjectId, ref: 'Advance', required: false })
  consumedByAdvanceId?: Types.ObjectId

  @Prop({ type: Date, required: false })
  consumedAt?: Date

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId
}

export const SaldoSchema = SchemaFactory.createForClass(Saldo)

// Un único saldo por rendición de origen (idempotencia al recalcular la liquidación).
SaldoSchema.index(
  { sourceReportId: 1 },
  { unique: true, partialFilterExpression: { sourceReportId: { $type: 'objectId' } } }
)
