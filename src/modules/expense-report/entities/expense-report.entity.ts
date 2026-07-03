import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import {
  AdvanceLineItem,
  AdvancePayment,
  ApprovalEntry,
  CoordinatorNotificationLog,
  PaymentInfo,
  ReturnRecord,
} from '../../advance/entities/advance.entity'

export type ExpenseReportStatus =
  | 'solicited'
  | 'open'
  | 'submitted'
  | 'pending_accounting'
  | 'approved'
  | 'rejected'
  | 'reimbursed'
  | 'closed'
  | 'cancelled'
  | 'pending_l1'
  | 'pending_l2'
  | 'viatico_approved'
  | 'partially_paid'
  | 'paid'
  | 'settled'
  | 'returned'

export type ExpenseReportType = 'rendicion' | 'viatico' | 'directa' | 'caja_chica'

export type ReopeningStatus = 'none' | 'requested' | 'approved'

export interface ReopenRecord {
  reason: string
  reopenedBy: string
  reopenedAt: Date
  fromStatus: string
}

export interface ClosureRecord {
  closedAt: Date
  closedBy: string
  documentHashes?: string[]
  reopeningStatus: ReopeningStatus
  reopeningRequestedBy?: string
  reopeningRequestedAt?: Date
  reopeningReason?: string
  reopeningApprovedBy?: string
  reopeningApprovedAt?: Date
  reopenedAt?: Date
}
export type SettlementType = 'reembolso' | 'devolucion' | 'equilibrado'

export interface Settlement {
  advanceTotal: number
  expenseTotal: number
  difference: number
  type: SettlementType
  settledAt: Date
}

export interface ExpenseReportBudgetItem {
  description: string
  amount: number
  peopleCount: number
  fuelAmount: number
  daysCount: number
  total: number
}

export interface ExpenseReportAffidavit {
  type: 'viaticos_nacionales' | 'viajes_exterior'
  expenseIds: Types.ObjectId[]
  generatedBy: Types.ObjectId
  generatedAt: Date
}

/**
 * Depósito inicial de una rendición directa iniciada por Contabilidad.
 * Su presencia marca el origen "contabilidad" y habilita el saldo disponible.
 * El `amount` confirmado se replica en `budget` para reutilizar el cálculo de saldo.
 */
export interface DirectaDepositInfo {
  amount: number
  scannedAmount?: number
  receiptUrl: string
  receiptFileName?: string
  receiptMimeType?: string
  receiptSizeBytes?: number
  depositDate?: string
  /** Datos extraídos del comprobante por OCR/visión. */
  operationNumber?: string
  operationDate?: string
  operationTime?: string
  titular?: string
  createdBy: Types.ObjectId
  createdAt: Date
}

/** Comprobante del pago de reembolso al colaborador (Fase 6) — mismo criterio que pago de anticipo */
export interface ReimbursementPaymentInfo {
  method: 'transferencia_bancaria' | 'efectivo' | 'cheque'
  bankName?: string
  accountNumber?: string
  cci?: string
  transferDate: Date
  reference?: string
  paymentReceiptUrl?: string
  paymentReceiptFileName?: string
  paymentReceiptMimeType?: string
  paymentReceiptSizeBytes?: number
  /** Datos extraídos del comprobante por OCR/visión (informativos). */
  scannedAmount?: number
  operationNumber?: string
  operationDate?: string
  operationTime?: string
  titular?: string
}

