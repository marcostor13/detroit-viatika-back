import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type AdvanceStatus =
  | 'draft'
  | 'pending_l1'
  | 'pending_l2'
  | 'approved'
  | 'paid'
  | 'settled'
  | 'rejected'
  | 'returned'
  | 'cancelled'

export type ReturnRecordStatus =
  | 'pending'
  | 'proof_uploaded'
  | 'validated'
  | 'rejected'

export interface ReturnProof {
  depositDate: Date
  amountReturned: number
  bankOrigin: string
  operationNumber: string
  fileUrl: string
  fileKey?: string
  uploadedAt: Date
  note?: string
}

export interface ReturnValidation {
  validatedBy: string
  validatedAt: Date
  approved: boolean
  rejectionReason?: string
}

export interface ReturnRecord {
  status: ReturnRecordStatus
  amountDue: number
  dueDate: Date
  proof?: ReturnProof
  validation?: ReturnValidation
  isOverdue: boolean
  remindersSent: number
  escalatedAt?: Date
}

export interface ApprovalEntry {
  level: number
  approvedBy: string
  action: 'approved' | 'rejected' | 'resubmitted'
  notes?: string
  date: Date
}

export interface PaymentInfo {
  method: 'transferencia_bancaria' | 'efectivo' | 'cheque'
  bankName?: string
  accountNumber?: string
  cci?: string
  transferDate: Date
  reference?: string
  paymentReceiptUrl: string
  paymentReceiptFileName?: string
  paymentReceiptMimeType?: string
  paymentReceiptSizeBytes?: number
}

/** Detalle por categoría — Fase 2 (Funcionalidades.md §2.1) */
export interface AdvanceLineItem {
  categoryId: Types.ObjectId
  detalle?: string
  importe: number
  peopleCount: number
  glpPerDay: number
  days: number
  lineTotal: number
}

/** Registro de envío de correo al coordinador (§2.2) */
export interface CoordinatorNotificationLog {
  recipientUserId?: Types.ObjectId
  sentAt?: Date
  status: 'sent' | 'failed' | 'skipped'
  errorMessage?: string
  manualResendUrl?: string
}

export interface AdvanceDocument extends Document {
  userId: Types.ObjectId
  clientId: Types.ObjectId
  coordinatorId?: Types.ObjectId
  expenseReportId?: Types.ObjectId
  projectId?: Types.ObjectId
  place?: string
  startDate?: Date
  endDate?: Date
  lines?: AdvanceLineItem[]
  observations?: string
  coordinatorNotification?: CoordinatorNotificationLog
  amount: number
  description: string
  status: AdvanceStatus
  approvalLevel: number
  requiredLevels: number
  approvalHistory: ApprovalEntry[]
  paymentInfo?: PaymentInfo
  settlement?: {
    expenseTotal: number
    advanceAmount: number
    difference: number
    type: 'reembolso' | 'devolucion' | 'equilibrado'
    settledAt: Date
  }
  rejectedBy?: string
  rejectionReason?: string
  returnedAmount?: number
  returnRecord?: ReturnRecord
  /** Incrementa en cada reenvío tras rechazo (Fase 3). */
  solicitudVersion?: number
  /** Monto contabilizado en compromiso presupuestal del centro de costo hasta el pago. */
  budgetCommitmentRecorded?: boolean
  /** Rendición de origen cuando este anticipo incorpora un saldo pendiente de otra rendición. */
  pendingBalanceFromReportId?: Types.ObjectId
  /** Monto trasladado del saldo pendiente de la rendición de origen. */
  pendingBalanceAmount?: number
  /** Monto adicional solicitado por encima del saldo pendiente. */
  additionalAmount?: number
}

// Umbrales de aprobación multinivel
export const ADVANCE_THRESHOLDS = {
  L1_MAX: 500, // Hasta S/. 500: solo nivel 1 (Admin)
  // Más de S/. 500: nivel 1 + nivel 2 (Tesorero/SuperAdmin)
}

@Schema({ timestamps: true })
export class Advance {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId

