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
import { ChainStep } from '../../advance/approval-chain.util'

/** Forma Mongoose de un `ChainStep` (ver approval-chain.util.ts) para subdocumentos embebidos. */
export const chainStepSchemaDefinition = {
  level: { type: Number, required: true },
  projectId: { type: Types.ObjectId, ref: 'Project', required: true },
  projectRole: { type: String, enum: ['principal', 'seleccionado'], required: true },
  approverIds: { type: [{ type: Types.ObjectId, ref: 'User' }], default: [] },
  escalatedFrom: { type: Number, required: false },
  /** Aprobación en paralelo entre niveles: este paso específico ya fue resuelto. */
  approved: { type: Boolean, default: false },
  approvedBy: { type: Types.ObjectId, ref: 'User', required: false },
  approvedAt: { type: Date, required: false },
  _id: false,
}

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
  | 'pending_contabilidad'
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
  metodoPago?: 'deposito' | 'efectivo'
  scannedAmount?: number
  receiptUrl?: string
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
  /**
   * Coordinador responsable de esta rendición (rol Coordinador), resuelto desde
   * `Project.approverId` del centro de costo (`projectId`) al crearla o al cambiar
   * su centro de costo. Es un snapshot: si luego cambia el aprobador del centro de
   * costo, esta rendición conserva el coordinador original (no retroactivo).
   */
  assignedCoordinatorId?: Types.ObjectId
  motivo?: string
  codigo?: string
  gestion?: string
  isDirecta?: boolean
  isCajaChica?: boolean
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
  /** Código de moneda SUNAT ('01' soles, '02' dólares). Default '01' para registros pre-existentes. */
  viaticoMoneda?: string
  viaticoRequiredLevels?: number
  viaticoApprovalLevel?: number
  /** Cadena por centro de costo (N2 principal/seleccionado), snapshot al crear la solicitud. */
  viaticoApproverChain?: ChainStep[]
  viaticoApprovalHistory?: ApprovalEntry[]
  /**
   * Aprobación final de Contabilidad de la SOLICITUD (regla 1.3, gate tras
   * completar `viaticoApproverChain`) — ver `approveViaticoContabilidad`.
   * Campos propios y separados de `contabilidadApprovedAt`/`contabilidadApprovedBy`,
   * que pertenecen a la aprobación de la RENDICIÓN de comprobantes (regla 1.4,
   * posterior al pago); antes ambos gates compartían el mismo campo y el de la
   * rendición pisaba el de la solicitud.
   */
  viaticoSolicitudContabilidadApprovedAt?: Date
  viaticoSolicitudContabilidadApprovedBy?: Types.ObjectId
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
  /** Quién rechazó: aprobador de centro de costo o Contabilidad (gate final). */
  viaticoRejectedByRole?: 'centro_costo' | 'contabilidad'
  viaticoBankName?: string
  viaticoAccountNumber?: string
  viaticoCci?: string
  /** Orden de Trabajo (LIM-XXX-NNNNNN) a la que se imputa el gasto del viático. */
  viaticoOrdenTrabajoId?: Types.ObjectId
  /**
   * Orden de Trabajo (LIM-XXX-NNNNNN) elegida al crear la rendición directa;
   * heredada por todos sus comprobantes.
   * @remarks la cadena de aprobación de rendición directa ya NO vive aquí a
   * nivel de reporte — se resuelve por comprobante, igual que una rendición
   * normal (ver `Expense.approverChain`).
   */
  directaOrdenTrabajoId?: Types.ObjectId
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
      'pending_l1', 'pending_l2', 'pending_contabilidad', 'viatico_approved', 'partially_paid', 'paid', 'settled', 'returned',
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

  /**
   * Snapshot del coordinador responsable (ver interfaz arriba). Se resuelve desde
   * `Project.approverId` al crear/editar `projectId`; no se recalcula si luego
   * cambia el aprobador del centro de costo.
   */
  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  assignedCoordinatorId?: Types.ObjectId

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
      metodoPago: { type: String, enum: ['deposito', 'efectivo'] },
      scannedAmount: { type: Number },
      receiptUrl: { type: String },
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

  // ─── Campos exclusivos de viático ────────────────────────────────────────────

  @Prop({ type: Number, required: false })
  viaticoAmount?: number

  /** Código de moneda SUNAT ('01' soles, '02' dólares). Default '01' para registros pre-existentes. */
  @Prop({ type: String, default: '01' })
  viaticoMoneda?: string

  @Prop({ type: Number, default: 1 })
  viaticoRequiredLevels?: number

  @Prop({ type: Number, default: 0 })
  viaticoApprovalLevel?: number

  /** Cadena por centro de costo (N2 principal/seleccionado), snapshot al crear la solicitud. */
  @Prop({ type: [chainStepSchemaDefinition], default: undefined })
  viaticoApproverChain?: ChainStep[]

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

  /**
   * Aprobación final de Contabilidad de la SOLICITUD (regla 1.3), separada de
   * `contabilidadApprovedAt`/`contabilidadApprovedBy` (aprobación de la
   * RENDICIÓN de comprobantes, regla 1.4) para no pisar el registro de
   * auditoría de una fase con el de la otra.
   */
  @Prop({ type: Date, required: false })
  viaticoSolicitudContabilidadApprovedAt?: Date

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  viaticoSolicitudContabilidadApprovedBy?: Types.ObjectId

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

  @Prop({ required: false, enum: ['centro_costo', 'contabilidad'] })
  viaticoRejectedByRole?: 'centro_costo' | 'contabilidad'

  @Prop({ type: String, required: false })
  viaticoBankName?: string

  @Prop({ type: String, required: false })
  viaticoAccountNumber?: string

  @Prop({ type: String, required: false })
  viaticoCci?: string

  @Prop({ type: Types.ObjectId, ref: 'OrdenTrabajo', required: false })
  viaticoOrdenTrabajoId?: Types.ObjectId

  /**
   * Orden de Trabajo (LIM-XXX-NNNNNN) elegida al crear la rendición directa;
   * heredada por todos sus comprobantes. La cadena de aprobación de rendición
   * directa ya no vive a nivel de reporte — ver `Expense.approverChain`.
   */
  @Prop({ type: Types.ObjectId, ref: 'OrdenTrabajo', required: false })
  directaOrdenTrabajoId?: Types.ObjectId
}

export const ExpenseReportSchema = SchemaFactory.createForClass(ExpenseReport)

// Código de rendición directa: único por empresa, solo cuando codigo es un string (no null/absent).
// partialFilterExpression es más robusto que sparse:true porque excluye también los null explícitos.
ExpenseReportSchema.index(
  { clientId: 1, codigo: 1 },
  { unique: true, partialFilterExpression: { codigo: { $type: 'string' } } }
)