export interface ExpenseReportDocument extends Document {
  type?: ExpenseReportType
  title: string
  description: string
  budget: number
  userId: Types.ObjectId
  clientId: Types.ObjectId
  status: ExpenseReportStatus
  rejectionReason?: string
  rejectedByRole?: 'coordinador' | 'contabilidad'
  expenseIds: Types.ObjectId[]
  advanceIds?: Types.ObjectId[]
  settlement?: Settlement
  createdBy: Types.ObjectId
  approvedBy?: Types.ObjectId
  projectId?: Types.ObjectId
  motivo?: string
  codigo?: string
  gestion?: string
  isDirecta?: boolean
  isCajaChica?: boolean
  /** ID del anticipo que consumió el saldo pendiente de esta rendición. */
  pendingBalanceUsedInAdvanceId?: Types.ObjectId
  /** ID de la rendición directa que consumió el saldo pendiente de esta rendición directa. */
  pendingBalanceUsedInRendicionId?: Types.ObjectId
  /** ID de la rendición directa de origen (cuando esta fue creada usando el saldo de otra). */
  pendingBalanceFromReportId?: Types.ObjectId
  /** Monto heredado desde la rendición de origen. */
  pendingBalanceAmount?: number
  /** Saldos de la bolsa consumidos para financiar esta rendición directa. */
  saldoIds?: Types.ObjectId[]
  accountNumber?: string
  idDocument?: string
  peopleNames?: string[]
  location?: string
  startDate?: Date
  endDate?: Date
  items?: ExpenseReportBudgetItem[]
  affidavits?: ExpenseReportAffidavit[]
  directaDeposit?: DirectaDepositInfo
  reimbursementPaymentInfo?: ReimbursementPaymentInfo
  reimbursedAt?: Date
  reimbursementAccountingNotifiedAt?: Date
  closureRecord?: ClosureRecord
  coordinatorApprovedAt?: Date
  coordinatorApprovedBy?: Types.ObjectId
  contabilidadApprovedAt?: Date
  contabilidadApprovedBy?: Types.ObjectId
  reopenHistory?: ReopenRecord[]
  // Campos exclusivos de viático
  viaticoAmount?: number
  viaticoRequiredLevels?: number
  viaticoApprovalLevel?: number
  viaticoApprovalHistory?: ApprovalEntry[]
  viaticoPaidAmount?: number
  viaticoPayments?: AdvancePayment[]
  viaticoPaymentInfo?: PaymentInfo
  viaticoLines?: AdvanceLineItem[]
  viaticoPlace?: string
  viaticoLat?: number
  viaticoLng?: number
  viaticoStartDate?: Date
  viaticoEndDate?: Date
  viaticoObservations?: string
  viaticoSolicitudVersion?: number
  viaticoCoordinatorNotification?: CoordinatorNotificationLog
  viaticoReturnRecord?: ReturnRecord
  viaticoBudgetCommitmentRecorded?: boolean
  viaticoRejectedBy?: string
  viaticoRejectionReason?: string
  viaticoBankName?: string
  viaticoAccountNumber?: string
  viaticoCci?: string
}

@Schema({ timestamps: true })
export class ExpenseReport {
  @Prop({
    required: false,
    default: 'rendicion',
    enum: ['rendicion', 'viatico', 'directa', 'caja_chica'],
  })
  type?: ExpenseReportType

  @Prop({ required: false })
  title: string

  @Prop()
  description: string

  @Prop({ required: false, default: 0 })
  budget: number

  @Prop({ required: false })
  motivo?: string

  /** Código autoincremental único por empresa para rendiciones directas (ej. RD-0001). */
  @Prop({ required: false })
  codigo?: string

  /** Gestión que el colaborador realizará para estos gastos (rendición directa). */
  @Prop({ required: false })
  gestion?: string

  @Prop({ required: false, default: false })
  isDirecta?: boolean

  @Prop({ required: false, default: false })
  isCajaChica?: boolean

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId

  @Prop({ required: true, type: Types.ObjectId, ref: 'Client' })
  clientId: Types.ObjectId

  @Prop({
    default: 'open',
    enum: [
      'solicited', 'open', 'submitted', 'pending_accounting',
      'approved', 'rejected', 'reimbursed', 'closed', 'cancelled',
      'pending_l1', 'pending_l2', 'viatico_approved', 'partially_paid', 'paid', 'settled', 'returned',
    ],
  })
  status: ExpenseReportStatus

  /** Motivo cuando el administrador rechaza la rendición (visible para el colaborador) */
  @Prop({ required: false })
  rejectionReason?: string