  @Prop({ required: true, type: Types.ObjectId, ref: 'Client' })
  clientId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  coordinatorId?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'ExpenseReport', required: false })
  expenseReportId?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Project', required: false })
  projectId?: Types.ObjectId

  @Prop({ required: false })
  place?: string

  @Prop({ type: Date, required: false })
  startDate?: Date

  @Prop({ type: Date, required: false })
  endDate?: Date

  @Prop({
    type: [
      {
        categoryId: { type: Types.ObjectId, ref: 'Category', required: true },
        detalle: { type: String, required: false },
        importe: { type: Number, required: true },
        peopleCount: { type: Number, required: true },
        glpPerDay: { type: Number, required: true },
        days: { type: Number, required: true },
        lineTotal: { type: Number, required: true },
        _id: false,
      },
    ],
    default: undefined,
  })
  lines?: AdvanceLineItem[]

  @Prop({ required: false })
  observations?: string

  @Prop({
    type: {
      recipientUserId: { type: Types.ObjectId, ref: 'User' },
      sentAt: { type: Date },
      status: {
        type: String,
        enum: ['sent', 'failed', 'skipped'],
      },
      errorMessage: { type: String },
      manualResendUrl: { type: String },
      _id: false,
    },
    required: false,
  })
  coordinatorNotification?: CoordinatorNotificationLog

  @Prop({ required: true, min: 0 })
  amount: number

  @Prop({ required: true })
  description: string

  @Prop({
    type: String,
    default: 'pending_l1',
    enum: [
      'draft',
      'pending_l1',
      'pending_l2',
      'approved',
      'paid',
      'settled',
      'rejected',
      'returned',
      'cancelled',
    ],
  })
  status: AdvanceStatus

  @Prop({ default: 1 })
  approvalLevel: number

  @Prop({ default: 1 })
  requiredLevels: number

  @Prop({
    type: [
      {
        level: { type: Number },
        approvedBy: { type: String },
        action: {
          type: String,
          enum: ['approved', 'rejected', 'resubmitted'],
        },
        notes: { type: String },
        date: { type: Date },
      },
    ],
    default: [],
  })
  approvalHistory: ApprovalEntry[]

  @Prop({
    type: {
      method: {
        type: String,
        enum: ['transferencia_bancaria', 'efectivo', 'cheque'],
      },
      bankName: { type: String },
      accountNumber: { type: String },
      cci: { type: String },
      transferDate: { type: Date },
      reference: { type: String },
      paymentReceiptUrl: { type: String, required: true },
      paymentReceiptFileName: { type: String },
      paymentReceiptMimeType: { type: String },
      paymentReceiptSizeBytes: { type: Number },
      _id: false,
    },
  })
  paymentInfo?: PaymentInfo

  /**
   * Se define como objeto plano para evitar conflicto de casteo con la clave
   * interna `type` dentro de `settlement` (ej. settlement.type = 'devolucion').
   */
  @Prop({ type: Object })
  settlement?: {
    expenseTotal: number
    advanceAmount: number
    difference: number
    type: 'reembolso' | 'devolucion' | 'equilibrado'
    settledAt: Date
  }

  @Prop({ type: String, required: false })
  rejectedBy?: string

  @Prop({ type: String, required: false })
  rejectionReason?: string

  @Prop({ type: Number, required: false })
  returnedAmount?: number

  @Prop({ type: Object, required: false })
  returnRecord?: ReturnRecord

  @Prop({ type: Number, default: 1 })
  solicitudVersion?: number

  @Prop({ type: Boolean, default: false })
  budgetCommitmentRecorded?: boolean

  @Prop({ type: Types.ObjectId, ref: 'ExpenseReport', required: false })
  pendingBalanceFromReportId?: Types.ObjectId

  @Prop({ type: Number, required: false })
  pendingBalanceAmount?: number

  @Prop({ type: Number, required: false })
  additionalAmount?: number
}

export const AdvanceSchema = SchemaFactory.createForClass(Advance)
