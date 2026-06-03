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
        action: { type: String, enum: ['approved', 'rejected'], required: true },
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
      status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
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
      status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
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
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense)