  /** Quién rechazó la rendición: coordinador (rechazo en fase de revisión) o contabilidad (rechazo en aprobación final). */
  @Prop({ required: false, enum: ['coordinador', 'contabilidad'] })
  rejectedByRole?: 'coordinador' | 'contabilidad'

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Expense' }], default: [] })
  expenseIds: Types.ObjectId[]

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  approvedBy?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Project', required: false })
  projectId?: Types.ObjectId

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Advance' }], default: [] })
  advanceIds?: Types.ObjectId[]

  /**
   * Se define como objeto plano para evitar el conflicto de casteo con la
   * clave interna `type` del subdocumento (ej. settlement.type = 'devolucion').
   * Mongoose interpretaría `type` como descriptor del tipo y descartaría el resto.
   */
  @Prop({ type: Object })
  settlement?: Settlement

  @Prop()
  accountNumber?: string

  @Prop()
  idDocument?: string

  @Prop({ type: [String], default: [] })
  peopleNames?: string[]

  @Prop()
  location?: string

  @Prop()
  startDate?: Date

  @Prop()
  endDate?: Date

  @Prop({
    type: [
      {
        description: { type: String },
        amount: { type: Number },
        peopleCount: { type: Number },
        fuelAmount: { type: Number },
        daysCount: { type: Number },
        total: { type: Number },
        _id: false,
      },
    ],
    default: [],
  })
  items?: ExpenseReportBudgetItem[]

  @Prop({
    type: [
      {
        type: {
          type: String,
          enum: ['viaticos_nacionales', 'viajes_exterior'],
          required: true,
        },
        expenseIds: [{ type: Types.ObjectId, ref: 'Expense', required: true }],
        generatedBy: { type: Types.ObjectId, ref: 'User', required: true },
        generatedAt: { type: Date, required: true },
        _id: false,
      },
    ],
    default: [],
  })
  affidavits?: ExpenseReportAffidavit[]

  @Prop({
    type: {
      amount: { type: Number, required: true },
      scannedAmount: { type: Number },
      receiptUrl: { type: String, required: true },
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
  directaDeposit?: DirectaDepositInfo

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
      paymentReceiptUrl: { type: String },
      paymentReceiptFileName: { type: String },
      paymentReceiptMimeType: { type: String },
      paymentReceiptSizeBytes: { type: Number },
      scannedAmount: { type: Number },
      operationNumber: { type: String },
      operationDate: { type: String },
      operationTime: { type: String },
      titular: { type: String },
      _id: false,
    },
    required: false,
  })
  reimbursementPaymentInfo?: ReimbursementPaymentInfo

  @Prop({ type: Date, required: false })
  reimbursedAt?: Date

  @Prop({ type: Date, required: false })
  reimbursementAccountingNotifiedAt?: Date

  @Prop({
    type: {
      url: { type: String, required: true },
      fileName: { type: String },
      depositDate: { type: String, required: true },
      bankOrigin: { type: String },
      operationNumber: { type: String },
      scannedAmount: { type: Number },
      operationDate: { type: String },
      operationTime: { type: String },
      titular: { type: String },
      uploadedAt: { type: Date, required: true },
      _id: false,
    },
    required: false,
  })
  returnVoucher?: {
    url: string
    fileName?: string
    depositDate: string
    bankOrigin?: string
    operationNumber?: string
    /** Datos extraídos del comprobante por OCR/visión (informativos). */
    scannedAmount?: number
    operationDate?: string
    operationTime?: string
    titular?: string
    uploadedAt: Date
  }

  @Prop({ type: Object, required: false })
  closureRecord?: ClosureRecord

  @Prop({ type: Date, required: false })
  coordinatorApprovedAt?: Date

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  coordinatorApprovedBy?: Types.ObjectId

  @Prop({ type: Date, required: false })
  contabilidadApprovedAt?: Date

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  contabilidadApprovedBy?: Types.ObjectId

  @Prop({
    type: [
      {
        reason: { type: String, required: true },
        reopenedBy: { type: String, required: true },
        reopenedAt: { type: Date, required: true },
        fromStatus: { type: String, required: true },
        _id: false,
      },
    ],
    default: [],
  })
  reopenHistory?: ReopenRecord[]

  @Prop({ type: Types.ObjectId, ref: 'Advance', required: false })
  pendingBalanceUsedInAdvanceId?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'ExpenseReport', required: false })
  pendingBalanceUsedInRendicionId?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'ExpenseReport', required: false })
  pendingBalanceFromReportId?: Types.ObjectId

  @Prop({ required: false })
  pendingBalanceAmount?: number

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Saldo' }], default: undefined })
  saldoIds?: Types.ObjectId[]

  // ─── Campos exclusivos de viático ────────────────────────────────────────────

  @Prop({ type: Number, required: false })
  viaticoAmount?: number

  @Prop({ type: Number, default: 1 })
  viaticoRequiredLevels?: number

  @Prop({ type: Number, default: 0 })
  viaticoApprovalLevel?: number

  @Prop({
    type: [
      {
        level: { type: Number },
        approvedBy: { type: String },
        action: { type: String, enum: ['approved', 'rejected', 'resubmitted'] },
        notes: { type: String },
        date: { type: Date },
        _id: false,
      },
    ],
    default: [],
  })
  viaticoApprovalHistory?: ApprovalEntry[]

  @Prop({ type: Number, required: false })
  viaticoPaidAmount?: number

  @Prop({
    type: [
      {
        amount: { type: Number, required: true },
        method: { type: String, enum: ['transferencia_bancaria', 'efectivo', 'cheque'] },
        bankName: { type: String },
        accountNumber: { type: String },
        cci: { type: String },
        transferDate: { type: Date },
        reference: { type: String },
        // No requerido: los pagos en efectivo no llevan comprobante. La obligatoriedad
        // para transferencia/cheque se valida en el servicio (registerViaticoPayment).
        paymentReceiptUrl: { type: String },
        paymentReceiptFileName: { type: String },
        paymentReceiptMimeType: { type: String },
        paymentReceiptSizeBytes: { type: Number },
        scannedAmount: { type: Number },
        scannedTitular: { type: String },
        operationNumber: { type: String },
        operationDate: { type: String },
        operationTime: { type: String },
        createdAt: { type: Date },
        _id: false,
      },
    ],
    default: undefined,
  })
  viaticoPayments?: AdvancePayment[]

  @Prop({ type: Object, required: false })
  viaticoPaymentInfo?: PaymentInfo

  @Prop({
    type: [
      {
        categoryId: { type: Types.ObjectId, ref: 'Category', required: true },
        detalle: { type: String },
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
  viaticoLines?: AdvanceLineItem[]

  @Prop({ required: false })
  viaticoPlace?: string

  @Prop({ required: false })
  viaticoLat?: number

  @Prop({ required: false })
  viaticoLng?: number

  @Prop({ type: Date, required: false })
  viaticoStartDate?: Date

  @Prop({ type: Date, required: false })
  viaticoEndDate?: Date

  @Prop({ required: false })
  viaticoObservations?: string

  @Prop({ type: Number, default: 1 })
  viaticoSolicitudVersion?: number

  @Prop({ type: Object, required: false })
  viaticoCoordinatorNotification?: CoordinatorNotificationLog

  @Prop({ type: Object, required: false })
  viaticoReturnRecord?: ReturnRecord

  @Prop({ type: Boolean, default: false })
  viaticoBudgetCommitmentRecorded?: boolean

  @Prop({ type: String, required: false })
  viaticoRejectedBy?: string

  @Prop({ type: String, required: false })
  viaticoRejectionReason?: string

  @Prop({ type: String, required: false })
  viaticoBankName?: string

  @Prop({ type: String, required: false })
  viaticoAccountNumber?: string

  @Prop({ type: String, required: false })
  viaticoCci?: string
}

export const ExpenseReportSchema = SchemaFactory.createForClass(ExpenseReport)

// Código de rendición directa: único por empresa, solo cuando codigo es un string (no null/absent).
// partialFilterExpression es más robusto que sparse:true porque excluye también los null explícitos.
ExpenseReportSchema.index(
  { clientId: 1, codigo: 1 },
  { unique: true, partialFilterExpression: { codigo: { $type: 'string' } } }
)
