import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { CreateExpenseReportDto } from './dto/create-expense-report.dto'
import { UpdateExpenseReportDto } from './dto/update-expense-report.dto'
import {
  ExpenseReport,
  ExpenseReportDocument,
} from './entities/expense-report.entity'
import { Expense, ExpenseDocument } from '../expense/entities/expense.entity'
import {
  CajaChicaReport,
  CajaChicaReportDocument,
} from '../caja-chica-report/entities/caja-chica-report.entity'
import {
  parseFechaEmisionInput,
  applyFechaEmisionDisplayToExpense,
} from '../expense/utils/fecha-emision.util'
import { EmailService } from '../email/email.service'
import { NotificationsService } from '../notifications/notifications.service'
import { UserService } from '../user/user.service'
import { CreateAffidavitDto } from './dto/create-affidavit.dto'
import { RegisterReimbursementPaymentDto } from './dto/register-reimbursement-payment.dto'
import { CreateDirectaDepositDto } from './dto/create-directa-deposit.dto'
import { AdvanceService } from '../advance/advance.service'
import { ROLES } from '../auth/enums/roles.enum'
import { applyFechaEmisionDisplayToExpenses } from '../expense/utils/fecha-emision.util'
import { UploadService } from '../upload/upload.service'
import { ProjectService } from '../project/project.service'
import { CategoryService } from '../category/category.service'
import {
  findActionableChainStep,
  isChainFullyApproved,
  plainChainStep,
  buildSolicitudChain,
  buildRendicionChain,
  ChainStep,
  ChainProject,
} from '../advance/approval-chain.util'
import { CreateViaticoExpenseReportDto } from './dto/create-viatico-expense-report.dto'
import { PayViaticoDto } from './dto/pay-viatico.dto'
import { ResubmitViaticoDto } from './dto/resubmit-viatico.dto'
import { CreateAdvanceLineDto } from '../advance/dto/create-advance.dto'
import { Logger } from '@nestjs/common'
import { monedaSymbol, DEFAULT_MONEDA } from '../../common/moneda.constants'

/** Contexto del usuario que solicita eliminar una solicitud. */
export interface SolicitudDeleteActor {
  userId: string
  role: string
}

@Injectable()
export class ExpenseReportService implements OnModuleInit {
  private readonly logger = new Logger(ExpenseReportService.name)

  constructor(
    @InjectModel(ExpenseReport.name)
    private readonly expenseReportModel: Model<ExpenseReportDocument>,
    @InjectModel(Expense.name)
    private readonly expenseModel: Model<ExpenseDocument>,
    @InjectModel(CajaChicaReport.name)
    private readonly cajaChicaReportModel: Model<CajaChicaReportDocument>,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
    private readonly userService: UserService,
    @Inject(forwardRef(() => AdvanceService))
    private readonly advanceService: AdvanceService,
    private readonly uploadService: UploadService,
    private readonly projectService: ProjectService,
    private readonly categoryService: CategoryService
  ) { }

  async onModuleInit() {
    const col = this.expenseReportModel.collection
    try {
      await col.dropIndex('clientId_1_codigo_1')
      this.logger.log('Dropped old sparse index clientId_1_codigo_1')
    } catch {
      // Index didn't exist or was already replaced — safe to ignore
    }
    try {
      await col.createIndex(
        { clientId: 1, codigo: 1 },
        { unique: true, partialFilterExpression: { codigo: { $type: 'string' } }, background: true }
      )
      this.logger.log('Created partialFilterExpression index for clientId+codigo')
    } catch (e) {
      this.logger.warn(`Index create skipped: ${(e as Error).message}`)
    }
    await this.migrateAssignedCoordinatorIds()
  }

  /**
   * Backfill único e idempotente: asigna `assignedCoordinatorId` a las rendiciones
   * que no lo tengan, resolviendo el aprobador del centro de costo (`Project.approverId`)
   * de su `projectId`. Si la rendición no tiene centro de costo o este no tiene
   * aprobador configurado, cae al dato legacy `User.coordinatorId` del dueño como
   * último recurso, solo para no dejar historicos huérfanos. Tras esta migración,
   * el resto del código ya no necesita leer el campo legacy.
   */
  private async migrateAssignedCoordinatorIds() {
    const pending = await this.expenseReportModel
      .find({
        type: { $ne: 'viatico' },
        assignedCoordinatorId: { $exists: false },
      })
      .select('_id projectId userId clientId')
      .lean()
      .exec()
    if (pending.length === 0) return

    const projectIdsByClient = new Map<string, Set<string>>()
    for (const r of pending) {
      if (!r.projectId) continue
      const clientKey = String(r.clientId)
      if (!projectIdsByClient.has(clientKey)) {
        projectIdsByClient.set(clientKey, new Set())
      }
      projectIdsByClient.get(clientKey)!.add(String(r.projectId))
    }

    const approverByProjectId = new Map<string, Types.ObjectId>()
    for (const [clientKey, projectIdSet] of projectIdsByClient) {
      const projects = await this.projectService.findManyByIds(
        [...projectIdSet],
        clientKey
      )
      for (const p of projects) {
        if (p.approverId) {
          approverByProjectId.set(String((p as any)._id), p.approverId)
        }
      }
    }

    let migrated = 0
    for (const r of pending) {
      let assignedCoordinatorId = r.projectId
        ? approverByProjectId.get(String(r.projectId))
        : undefined

      if (!assignedCoordinatorId) {
        const profile = await this.userService.findTransactionalProfile(
          String(r.userId)
        )
        assignedCoordinatorId = profile?.coordinatorId
      }

      if (!assignedCoordinatorId) continue

      await this.expenseReportModel.updateOne(
        { _id: r._id },
        { $set: { assignedCoordinatorId } }
      )
      migrated++
    }

    if (migrated > 0) {
      this.logger.log(
        `Backfill: asignado assignedCoordinatorId a ${migrated} rendición(es) desde centro de costo / legacy`
      )
    }
  }

  /**
   * Resuelve el coordinador responsable de un centro de costo (`Project.approverId`)
   * para snapshotearlo en `assignedCoordinatorId` al crear/editar una rendición.
   */
  private async resolveAssignedCoordinatorId(
    projectId: string | undefined,
    clientId: string
  ): Promise<Types.ObjectId | undefined> {
    if (!projectId) return undefined
    const projects = await this.projectService.findManyByIds(
      [projectId],
      clientId
    )
    return projects[0]?.approverId
  }

  private validatePaymentReceipt(
    mimeType?: string,
    fileName?: string,
    sizeBytes?: number
  ): { ok: boolean; reason?: string } {
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png']
    const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png']
    const normalizedMime = (mimeType ?? '').toLowerCase().trim()
    const normalizedName = (fileName ?? '').toLowerCase().trim()
    const mimeAllowed = normalizedMime
      ? allowedMimes.includes(normalizedMime)
      : false
    const extAllowed = allowedExtensions.some(ext =>
      normalizedName.endsWith(ext)
    )
    if (!mimeAllowed && !extAllowed) {
      return {
        ok: false,
        reason: 'Formato inválido. Solo se permite PDF, JPG o PNG.',
      }
    }
    if (typeof sizeBytes === 'number' && sizeBytes > 10 * 1024 * 1024) {
      return { ok: false, reason: 'El comprobante excede 10MB.' }
    }
    return { ok: true }
  }

  private normalizeExpenseReportClientId(clientId: unknown): string {
    if (!clientId) return ''
    if (clientId instanceof Types.ObjectId) return clientId.toHexString()
    if (
      typeof clientId === 'object' &&
      clientId !== null &&
      '_id' in clientId
    ) {
      return String((clientId as { _id: unknown })._id)
    }
    return String(clientId)
  }

  /**
   * Para correos / notificaciones: muestra el "presupuesto" alineado con la UI
   * (`totalAnticipado` del frontend) — suma TODOS los anticipos vinculados
   * con status approved/paid/settled. Si la rendición no tiene anticipos
   * (caso directa), cae a `report.budget` para no mostrar S/ 0.00.
   */
  private async computeReportBudgetDisplay(report: any): Promise<number> {
    if (!report?._id) return Number(report?.budget) || 0
    const reportId = String(report._id)

    // Rendición directa: no usa anticipo ni presupuesto, por lo que budget=0 y
    // advances=0 hacían que los correos (incluida la notificación a Tesorería)
    // mostraran "S/ 0.00" (VD-52). El monto relevante es el total gastado = suma
    // de los gastos no-rechazados.
    if (report.isDirecta === true) {
      const directa = await this.expenseReportModel
        .findById(reportId)
        .populate('expenseIds', 'total status')
        .exec()
      const exps = (directa?.expenseIds ?? []) as any[]
      const gastado = exps.reduce(
        (s: number, e: any) =>
          String(e?.status || '').toLowerCase() === 'rejected'
            ? s
            : s + (Number(e?.total) || 0),
        0
      )
      return gastado > 0 ? gastado : Number(report.budget) || 0
    }

    const rawAdvanceIds: string[] = (
      Array.isArray(report.advanceIds) ? report.advanceIds : []
    ).map((x: any) =>
      x && typeof x === 'object' && '_id' in x ? String(x._id) : String(x)
    )
    const linkedAdvances = await this.advanceService.findByExpenseReportId(
      reportId,
      rawAdvanceIds
    )
    const total = linkedAdvances
      .filter((a: any) =>
        ['approved', 'partially_paid', 'paid', 'settled'].includes(a.status)
      )
      .reduce(
        (s: number, a: any) =>
          s +
          (a.status === 'approved' ? 0 : Number(a.paidAmount ?? a.amount) || 0),
        0
      )
    return total > 0 ? total : Number(report.budget) || 0
  }

  private async validateBeforeSubmit(reportId: string): Promise<void> {
    const report = await this.expenseReportModel
      .findById(reportId)
      .populate('expenseIds')
      .select('expenseIds')
      .lean()
      .exec()

    if (!report) {
      throw new NotFoundException(
        `Expense report with ID ${reportId} not found`
      )
    }

    const expenses = Array.isArray(report.expenseIds) ? report.expenseIds : []
    if (expenses.length === 0) {
      throw new BadRequestException(
        'Debe registrar al menos un gasto antes de enviar la rendición.'
      )
    }

    const hasRejected = expenses.some(
      (e: any) => String(e?.status || '').toLowerCase() === 'rejected'
    )
    if (hasRejected) {
      throw new BadRequestException(
        'No puede enviar la rendición mientras existan comprobantes rechazados sin corregir.'
      )
    }
  }

  private async validateBeforeFinalApproval(reportId: string): Promise<void> {
    const report = await this.expenseReportModel
      .findById(reportId)
      .populate('expenseIds')
      .select('expenseIds')
      .lean()
      .exec()

    if (!report) {
      throw new NotFoundException(
        `Expense report with ID ${reportId} not found`
      )
    }

    const expenses = Array.isArray(report.expenseIds) ? report.expenseIds : []
    if (expenses.length === 0) {
      throw new BadRequestException(
        'No se puede aprobar una rendición sin comprobantes registrados.'
      )
    }

    const hasRejected = expenses.some(
      (e: any) => String(e?.status || '').toLowerCase() === 'rejected'
    )
    if (hasRejected) {
      throw new BadRequestException(
        'Existen comprobantes rechazados. Corrígelos antes de aprobar la rendición.'
      )
    }

    // Regla 1.4 (decisión "esperar a que todos completen"): la rendición solo
    // pasa a Contabilidad cuando TODOS sus comprobantes completaron su propia
    // cadena N1/N2/[N2 sel] — no se permite avance parcial.
    const hasPendingChain = expenses.some((e: any) => {
      const required = e?.requiredLevels ?? e?.approverChain?.length ?? 0
      const level = e?.approvalLevel ?? 0
      return level < required
    })
    if (hasPendingChain) {
      throw new BadRequestException(
        'Existen comprobantes que aún no completaron su cadena de aprobación.'
      )
    }
  }

  /**
   * Genera un código autoincremental único por empresa de forma atómica
   * usando una colección `counters` (a prueba de concurrencia). Ej: RD-0001.
   */
  private async generateDirectaCodigo(clientId: string): Promise<string> {
    const key = `rendicion-directa:${clientId}`
    const res: any = await this.expenseReportModel.db
      .collection('counters')
      .findOneAndUpdate(
        { _id: key as any },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' }
      )
    const seq = (res && (res.seq ?? res.value?.seq)) ?? 1
    return `RD-${String(seq).padStart(4, '0')}`
  }

  async create(
    createExpenseReportDto: CreateExpenseReportDto,
    createdBy: string,
    isCollaborator = false
  ) {
    const isDirecta = createExpenseReportDto.isDirecta === true
    const isCajaChica = createExpenseReportDto.isCajaChica === true
    const title =
      createExpenseReportDto.title?.trim() ||
      createExpenseReportDto.motivo?.trim() ||
      createExpenseReportDto.gestion?.trim() ||
      'Rendición'

    const codigo = isDirecta
      ? await this.generateDirectaCodigo(createExpenseReportDto.clientId)
      : undefined

    const assignedCoordinatorId = await this.resolveAssignedCoordinatorId(
      createExpenseReportDto.projectId,
      createExpenseReportDto.clientId
    )

    const report = new this.expenseReportModel({
      ...createExpenseReportDto,
      title,
      codigo,
      userId: new Types.ObjectId(createExpenseReportDto.userId),
      clientId: new Types.ObjectId(createExpenseReportDto.clientId),
      createdBy: new Types.ObjectId(createdBy),
      projectId: createExpenseReportDto.projectId
        ? new Types.ObjectId(createExpenseReportDto.projectId)
        : undefined,
      directaOrdenTrabajoId: createExpenseReportDto.ordenTrabajoId
        ? new Types.ObjectId(createExpenseReportDto.ordenTrabajoId)
        : undefined,
      assignedCoordinatorId,
      budget: createExpenseReportDto.budget ?? 0,
      // Caja chica y rendición directa: siempre open desde el inicio
      status:
        isDirecta || isCajaChica
          ? 'open'
          : isCollaborator
            ? 'solicited'
            : 'open',
      expenseIds: [],
    })
    const savedReport = await report.save()

    console.log(
      `[ExpenseReportService] Created report: ${savedReport._id}. isCollaborator: ${isCollaborator}, isDirecta: ${isDirecta}`
    )

    // Solo notificar admins si es una rendición normal solicitada (no directa)
    if (isCollaborator && !isDirecta) {
      try {
        const admins = await this.userService.findAdminsByClient(
          String(savedReport.clientId)
        )
        const user = await this.userService.findOne(createdBy)
        const creatorName = user.name || 'Un colaborador'

        for (const admin of admins) {
          await this.notificationsService.create({
            userId: String(admin._id),
            title: 'Nueva Rendición Solicitada',
            message: `${creatorName} ha creado una nueva solicitud de rendición: "${savedReport.title}"`,
            type: 'info',
            actionUrl: `/mis-rendiciones/${savedReport._id}/detalle`,
          })
        }
      } catch (error) {
        console.error(
          'Error enviando notificaciones a administradores (create)',
          error
        )
      }
    }

    return savedReport
  }

  /**
   * Crea una rendición directa con depósito inicial, iniciada por Contabilidad.
   * El usuario destino recibe el saldo disponible (amount = budget). Reutiliza
   * `create()` (genera el código RD) y luego adjunta el subdocumento `directaDeposit`.
   */
  async createDirectaWithDeposit(
    dto: CreateDirectaDepositDto,
    createdBy: string,
    clientId: string
  ) {
    if (dto.metodoPago !== 'efectivo' && !dto.receiptUrl) {
      throw new BadRequestException(
        'Debe adjuntar el comprobante de depósito (o marcar el método de pago como efectivo).'
      )
    }

    const report = await this.create(
      {
        isDirecta: true,
        userId: dto.userId,
        clientId,
        gestion: dto.gestion,
        budget: dto.amount,
        projectId: dto.projectId,
        ordenTrabajoId: dto.ordenTrabajoId,
      } as CreateExpenseReportDto,
      createdBy,
      false // no es flujo de colaborador → no notifica admins
    )

    report.directaDeposit = {
      amount: dto.amount,
      metodoPago: dto.metodoPago ?? 'deposito',
      scannedAmount: dto.scannedAmount,
      receiptUrl: dto.receiptUrl,
      receiptFileName: dto.receiptFileName,
      receiptMimeType: dto.receiptMimeType,
      receiptSizeBytes: dto.receiptSizeBytes,
      depositDate: dto.depositDate,
      operationNumber: dto.operationNumber,
      operationDate: dto.operationDate,
      operationTime: dto.operationTime,
      titular: dto.titular,
      createdBy: new Types.ObjectId(createdBy),
      createdAt: new Date(),
    }
    await report.save()

    try {
      await this.notificationsService.create({
        userId: String(dto.userId),
        title: 'Nueva Rendición Directa con saldo',
        message: `Contabilidad te asignó una rendición directa (${report.codigo}) con saldo disponible de S/ ${dto.amount.toFixed(2)}.`,
        type: 'info',
        actionUrl: `/mis-rendiciones/${report._id}/detalle`,
      })
    } catch (error) {
      console.error('Error notificando rendición directa con depósito', error)
    }

    return report
  }

  /**
   * Lista las rendiciones directas iniciadas por Contabilidad (con depósito)
   * de un cliente, calculando total gastado y saldo disponible.
   */
  async findDirectaDepositReports(clientId: string) {
    const reports = await this.expenseReportModel
      .find({
        clientId: new Types.ObjectId(clientId),
        isDirecta: true,
        directaDeposit: { $exists: true, $ne: null },
      })
      .populate('userId', 'name email')
      .populate('expenseIds', 'total')
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    return reports.map(r => {
      const expenses = (r.expenseIds as any[]) || []
      const totalGastado = expenses.reduce(
        (sum, e) => sum + (Number(e?.total) || 0),
        0
      )
      const deposited = Number(r.directaDeposit?.amount ?? r.budget ?? 0)
      return {
        ...r,
        totalGastado,
        saldoDisponible: deposited - totalGastado,
      }
    })
  }

  async createAutoFromViatico(advance: {
    _id: unknown
    userId: Types.ObjectId
    clientId: Types.ObjectId
    projectId?: Types.ObjectId
    description?: string
    place?: string
    amount: number
    startDate?: Date
    endDate?: Date
  }): Promise<ExpenseReportDocument> {
    const title =
      advance.description?.trim() || advance.place?.trim() || 'Viático'
    const assignedCoordinatorId = await this.resolveAssignedCoordinatorId(
      advance.projectId?.toString(),
      advance.clientId.toString()
    )
    const report = new this.expenseReportModel({
      title,
      userId: advance.userId,
      clientId: advance.clientId,
      createdBy: advance.userId,
      projectId: advance.projectId ?? undefined,
      assignedCoordinatorId,
      location: advance.place ?? undefined,
      budget: advance.amount,
      startDate: advance.startDate ?? undefined,
      endDate: advance.endDate ?? undefined,
      status: 'open',
      expenseIds: [],
      advanceIds: [advance._id],
    })
    return report.save()
  }

  async findAllByClient(clientId: string) {
    return await this.expenseReportModel
      .find({
        clientId: new Types.ObjectId(clientId),
        isCajaChica: { $ne: true },
      })
      .populate('userId', 'name email signature bankAccount')
      .populate('createdBy', 'name email')
      // Nombre de la categoría de cada línea de viático, para mostrar el detalle
      // por categoría al aprobar (la list no traía categoryId poblado).
      .populate('viaticoLines.categoryId', 'name')
      // Orden de Trabajo imputada, para mostrarla en el detalle de la solicitud.
      .populate('viaticoOrdenTrabajoId', 'nombre costCenterId')
      .populate('directaOrdenTrabajoId', 'nombre costCenterId')
      // Estado de la cadena por comprobante (regla 1.4) — para mostrar progreso
      // agregado de rendición directa (ya no tiene cadena a nivel de reporte).
      // `total` también poblado: reportExpensesTotal() lo necesita y antes de
      // este populate expenseIds llegaban sin poblar (siempre devolvía 0).
      .populate('expenseIds', 'total status approvalLevel requiredLevels contabilidadStatus')
      .sort({ createdAt: -1 })
      .exec()
  }

  /**
   * Rendiciones a cargo de un Coordinador. Combina mecanismos, cada uno con
   * su propio snapshot:
   * - Rendición normal: `assignedCoordinatorId`, tomado al crear/editar la
   *   rendición (ver `resolveAssignedCoordinatorId`).
   * - Viático: `viaticoApproverChain`, la cadena por centro de costo tomada
   *   al solicitar el viático (ver `buildSolicitudChain`/`buildSolicitudCostCenterChain`).
   * - Rendición por comprobante (directa, normal o viático ya en fase de
   *   rendición): ya no tiene cadena a nivel de reporte — se resuelve por
   *   comprobante (`Expense.approverChain`, ver `buildRendicionChain`); se
   *   incluye cualquier reporte que tenga al menos un comprobante con este
   *   aprobador en su cadena, SIN importar el estado del reporte. Como la
   *   cadena del comprobante se construye al SUBIRLO (regla 1.9), el aprobador
   *   ve la rendición apenas se carga el primer comprobante, aunque el
   *   colaborador todavía no la haya enviado (`open`).
   * Ninguno usa la relación en vivo usuario→coordinador ni el aprobador actual
   * del centro de costo, así que si este cambia, las solicitudes ya creadas
   * conservan a su coordinador original.
   */
  async findAllByCoordinator(coordinatorId: string, clientId: string) {
    const coordinatorObjectId = new Types.ObjectId(coordinatorId)
    const chainReportIds = await this.expenseModel
      .find({ 'approverChain.approverIds': coordinatorObjectId })
      .distinct('expenseReportId')
      .exec()
    return await this.expenseReportModel
      .find({
        clientId: new Types.ObjectId(clientId),
        isCajaChica: { $ne: true },
        $or: [
          { assignedCoordinatorId: coordinatorObjectId },
          { type: 'viatico', 'viaticoApproverChain.approverIds': coordinatorObjectId },
          { _id: { $in: chainReportIds } },
        ],
      })
      .populate('userId', 'name email signature bankAccount')
      .populate('createdBy', 'name email')
      // Nombre de categoría por línea de viático (para el detalle al aprobar).
      .populate('viaticoLines.categoryId', 'name')
      // Centro de costo (código/nombre) y Orden de Trabajo, para el detalle de la solicitud.
      .populate('projectId', 'code name')
      .populate('viaticoOrdenTrabajoId', 'nombre costCenterId')
      .populate('directaOrdenTrabajoId', 'nombre costCenterId')
      // Comprobantes: total (monto de la rendición directa) y datos/archivo para
      // mostrar las facturas en el modal de aprobación del jefe inmediato. VD-25.
      .populate('expenseIds', 'total data file expenseType')
      .sort({ createdAt: -1 })
      .exec()
  }

  async findAllByUser(userId: string, clientId: string) {
    const reports = await this.expenseReportModel
      .find({
        userId: new Types.ObjectId(userId),
        clientId: new Types.ObjectId(clientId),
        isCajaChica: { $ne: true },
      })
      .populate('expenseIds', 'total approvalLevel requiredLevels contabilidadStatus')
      .populate('createdBy', 'name email')
      .populate('viaticoLines.categoryId', 'name')
      .populate('projectId', 'code name')
      .populate('viaticoOrdenTrabajoId', 'nombre costCenterId')
      .populate('directaOrdenTrabajoId', 'nombre costCenterId')
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    // Rendiciones de viáticos cuyo anticipo vinculado ya fue aprobado/pagado: el
    // colaborador ya no puede eliminarlas. Se resuelve en un solo query batch.
    const viaticoReportIds = reports
      .filter(r => !r.isDirecta && !(r as any).isCajaChica)
      .map(r => String(r._id))
    const approvedAdvanceSet = new Set(
      await this.advanceService.findApprovedExpenseReportIds(viaticoReportIds)
    )

    return reports.map(r => ({
      ...this.withDeletionApprovalFlag(r),
      hasApprovedLinkedAdvance: approvedAdvanceSet.has(String(r._id)),
    }))
  }

  async findMyCajaChica(userId: string, clientId: string) {
    const reports = await this.expenseReportModel
      .find({
        userId: new Types.ObjectId(userId),
        clientId: new Types.ObjectId(clientId),
        isCajaChica: true,
      })
      .populate(
        'expenseIds',
        'total expenseType fechaEmision proveedor approvalLevel requiredLevels contabilidadStatus'
      )
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    // ¿Cuáles de estas cajas chicas ya fueron jaladas por Contabilidad (en
    // cualquier reporte, borrador o finalizado)? El dueño ya no puede borrarlas.
    const ids = reports.map(r => r._id as Types.ObjectId)
    const referencedSet = new Set<string>()
    if (ids.length > 0) {
      const referencing = await this.cajaChicaReportModel
        .find({ 'selectedReports.expenseReportId': { $in: ids } })
        .select('selectedReports.expenseReportId')
        .lean()
        .exec()
      for (const cc of referencing) {
        for (const sr of (cc as any).selectedReports ?? []) {
          referencedSet.add(String(sr.expenseReportId))
        }
      }
    }

    return reports.map(r => ({
      ...this.withDeletionApprovalFlag(r),
      referencedByCajaChica: referencedSet.has(String(r._id)),
    }))
  }

  /**
   * Anexa `hasApprovedExpense` a un reporte para que el front sepa si algún
   * comprobante ya fue aprobado (coord o contabilidad). Espeja la condición de
   * `remove`: con cualquier aprobación, el colaborador ya no puede eliminar la
   * solicitud, así que el botón no debe mostrarse.
   */
  private withDeletionApprovalFlag(report: any) {
    const hasApprovedExpense = (report.expenseIds ?? []).some(
      (e: any) => (e?.approvalLevel ?? 0) > 0 || e?.contabilidadStatus === 'approved'
    )
    // `createdByOther`: la solicitud la creó alguien distinto del dueño (ej.
    // Contabilidad creó una rendición directa para el colaborador). En ese caso
    // el dueño no puede eliminarla; el front oculta el botón.
    const createdById = String(report.createdBy?._id ?? report.createdBy ?? '')
    const ownerId = String(report.userId?._id ?? report.userId ?? '')
    const createdByOther = !!createdById && !!ownerId && createdById !== ownerId
    return { ...report, hasApprovedExpense, createdByOther }
  }

  async findAllCajaChicaAvailable(clientId: string) {
    return await this.expenseReportModel
      .find({
        clientId: new Types.ObjectId(clientId),
        isCajaChica: true,
      })
      .populate('userId', 'name email')
      .populate({
        path: 'expenseIds',
        select:
          'total expenseType fechaEmision proveedor data mobilityRows description categoryId proyectId',
        populate: [
          { path: 'categoryId', select: 'name' },
          { path: 'proyectId', select: 'name code' },
        ],
      })
      .sort({ createdAt: -1 })
      .exec()
  }

  async findExpensesPaginated(
    reportId: string,
    opts: {
      page: number
      limit: number
      type?: string
      status?: string
      search?: string
    }
  ) {
    const report = await this.expenseReportModel
      .findById(reportId)
      .select('expenseIds')
      .exec()
    if (!report) throw new NotFoundException(`Report ${reportId} not found`)

    const ids = report.expenseIds.map(id => new Types.ObjectId(id.toString()))
    if (ids.length === 0) {
      return {
        data: [],
        total: 0,
        page: opts.page,
        limit: opts.limit,
        pages: 0,
      }
    }

    const filter: Record<string, unknown> = { _id: { $in: ids } }
    const and: Record<string, unknown>[] = []
    if (opts.type && opts.type !== 'all') {
      filter['expenseType'] = opts.type
    }
    if (opts.status && opts.status !== 'all') {
      // `status` en Expense refleja siempre computeCombinedStatus(cadena, contabilidad)
      // desde cada mutación (approve/reject por documento, batch, resubmit), así
      // que el filtro puede leerlo directo — ya no hace falta reconstruirlo desde
      // los campos de aprobación dual (retirados, ver Expense.approverChain).
      filter['status'] = opts.status
    }
    if (opts.search?.trim()) {
      // El "concepto" se guarda en distintos campos según el tipo de
      // comprobante (description plano, JSON dentro de description/data, o
      // mobilityRows[].gestion/origen/destino), por lo que el search debe
      // cubrir todos esos lugares.
      const term = opts.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const rx = { $regex: term, $options: 'i' }
      and.push({
        $or: [
          { description: rx },
          { data: rx },
          { 'mobilityRows.gestion': rx },
          { 'mobilityRows.concepto': rx },
          { 'mobilityRows.origen': rx },
          { 'mobilityRows.destino': rx },
          { 'mobilityRows.clienteProveedor': rx },
        ],
      })
    }
    if (and.length) filter['$and'] = and

    const all = await this.expenseModel
      .find(filter)
      .populate('categoryId', 'name')
      .populate('proyectId', 'name code')
      // Nombres de los aprobadores de cada paso de la cadena (regla 1.4) para
      // mostrarlos en la columna Estado en vez del ObjectId crudo, que no es
      // legible para el usuario.
      .populate('approverChain.approverIds', 'name email')
      .exec()

    const sorted = (all as unknown as Record<string, unknown>[]).sort(
      (a, b) => {
        const dA =
          parseFechaEmisionInput(a['fechaEmision'] as string | undefined) ??
          new Date((a['createdAt'] as string | undefined) ?? 0)
        const dB =
          parseFechaEmisionInput(b['fechaEmision'] as string | undefined) ??
          new Date((b['createdAt'] as string | undefined) ?? 0)
        return dB.getTime() - dA.getTime()
      }
    )

    const total = sorted.length
    const skip = (opts.page - 1) * opts.limit
    const data = sorted
      .slice(skip, skip + opts.limit)
      .map(e =>
        applyFechaEmisionDisplayToExpense(
          e as { fechaEmision?: unknown; data?: unknown }
        )
      )

    return {
      data,
      total,
      page: opts.page,
      limit: opts.limit,
      pages: Math.ceil(total / opts.limit),
    }
  }

  /**
   * ¿La rendición está incluida en un reporte de caja chica ya finalizado por
   * Contabilidad? Al finalizar, el total queda congelado, por lo que el
   * colaborador no debe poder agregar ni modificar gastos en esa rendición.
   */
  async isLockedByFinalizedCajaChica(reportId: string): Promise<boolean> {
    if (!reportId || !Types.ObjectId.isValid(reportId)) return false
    const count = await this.cajaChicaReportModel
      .countDocuments({
        status: 'finalized',
        'selectedReports.expenseReportId': new Types.ObjectId(reportId),
      })
      .exec()
    return count > 0
  }

  /**
   * ¿La rendición de caja chica ya fue incluida (jalada) por Contabilidad en
   * algún reporte de caja chica, esté en borrador o finalizado? Una vez jalada,
   * el colaborador ya no puede eliminar su caja chica (rompería la
   * consolidación); solo Contabilidad puede.
   */
  async isReferencedByCajaChica(reportId: string): Promise<boolean> {
    if (!reportId || !Types.ObjectId.isValid(reportId)) return false
    const count = await this.cajaChicaReportModel
      .countDocuments({
        'selectedReports.expenseReportId': new Types.ObjectId(reportId),
      })
      .exec()
    return count > 0
  }

  /** Lanza 403 si la rendición pertenece a una caja chica ya finalizada. */
  async assertReportNotLockedByCajaChica(reportId?: string): Promise<void> {
    if (!reportId) return
    if (await this.isLockedByFinalizedCajaChica(reportId)) {
      throw new ForbiddenException(
        'La caja chica de esta rendición fue finalizada por Contabilidad. No se pueden agregar ni modificar más gastos.'
      )
    }
  }

  async findOne(id: string) {
    const report = await this.expenseReportModel
      .findById(id)
      .populate('userId', 'name email signature bankAccount dni area')
      .populate({
        path: 'expenseIds',
        populate: [
          { path: 'categoryId', select: 'name cuenta' },
          { path: 'proyectId', select: 'name' },
          // OT y su centro de costo por gasto (columnas OT / C.COSTO del formato
          // ADF-FOR-004). costCenterId se popula anidado para obtener el nombre.
          {
            path: 'ordenTrabajoId',
            select: 'nombre costCenterId',
            populate: { path: 'costCenterId', select: 'code name' },
          },
          // Aprobadores N1/N2 esperados por comprobante (regla 1.4) y quién
          // aprobó por Contabilidad — para mostrar nombres reales (no roles
          // genéricos) en la sección Estado de la RENDICIÓN.
          { path: 'approverChain.approverIds', select: 'name email' },
          { path: 'contabilidadApprovedBy', select: 'name email' },
        ],
      })
      .populate('createdBy', 'name email')
      // Firma incluida para el recuadro V°B° JEFE INMEDIATO del formato ADF-FOR-004
      // (fallback cuando no hubo coordinador).
      .populate('approvedBy', 'name email signature')
      // Coordinador snapshot de la rendición (regla 1.4, rendición normal/directa
      // sin cadena por comprobante): nombre para mostrarlo en la sección Estado.
      .populate('assignedCoordinatorId', 'name email')
      // Coordinador que aprobó: se incluye su firma/DNI para el PDF de la planilla
      // de movilidad (firma del colaborador y del coordinador, VD-33).
      .populate('coordinatorApprovedBy', 'name email signature dni')
      // Contabilidad que dio la aprobación final: nombre y firma para la trazabilidad
      // y el recuadro V°B° FINANZAS (VD-31).
      .populate('contabilidadApprovedBy', 'name email signature')
      // Contabilidad que aprobó la SOLICITUD del viático (regla 1.3) — distinto de
      // contabilidadApprovedBy, que es de la RENDICIÓN (regla 1.4, posterior al pago).
      .populate('viaticoSolicitudContabilidadApprovedBy', 'name email')
      .populate('projectId', 'name')
      .populate({
        path: 'viaticoOrdenTrabajoId',
        select: 'nombre costCenterId',
        populate: { path: 'costCenterId', select: 'code name' },
      })
      .populate({
        path: 'directaOrdenTrabajoId',
        select: 'nombre costCenterId',
        populate: { path: 'costCenterId', select: 'code name' },
      })
      .populate('viaticoApproverChain.approverIds', 'name email')
      .exec()

    if (!report) {
      throw new NotFoundException(`Expense report with ID ${id} not found`)
    }
    const normalized = this.normalizeReportExpenseDates(report)
      // Flag derivado para el front: si la caja chica fue finalizada, el
      // colaborador ya no puede subir gastos (botón "Añadir Gasto" oculto).
      ; (
        normalized as unknown as { lockedByCajaChica?: boolean }
      ).lockedByCajaChica =
        (normalized as unknown as { isCajaChica?: boolean }).isCajaChica === true
          ? await this.isLockedByFinalizedCajaChica(id)
          : false
    return normalized
  }

  private normalizeReportExpenseDates(report: ExpenseReportDocument) {
    // Convertimos a POJO antes de tocar `expenseIds`: asignar POJOs sobre un
    // Document hace que Mongoose castee cada elemento de vuelta a ObjectId
    // (por el `ref: 'Expense'` del schema), descartando los datos populados.
    const pojo =
      typeof (report as { toObject?: () => unknown }).toObject === 'function'
        ? (
          report as unknown as { toObject: () => Record<string, unknown> }
        ).toObject()
        : (report as unknown as Record<string, unknown>)

    const raw = pojo.expenseIds
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object') {
      pojo.expenseIds = applyFechaEmisionDisplayToExpenses(
        raw as { fechaEmision?: unknown; data?: unknown }[]
      )
    }
    return pojo as unknown as ExpenseReportDocument
  }

  /**
   * Notifica a Contabilidad que una rendición quedó lista para su aprobación
   * final (coordinador/cadena de centro de costo ya completada), y al
   * colaborador que ya pasó ese paso. Compartido entre la rendición normal
   * (coordinador único, desde `update()`) y la rendición directa (cadena del
   * jefe inmediato, desde `approveDirecta`).
   */
  private async notifyAccountingReportPendingApproval(
    id: string,
    fullyUpdatedReport: any
  ): Promise<void> {
    try {
      const clientId = String(fullyUpdatedReport.clientId)
      const ownerRef = fullyUpdatedReport.userId as any
      const ownerId = ownerRef?._id ? String(ownerRef._id) : String(ownerRef)
      const collaboratorName =
        (typeof ownerRef === 'object' && ownerRef?.name) || 'Colaborador'
      const reportTitle = fullyUpdatedReport.title
      const budgetFormatted = (
        await this.computeReportBudgetDisplay(fullyUpdatedReport)
      ).toFixed(2)
      const expenseCount = fullyUpdatedReport.expenseIds?.length ?? 0
      const platformUrl = this.emailService.buildAppUrl(
        `/mis-rendiciones/${id}/detalle`
      )

      const ownerProfile =
        await this.userService.findTransactionalProfile(ownerId)
      const ownerCoordinatorId =
        ownerProfile?.coordinatorId?.toString?.() || ''
      const ownerEmailLower =
        typeof ownerRef === 'object' && ownerRef?.email
          ? String(ownerRef.email).trim().toLowerCase()
          : ''

      const accountingUsersRaw =
        await this.userService.findAccountingRecipientsWithIds(clientId)
      const accountingUsers = accountingUsersRaw.filter(
        u =>
          u._id !== ownerId &&
          u._id !== ownerCoordinatorId &&
          (ownerEmailLower
            ? u.email?.trim().toLowerCase() !== ownerEmailLower
            : true)
      )
      for (const u of accountingUsers) {
        await this.notificationsService.create({
          userId: u._id,
          title: 'Rendición aprobada por Coordinador',
          message: `La rendición "${reportTitle}" fue aprobada por el coordinador y está lista para tu aprobación final.`,
          type: 'info',
          actionUrl: `/mis-rendiciones/${id}/detalle`,
        })

        try {
          const accountingEmailEnabled =
            await this.userService.isEmailEnabled(u._id)
          if (accountingEmailEnabled) {
            await this.emailService.sendRendicionPendienteContabilidad(
              u.email,
              {
                clientId,
                recipientName: u.name,
                collaboratorName,
                reportTitle,
                budgetFormatted,
                expenseCount,
                platformUrl,
              }
            )
          }
        } catch (mailErr) {
          console.error(
            `[pending_accounting] Error correo contabilidad ${u.email}:`,
            mailErr
          )
        }
      }

      await this.notificationsService.create({
        userId: ownerId,
        title: 'Tu rendición fue aprobada por el Coordinador',
        message: `Tu rendición "${reportTitle}" fue aprobada por el coordinador. Contabilidad realizará la revisión final.`,
        type: 'success',
        actionUrl: `/mis-rendiciones/${id}/detalle`,
      })
    } catch (error) {
      console.error(
        'Error enviando notificaciones a contabilidad (pending_accounting)',
        error
      )
    }
  }

  async update(id: string, updateExpenseReportDto: UpdateExpenseReportDto) {
    const dto = updateExpenseReportDto
    const existing = await this.expenseReportModel
      .findById(id)
      .select('status isDirecta type clientId projectId userId expenseIds')
      .lean()
      .exec()
    if (!existing) {
      throw new NotFoundException(`Expense report with ID ${id} not found`)
    }
    const isDirecta = (existing as any).isDirecta === true
    // Viático con pago parcial: sigue en fase de carga, el colaborador puede enviarlo
    // aunque contabilidad aún no complete el depósito (lo completa tras el envío).
    const isPartialViatico =
      (existing as any).type === 'viatico' &&
      existing.status === 'partially_paid'

    if (dto.status === 'reimbursed') {
      throw new BadRequestException(
        'El estado reembolsado se registra únicamente al cargar el comprobante de pago en tesorería.'
      )
    }

    if (
      dto.status === 'submitted' &&
      existing.status !== 'open' &&
      existing.status !== 'rejected' &&
      !isPartialViatico
    ) {
      throw new BadRequestException(
        'Solo se puede enviar una rendición en estado abierta o rechazada.'
      )
    }
    if (dto.status === 'submitted') {
      await this.validateBeforeSubmit(id)
    }
    if (dto.status === 'solicited' && existing.status !== 'rejected') {
      throw new BadRequestException(
        'Solo se puede re-enviar una solicitud en estado rechazada.'
      )
    }
    if (dto.status === 'open' && existing.status !== 'solicited') {
      throw new BadRequestException(
        'Solo se puede aprobar una solicitud en estado solicitada.'
      )
    }
    if (
      dto.status === 'rejected' &&
      existing.status !== 'submitted' &&
      existing.status !== 'solicited' &&
      existing.status !== 'pending_accounting'
    ) {
      throw new BadRequestException(
        'Solo se pueden rechazar rendiciones enviadas, solicitadas o pendientes de contabilidad.'
      )
    }
    if (
      dto.status === 'pending_accounting' &&
      existing.status !== 'submitted'
    ) {
      throw new BadRequestException(
        'Solo se puede enviar a contabilidad una rendicion en estado enviada.'
      )
    }
    if (dto.status === 'pending_accounting') {
      await this.validateBeforeFinalApproval(id)
    }
    if (dto.status === 'approved' && existing.status !== 'pending_accounting') {
      throw new BadRequestException(
        'Solo se puede aprobar una rendicion pendiente de contabilidad.'
      )
    }
    // Un viático con pago parcial SÍ puede aprobarse aunque quede saldo del anticipo
    // sin depositar: la liquidación reconcilia con lo realmente pagado
    // (viaticoPaidAmount) vs lo gastado → reembolso al colaborador o devolución según
    // el caso. El saldo no depositado simplemente no entra en la cuenta.

    const $set: Record<string, unknown> = {}
    const $unset: Record<string, ''> = {}

    // Solo campos definidos: evita $set con undefined y no pisa expenseIds por error
    if (dto.title !== undefined) $set.title = dto.title
    if (dto.description !== undefined) $set.description = dto.description
    if (dto.budget !== undefined) $set.budget = dto.budget

    // Al enviar (o reenviar tras rechazo) una rendición — normal, directa, de
    // caja chica, o la RENDICIÓN de comprobantes de un viático ya pagado — se
    // (re)construye la cadena de aprobación por documento (regla 1.4) de cada
    // uno de sus comprobantes — ver `buildExpenseChains`. La SOLICITUD del
    // viático (createViatico/resubmitViatico, regla 1.3) tiene su propio flujo
    // y no pasa por aquí; pero una vez pagado y enviado a rendición, sus
    // comprobantes necesitan la misma cadena N1/N2 que cualquier otra.
    if (dto.status !== undefined) {
      if (dto.status === 'submitted') {
        const ownerId = (existing as any).userId?.toString()
        const reportClientId = (existing as any).clientId?.toString()
        if (ownerId && reportClientId) {
          await this.buildExpenseChains(
            ((existing as any).expenseIds ?? []) as Types.ObjectId[],
            ownerId,
            reportClientId
          )
        }
        $set.status = 'submitted'
      } else {
        $set.status = dto.status
      }
    }
    if (dto.userId !== undefined) $set.userId = new Types.ObjectId(dto.userId)
    if (dto.clientId !== undefined)
      $set.clientId = new Types.ObjectId(dto.clientId)
    if (dto.projectId !== undefined) {
      $set.projectId = dto.projectId ? new Types.ObjectId(dto.projectId) : null
      // El centro de costo cambió: se re-snapshotea su coordinador. Si se limpia
      // el centro de costo, también se limpia el coordinador asignado.
      $set.assignedCoordinatorId = dto.projectId
        ? (await this.resolveAssignedCoordinatorId(
          dto.projectId,
          String((existing as any).clientId)
        )) ?? null
        : null
    }
    if (dto.expenseIds !== undefined && Array.isArray(dto.expenseIds)) {
      $set.expenseIds = dto.expenseIds.map(eId => new Types.ObjectId(eId))
    }

    if (dto.status === 'rejected') {
      const reason =
        typeof dto.rejectionReason === 'string'
          ? dto.rejectionReason.trim()
          : ''
      if (!reason) {
        throw new BadRequestException(
          'El motivo de rechazo es obligatorio para rechazar una rendición.'
        )
      }
      $set.rejectionReason = reason
      // Quién rechazó se infiere del estado previo: pending_accounting → Contabilidad;
      // submitted/solicited → Coordinador.
      $set.rejectedByRole =
        existing.status === 'pending_accounting'
          ? 'contabilidad'
          : 'coordinador'
    } else if (
      dto.rejectionReason !== undefined &&
      dto.status !== 'submitted'
    ) {
      $set.rejectionReason = dto.rejectionReason?.trim() || ''
    }

    if (dto.status === 'submitted' || dto.status === 'solicited') {
      $unset.rejectionReason = ''
      $unset.rejectedByRole = ''
    }

    const updatePayload: Record<string, unknown> = {}
    if (Object.keys($set).length > 0) updatePayload.$set = $set
    if (Object.keys($unset).length > 0) updatePayload.$unset = $unset

    if (Object.keys(updatePayload).length > 0) {
      const updated = await this.expenseReportModel
        .findByIdAndUpdate(id, updatePayload, { new: true })
        .exec()
      if (!updated) {
        throw new NotFoundException(`Expense report with ID ${id} not found`)
      }
    }

    // findByIdAndUpdate no hace populate: la UI necesita expenseIds como documentos
    const fullyUpdatedReport = await this.findOne(id)

    // Si la rendición solicitada fue editada sin cambio de estado, re-notificar admins
    if (existing.status === 'solicited' && dto.status === undefined) {
      try {
        const admins = await this.userService.findAdminsByClient(
          String(fullyUpdatedReport.clientId)
        )
        const ownerRef = fullyUpdatedReport.userId as any
        const ownerId = ownerRef?._id ? String(ownerRef._id) : String(ownerRef)
        const user = await this.userService.findOne(ownerId)
        const creatorName = user.name || 'Un colaborador'
        for (const admin of admins) {
          await this.notificationsService.create({
            userId: String(admin._id),
            title: 'Solicitud de rendición actualizada',
            message: `${creatorName} ha actualizado su solicitud de rendición: "${fullyUpdatedReport.title}"`,
            type: 'info',
            actionUrl: `/mis-rendiciones/${id}/detalle`,
          })
        }
      } catch (error) {
        console.error(
          'Error enviando notificaciones de rendición actualizada',
          error
        )
      }
    }

    // Coordinador aprueba la rendición normal (→ pending_accounting): notificar a contabilidad + colaborador
    // No aplica a rendiciones directas (para directa se llama desde approveDirecta al completar su cadena)
    if (dto.status === 'pending_accounting' && !isDirecta) {
      await this.notifyAccountingReportPendingApproval(id, fullyUpdatedReport)
    }

    // Contabilidad aprueba la rendición (→ approved): notificar colaborador
    // En rendición directa: solo colaborador. En flujo normal: colaborador + coordinador.
    if (dto.status === 'approved') {
      console.log(`[APROBACIÓN RENDICIÓN] Entrando al bloque approved para rendición ${id}`)
      const owner = fullyUpdatedReport.userId as any
      const ownerId = owner?._id ? String(owner._id) : String(owner)

      const reportTitle = fullyUpdatedReport.title
      const budgetDisplay =
        await this.computeReportBudgetDisplay(fullyUpdatedReport)
      const budgetFormatted = budgetDisplay.toFixed(2)
      const platformUrl = this.emailService.buildAppUrl(
        `/mis-rendiciones/${id}/detalle`
      )
      const collaboratorName =
        (typeof owner === 'object' && owner?.name) || 'Colaborador'

      try {
        const ownerEmail =
          (typeof owner === 'object' && owner?.email) || undefined
        const ownerEmailEnabled = ownerId
          ? await this.userService.isEmailEnabled(ownerId)
          : false
        if (ownerEmail && ownerEmailEnabled) {
          await this.emailService.sendRendicionFullyApprovedEmail(ownerEmail, {
            clientId: String(fullyUpdatedReport.clientId),
            userName: collaboratorName,
            title: reportTitle,
            budget: budgetDisplay,
            platformUrl,
          })
        }
        await this.notificationsService.create({
          userId: ownerId,
          title: 'Rendición aprobada por Contabilidad',
          message: `Tu rendición "${reportTitle}" ha sido aprobada por contabilidad. Revisa el detalle para los próximos pasos.`,
          type: 'success',
          actionUrl: `/mis-rendiciones/${id}/detalle`,
        })

        // Notificar al coordinador solo en el flujo normal (no en rendición directa).
        if (!isDirecta) {
          const profile =
            await this.userService.findTransactionalProfile(ownerId)
          const coordinatorId = profile?.coordinatorId?.toString?.()
          if (coordinatorId) {
            await this.notificationsService.create({
              userId: coordinatorId,
              title: 'Rendición aprobada por Contabilidad',
              message: `La rendición "${reportTitle}" fue aprobada por contabilidad.`,
              type: 'info',
              actionUrl: `/mis-rendiciones/${id}/detalle`,
            })

            try {
              const coordinator =
                await this.userService.findEmailNameClient(coordinatorId)
              const coordinatorEmailEnabled =
                await this.userService.isEmailEnabled(coordinatorId)
              if (coordinator?.email && coordinatorEmailEnabled) {
                await this.emailService.sendRendicionAprobadaCoordinador(
                  coordinator.email,
                  {
                    clientId: String(fullyUpdatedReport.clientId),
                    coordinatorName: coordinator.name,
                    collaboratorName,
                    reportTitle,
                    budgetFormatted,
                    platformUrl,
                  }
                )
              }
            } catch (mailErr) {
              console.error(
                `[approved] Error correo rendición aprobada a coordinador ${coordinatorId}:`,
                mailErr
              )
            }
          }
        }
      } catch (error) {
        console.error(
          'Error enviando notificaciones de rendición aprobada por contabilidad',
          error
        )
      }

      // Enviar correo a tesorería con datos de pago al colaborador.
      try {
        const clientIdStr = String(fullyUpdatedReport.clientId)
        console.log(`[TESORESRÍA RENDICIÓN] Buscando usuarios de tesorería para clientId=${clientIdStr}`)
        const tesoreriaRecipients = await this.userService.findTesoreriaNotifyRecipients(clientIdStr)
        const tesoreriaEmails = tesoreriaRecipients.map(r => r.email)
        console.log(`[TESORERÍA RENDICIÓN] Emails de tesorería: ${JSON.stringify(tesoreriaEmails)}`)
        if (tesoreriaEmails.length > 0) {
          const bank = (typeof owner === 'object' && owner?.bankAccount) || null
          const hasBankAccount = !!(bank?.accountNumber)
          console.log(`[TESORERÍA RENDICIÓN] hasBankAccount=${hasBankAccount}, banco=${bank?.bankName}`)
          const tesoreriaEmailData = {
            clientId: clientIdStr,
            reportTitle,
            collaboratorName,
            collaboratorDni: (typeof owner === 'object' && owner?.dni) || undefined,
            budgetFormatted: Number(budgetDisplay).toFixed(2),
            hasBankAccount,
            bankName: bank?.bankName || undefined,
            accountType: bank?.accountType === 'ahorros' ? 'Ahorros' : bank?.accountType === 'corriente' ? 'Corriente' : undefined,
            accountNumber: bank?.accountNumber || undefined,
            cci: bank?.cci || undefined,
            platformUrl,
          }
          for (const tesoEmail of tesoreriaEmails) {
            console.log(`[TESORERÍA RENDICIÓN] Enviando a ${tesoEmail}...`)
            await this.emailService.sendRendicionAprobadaTesoreria(tesoEmail, tesoreriaEmailData)
            console.log(`[TESORERÍA RENDICIÓN] Enviado a ${tesoEmail} OK`)
          }
        }
      } catch (err) {
        console.error(`[TESORERÍA RENDICIÓN] ERROR:`, err)
      }

      try {
        await this.advanceService.liquidateExpenseReport(id)
      } catch (err) {
        console.error(
          `[ExpenseReportService] Liquidación post-aprobación ${id}:`,
          err
        )
      }

      // Si la liquidación arroja saldo a favor de la empresa, avisar al colaborador.
      try {
        const liquidated = await this.expenseReportModel
          .findById(id)
          .select('settlement title clientId')
          .lean<{
            settlement?: { type?: string; difference?: number }
            title?: string
            clientId?: any
          }>()
          .exec()
        const diffAbs = Math.abs(
          Number(liquidated?.settlement?.difference ?? 0)
        )
        if (liquidated?.settlement?.type === 'devolucion' && diffAbs >= 0.01) {
          const amountFormatted = diffAbs.toFixed(2)
          const ownerEmailLocal =
            (typeof owner === 'object' && owner?.email) || undefined
          if (ownerEmailLocal) {
            const ownerEmailEnabledLocal = ownerId
              ? await this.userService.isEmailEnabled(ownerId)
              : false
            if (ownerEmailEnabledLocal) {
              await this.emailService.sendRendicionDevolucionColaborador(
                ownerEmailLocal,
                {
                  clientId: String(
                    liquidated.clientId ?? fullyUpdatedReport.clientId
                  ),
                  recipientName: collaboratorName,
                  reportTitle: liquidated.title ?? reportTitle,
                  amountFormatted,
                  closedAt: this.emailService.formatDateDDMMYYYY(new Date()),
                  platformUrl,
                }
              )
            }
          }
          await this.notificationsService
            .create({
              userId: ownerId,
              title: 'Saldo pendiente de devolución',
              message: `Tu rendición "${reportTitle}" fue aprobada. Tienes un saldo de S/ ${amountFormatted} a devolver a la empresa.`,
              type: 'warning',
              actionUrl: `/mis-rendiciones/${id}/detalle`,
            })
            .catch(() => { })
        }
      } catch (err) {
        console.error(
          `[ExpenseReportService] Aviso devolución post-aprobación ${id}:`,
          err
        )
      }

    }

    // Rendición enviada (submitted)
    if (dto.status === 'submitted') {
      try {
        const ownerRef2 = fullyUpdatedReport.userId as any
        const ownerId2 = ownerRef2?._id
          ? String(ownerRef2._id)
          : String(ownerRef2)
        const user = await this.userService.findOne(ownerId2)
        const creatorName = user.name || 'Un colaborador'
        const clientId = String(fullyUpdatedReport.clientId)
        const budgetFormatted = (
          await this.computeReportBudgetDisplay(fullyUpdatedReport)
        ).toFixed(2)
        const expenseCount = fullyUpdatedReport.expenseIds?.length ?? 0
        const expenseDocs = Array.isArray(fullyUpdatedReport.expenseIds)
          ? fullyUpdatedReport.expenseIds
          : []
        const expenseTotal = expenseDocs.reduce(
          (s: number, e: any) => s + (Number(e?.total) || 0),
          0
        )
        const expenseTotalFormatted = expenseTotal.toFixed(2)
        const expenseItems = expenseDocs.map((e: any) => ({
          categoryName: e?.categoryId?.name || 'Gasto',
          description: e?.description || '',
          totalFormatted: (Number(e?.total) || 0).toFixed(2),
        }))
        const platformUrl = this.emailService.buildAppUrl(
          `/mis-rendiciones/${id}/detalle`
        )

        // Rendición directa iniciada por Contabilidad: mostrar depósito y saldo en el correo.
        const directaDepositAmount = Number(
          (fullyUpdatedReport as any).directaDeposit?.amount ?? 0
        )
        const hasDirectaDeposit = isDirecta && directaDepositAmount > 0
        const depositFormatted = directaDepositAmount.toFixed(2)
        const saldoFormatted = (directaDepositAmount - expenseTotal).toFixed(2)

        const emailData = {
          clientId,
          collaboratorName: creatorName,
          reportTitle: fullyUpdatedReport.title,
          budgetFormatted,
          expenseCount,
          expenseTotalFormatted,
          expenseItems,
          isDirecta,
          hasDirectaDeposit,
          depositFormatted,
          saldoFormatted,
          platformUrl,
        }

        // Email del colaborador autor: lo reservamos primero en sentEmails para
        // que, si por configuración también figura en Contabilidad/Tesorería,
        // NO reciba el correo orientado al revisor; solo la confirmación "Usted
        // ha enviado…" que va al final.
        const ownerEmail = (fullyUpdatedReport.userId as any)?.email as
          | string
          | undefined
        const ownerEmailKey = ownerEmail?.trim().toLowerCase() || ''

        if (isDirecta) {
          // Rendición directa: la cadena de aprobación ya no es a nivel de
          // reporte — cada comprobante tiene la suya (ver `buildExpenseChains`).
          // TODO(7.7): notificar a los approverIds del paso pendiente de cada
          // comprobante recién construido, igual que `notifyViaticoCoordinator`.
          await this.notificationsService.create({
            userId: ownerId2,
            title: 'Rendición enviada para aprobación',
            message: `Tu rendición "${fullyUpdatedReport.title}" fue enviada y está pendiente de aprobación por centro de costo.`,
            type: 'info',
            actionUrl: `/mis-rendiciones/${id}/detalle`,
          })
        } else {
          // Flujo normal: admins in-app + coordinador (in-app + correo) + contabilidad.
          const admins = await this.userService.findAdminsByClient(clientId)
          for (const admin of admins) {
            await this.notificationsService.create({
              userId: String(admin._id),
              title: 'Rendición Enviada',
              message: `${creatorName} ha enviado la rendición "${fullyUpdatedReport.title}" para tu revisión.`,
              type: 'warning',
              actionUrl: `/mis-rendiciones/${id}/detalle`,
            })
          }

          const sentEmails = new Set<string>()
          if (ownerEmailKey) sentEmails.add(ownerEmailKey)

          const profile =
            await this.userService.findTransactionalProfile(ownerId2)
          const coordinatorId = profile?.coordinatorId?.toString?.()
          if (coordinatorId) {
            const coordinator =
              await this.userService.findEmailNameClient(coordinatorId)
            if (coordinator?.email) {
              const coordEmailKey = coordinator.email.trim().toLowerCase()
              if (!sentEmails.has(coordEmailKey)) {
                sentEmails.add(coordEmailKey)
                const coordEmailEnabled =
                  await this.userService.isEmailEnabled(coordinatorId)
                if (coordEmailEnabled) {
                  await this.emailService.sendRendicionSubmitted(
                    coordinator.email,
                    {
                      recipientName: coordinator.name,
                      ...emailData,
                    }
                  )
                }
              }
            }
          }

          const accountingRecipients =
            await this.userService.findContabilidadRecipients(clientId)
          for (const r of accountingRecipients) {
            const key = r.email.trim().toLowerCase()
            if (sentEmails.has(key)) continue
            sentEmails.add(key)
            await this.emailService.sendRendicionSubmitted(r.email, {
              recipientName: r.name,
              ...emailData,
            })
          }
        }

        // Confirmación al colaborador autor de la rendición (siempre, si tiene email habilitado).
        if (ownerEmail) {
          const ownerEmailEnabled =
            await this.userService.isEmailEnabled(ownerId2)
          if (ownerEmailEnabled) {
            await this.emailService.sendRendicionSubmittedToColaborador(
              ownerEmail,
              {
                clientId,
                collaboratorName: creatorName,
                reportTitle: emailData.reportTitle,
                budgetFormatted: emailData.budgetFormatted,
                expenseCount: emailData.expenseCount,
                hasDirectaDeposit: emailData.hasDirectaDeposit,
                depositFormatted: emailData.depositFormatted,
                expenseTotalFormatted: emailData.expenseTotalFormatted,
                saldoFormatted: emailData.saldoFormatted,
                platformUrl: emailData.platformUrl,
              }
            )
          }
        }
      } catch (error) {
        console.error('Error enviando notificaciones (update/submitted)', error)
      }
    }

    // Rendición rechazada: notificar al colaborador (siempre) y al coordinador (solo si la rechazó Contabilidad).
    if (dto.status === 'rejected') {
      try {
        const ownerRef = fullyUpdatedReport.userId as any
        const ownerId = ownerRef?._id ? String(ownerRef._id) : String(ownerRef)
        const collaboratorName =
          (typeof ownerRef === 'object' && ownerRef?.name) || 'Colaborador'
        const ownerEmail =
          (typeof ownerRef === 'object' && ownerRef?.email) || undefined
        const reportTitle = fullyUpdatedReport.title
        const rejectionReason =
          (fullyUpdatedReport as any).rejectionReason || 'Ver detalle'
        // Distinguir quién rechazó según el estado previo del documento.
        const rejectedByContabilidad = existing.status === 'pending_accounting'
        const rejectedByLabel = rejectedByContabilidad
          ? 'Contabilidad'
          : 'el Coordinador'
        const platformUrl = this.emailService.buildAppUrl(
          `/mis-rendiciones/${id}/detalle`
        )

        await this.notificationsService.create({
          userId: ownerId,
          title: 'Rendición rechazada',
          message: `Tu rendición "${reportTitle}" fue rechazada por ${rejectedByLabel}. Motivo: ${rejectionReason}`,
          type: 'error',
          actionUrl: `/mis-rendiciones/${id}/detalle`,
        })

        // Correo al colaborador.
        if (ownerEmail) {
          const ownerEmailEnabled =
            await this.userService.isEmailEnabled(ownerId)
          if (ownerEmailEnabled) {
            await this.emailService.sendRendicionRechazadaColaborador(
              ownerEmail,
              {
                clientId: String(fullyUpdatedReport.clientId),
                collaboratorName,
                reportTitle,
                rejectionReason,
                rejectedBy: rejectedByLabel,
                platformUrl,
              }
            )
          }
        }

        // Si lo rechazó Contabilidad, también notificar al coordinador (in-app + correo).
        if (rejectedByContabilidad) {
          const profile =
            await this.userService.findTransactionalProfile(ownerId)
          const coordinatorId = profile?.coordinatorId?.toString?.()
          if (coordinatorId) {
            await this.notificationsService.create({
              userId: coordinatorId,
              title: 'Rendición rechazada por Contabilidad',
              message: `La rendición "${reportTitle}" de ${collaboratorName} fue rechazada por Contabilidad. Motivo: ${rejectionReason}`,
              type: 'warning',
              actionUrl: `/mis-rendiciones/${id}/detalle`,
            })

            try {
              const coordinator =
                await this.userService.findEmailNameClient(coordinatorId)
              const coordinatorEmailEnabled =
                await this.userService.isEmailEnabled(coordinatorId)
              if (coordinator?.email && coordinatorEmailEnabled) {
                await this.emailService.sendRendicionRechazadaCoordinador(
                  coordinator.email,
                  {
                    clientId: String(fullyUpdatedReport.clientId),
                    coordinatorName: coordinator.name,
                    collaboratorName,
                    reportTitle,
                    rejectionReason,
                    platformUrl,
                  }
                )
              }
            } catch (mailErr) {
              console.error(
                `[rejected] Error correo rechazo a coordinador ${coordinatorId}:`,
                mailErr
              )
            }
          }
        }
      } catch (error) {
        console.error(
          'Error enviando notificación de rechazo de rendición',
          error
        )
      }
    }

    return fullyUpdatedReport
  }

  /**
   * Extrae la "key" de S3 a partir de la URL pública del archivo.
   * Devuelve null si la URL no es absoluta o no se puede parsear.
   */
  private extractS3Key(fileUrl?: string): string | null {
    if (!fileUrl) return null
    try {
      const parsed = new URL(fileUrl)
      const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
      return key || null
    } catch {
      return null
    }
  }

  /** Borra un archivo de S3 en modo best-effort (no interrumpe el flujo si falla). */
  private async tryDeleteS3File(fileUrl?: string): Promise<void> {
    const key = this.extractS3Key(fileUrl)
    if (!key) return
    try {
      await this.uploadService.deleteFile(key)
    } catch (err) {
      console.error('[remove] No se pudo eliminar archivo de S3:', fileUrl, err)
    }
  }

  /**
   * Evalúa si `actor` puede eliminar `report` (mismas reglas documentadas en
   * `remove()`), sin lanzar excepción ni mutar nada. La usan tanto `remove()`
   * (que sí lanza `ForbiddenException` si `!allowed`) como `getDeletionPreview()`
   * (solo lectura, para la advertencia previa a confirmar en el front).
   */
  private async evaluateDeleteAuthorization(
    report: any,
    expenses: {
      approvalLevel?: number
      contabilidadStatus?: string
    }[],
    actor: SolicitudDeleteActor
  ): Promise<{
    allowed: boolean
    reason?: string
    linkedAdvances: { _id: Types.ObjectId; status: string; amount: number }[]
    hasApprovedAdvance: boolean
  }> {
    const role = actor?.role ?? ''
    const isSuperAdmin = role === ROLES.SUPER_ADMIN
    const isContabilidad = role === ROLES.CONTABILIDAD
    const isColaborador = role === ROLES.COLABORADOR

    // "Aprobado por alguien" = aprobación a nivel comprobante O a nivel reporte.
    const reportLevelApproved =
      !!report.coordinatorApprovedBy || !!report.contabilidadApprovedBy
    const anyExpenseApproved = expenses.some(
      e => (e.approvalLevel ?? 0) > 0 || e.contabilidadStatus === 'approved'
    )

    // Condiciones que restringen el borrado a solo Contabilidad/Superadmin (el
    // colaborador/coordinador dueño ya no puede eliminar).
    let restricted = reportLevelApproved || anyExpenseApproved
    let restrictedMsg =
      'Esta solicitud ya tiene una aprobación; solo Contabilidad puede eliminarla.'

    // Rendición directa creada por Contabilidad para el colaborador/coordinador
    // (createdBy distinto del dueño): solo Contabilidad puede eliminarla.
    if (!restricted && report.isDirecta) {
      const createdById = String(report.createdBy ?? '')
      const ownerId = String(report.userId ?? '')
      if (createdById && ownerId && createdById !== ownerId) {
        restricted = true
        restrictedMsg =
          'Esta rendición directa fue creada por Contabilidad; solo Contabilidad puede eliminarla.'
      }
    }

    // Caja chica ya incluida (jalada) por Contabilidad en un reporte —borrador o
    // finalizado—: solo Contabilidad puede eliminarla.
    if (!restricted && report.isCajaChica) {
      if (await this.isReferencedByCajaChica(String(report._id))) {
        restricted = true
        restrictedMsg =
          'Esta caja chica ya fue incluida por Contabilidad en un reporte; solo Contabilidad puede eliminarla.'
      }
    }

    // Rendición de viáticos: si su anticipo vinculado ya fue aprobado/pagado (el
    // coordinador aprobó y/o contabilidad pagó), la rendición representa dinero ya
    // desembolsado y NO puede eliminarse por la app —ni el colaborador ni
    // Contabilidad—. Solo Superadmin (escape técnico). Estas rendiciones se
    // auto-crean al registrar el pago del anticipo.
    let linkedAdvances: { _id: Types.ObjectId; status: string; amount: number }[] = []
    let hasApprovedAdvance = false
    if (!report.isDirecta && !report.isCajaChica) {
      const rawAdvanceIds: string[] = (
        Array.isArray(report.advanceIds) ? report.advanceIds : []
      ).map((x: any) => (x && typeof x === 'object' && '_id' in x ? String(x._id) : String(x)))
      linkedAdvances = (await this.advanceService.findByExpenseReportId(
        String(report._id),
        rawAdvanceIds
      )) as unknown as { _id: Types.ObjectId; status: string; amount: number }[]
      hasApprovedAdvance = linkedAdvances.some((a: any) =>
        ['approved', 'partially_paid', 'paid', 'settled'].includes(a.status)
      )
      if (hasApprovedAdvance && !isSuperAdmin) {
        return {
          allowed: false,
          reason:
            'El anticipo de esta rendición ya fue aprobado/pagado; la rendición no puede eliminarse.',
          linkedAdvances,
          hasApprovedAdvance,
        }
      }
    }

    if (restricted) {
      if (!isContabilidad && !isSuperAdmin) {
        return { allowed: false, reason: restrictedMsg, linkedAdvances, hasApprovedAdvance }
      }
    } else if (isColaborador) {
      // Estados iniciales: el colaborador solo puede eliminar las suyas.
      const ownerId = String(report.createdBy ?? report.userId ?? '')
      if (ownerId !== String(actor.userId)) {
        return {
          allowed: false,
          reason: 'Solo puedes eliminar tus propias solicitudes.',
          linkedAdvances,
          hasApprovedAdvance,
        }
      }
    }

    return { allowed: true, linkedAdvances, hasApprovedAdvance }
  }

  /**
   * Vista previa de lo que se eliminaría (y si el actor puede hacerlo), sin
   * borrar nada. La usa el front para mostrar la advertencia antes de confirmar.
   */
  async getDeletionPreview(id: string, actor: SolicitudDeleteActor) {
    const report = await this.expenseReportModel.findById(id).lean().exec()
    if (!report)
      throw new NotFoundException(`Expense report with ID ${id} not found`)

    const expenseIds = report.expenseIds ?? []
    const expenses = expenseIds.length
      ? await this.expenseModel
        .find({ _id: { $in: expenseIds } })
        .select('_id total file expenseType approvalLevel contabilidadStatus')
        .lean()
        .exec()
      : []

    const authResult = await this.evaluateDeleteAuthorization(
      report,
      expenses,
      actor
    )
    const expensesTotal = expenses.reduce(
      (sum, e: any) => sum + (Number(e.total) || 0),
      0
    )
    const filesCount = expenses.filter((e: any) => !!e.file).length
    const cajaChicaReferenced = report.isCajaChica
      ? await this.isReferencedByCajaChica(id)
      : false

    return {
      allowed: authResult.allowed,
      reason: authResult.reason,
      type: report.type,
      isDirecta: !!report.isDirecta,
      isCajaChica: !!report.isCajaChica,
      budget: report.budget,
      expensesCount: expenses.length,
      expensesTotal,
      filesCount,
      linkedAdvances: authResult.linkedAdvances.map((a: any) => ({
        amount: a.amount,
        status: a.status,
      })),
      cajaChicaReferenced,
    }
  }

  /**
   * Elimina una solicitud (rendición directa / caja chica) completa, con cascada
   * de comprobantes y sus archivos. La autorización depende del estado de aprobación:
   *  - Sin comprobantes o con comprobantes pero ninguno aprobado:
   *    el colaborador propietario, Contabilidad, Administrador o Superadmin.
   *  - Con al menos una aprobación (a nivel comprobante o de reporte):
   *    solo Contabilidad o Superadmin.
   */
  async remove(id: string, actor: SolicitudDeleteActor) {
    const report = await this.expenseReportModel.findById(id).lean().exec()
    if (!report)
      throw new NotFoundException(`Expense report with ID ${id} not found`)

    // Carga los comprobantes adjuntos para evaluar el estado de aprobación.
    const expenseIds = report.expenseIds ?? []
    const expenses = expenseIds.length
      ? await this.expenseModel
        .find({ _id: { $in: expenseIds } })
        .select('_id file approvalLevel contabilidadStatus')
        .lean()
        .exec()
      : []

    const authResult = await this.evaluateDeleteAuthorization(
      report,
      expenses,
      actor
    )
    if (!authResult.allowed) {
      throw new ForbiddenException(authResult.reason)
    }
    const linkedAdvances = authResult.linkedAdvances

    // Cascada: elimina los comprobantes adjuntos y sus archivos en S3.
    if (expenses.length > 0) {
      for (const e of expenses) {
        await this.tryDeleteS3File(e.file)
      }
      await this.expenseModel.deleteMany({ _id: { $in: expenseIds } }).exec()
    }

    // Anticipos vinculados: nunca se borran (registro financiero), solo se
    // desvinculan de la rendición eliminada para no dejar una FK colgando. Si
    // aún no habían sido pagados, vuelven a aparecer como huérfanos y siguen
    // su flujo normal de aprobación/pago.
    let advancesUnlinked = 0
    if (linkedAdvances.length > 0) {
      try {
        advancesUnlinked = await this.advanceService.detachFromDeletedReport(
          linkedAdvances.map(a => a._id)
        )
      } catch (err: unknown) {
        this.logger.error(
          `Desvincular anticipos al eliminar ${id}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }

    // Caja chica: si esta rendición ya había sido incluida (jalada) por
    // Contabilidad en algún reporte de caja chica —borrador o finalizado—,
    // quita la referencia para no dejarla apuntando a un documento eliminado.
    // `totalAmount` es denormalizado y se recalcula solo en la próxima lectura
    // (ver CajaChicaReportService.findAllByClient/findOne).
    let cajaChicaReportsUpdated = 0
    if (report.isCajaChica) {
      try {
        const pulled = await this.cajaChicaReportModel
          .updateMany(
            { 'selectedReports.expenseReportId': new Types.ObjectId(id) },
            {
              $pull: {
                selectedReports: { expenseReportId: new Types.ObjectId(id) },
              },
            }
          )
          .exec()
        cajaChicaReportsUpdated = pulled.modifiedCount ?? 0
      } catch (err: unknown) {
        this.logger.error(
          `Limpiar referencias de caja chica al eliminar ${id}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }

    await this.expenseReportModel.findByIdAndDelete(id).exec()
    return {
      ...report,
      deletionSummary: {
        expensesDeleted: expenses.length,
        advancesUnlinked,
        cajaChicaReportsUpdated,
      },
    }
  }

  /**
   * Devuelve los gastos de todas las rendiciones directas de un cliente,
   * con filtros opcionales de fecha, proyecto, categoría y número de documento.
   */
  async findDirectRendicionExpenses(
    clientId: string,
    filters: {
      page?: number
      limit?: number
      dateFrom?: string
      dateTo?: string
      projectId?: string
      categoryId?: string
      docNumber?: string
      tipo?: string
      userId?: string
    } = {}
  ) {
    const page = Math.max(1, filters.page ?? 1)
    const limit = Math.min(200, filters.limit ?? 50)
    const skip = (page - 1) * limit

    // 1. Obtener IDs de todas las rendiciones directas del cliente
    const reportQuery: any = {
      clientId: new Types.ObjectId(clientId),
      isDirecta: true,
    }
    if (filters.userId && /^[0-9a-fA-F]{24}$/.test(filters.userId)) {
      reportQuery.userId = new Types.ObjectId(filters.userId)
    }
    const directReports = await this.expenseReportModel
      .find(reportQuery)
      .select(
        '_id userId title motivo gestion budget createdAt createdBy directaDeposit'
      )
      .populate('userId', 'name email dni bankAccount')
      .populate({
        path: 'createdBy',
        select: 'name email roleId',
        populate: { path: 'roleId', select: 'name' },
      })
      .lean()
      .exec()

    if (directReports.length === 0) {
      return { data: [], total: 0, page, limit, pages: 0 }
    }

    // Determina quién generó la rendición directa y de qué tipo (origen):
    // - Contabilidad: iniciada desde Tesorería/Pagos (lleva depósito) o creada
    //   por un usuario con rol Contabilidad/Administrador.
    // - Coordinador / Colaborador: creada por el propio usuario según su rol.
    const enrichedReports = directReports.map(r => {
      const creator: any = r.createdBy
      const roleName = String(creator?.roleId?.name ?? '').toLowerCase()
      let origin: 'contabilidad' | 'coordinador' | 'colaborador'
      if (r.directaDeposit || /contabilidad|administrador/.test(roleName)) {
        origin = 'contabilidad'
      } else if (/coordinador/.test(roleName)) {
        origin = 'coordinador'
      } else {
        origin = 'colaborador'
      }
      return {
        ...r,
        _generatedByName: creator?.name || creator?.email || null,
        _generatedByRole: creator?.roleId?.name || null,
        _origin: origin,
      }
    })

    const reportIds = enrichedReports.map(r => r._id)
    const reportMap = new Map(enrichedReports.map(r => [String(r._id), r]))

    // 2. Construir el pipeline de agregación sobre Expense
    const pipeline: any[] = []

    // Match base: gastos que pertenecen a estas rendiciones directas
    const matchStage: any = {
      expenseReportId: { $in: reportIds },
    }

    // Filtro número de documento: busca en serie+correlativo y receiptNumeroDocumento
    if (filters.docNumber?.trim()) {
      const dn = filters.docNumber.trim()
      matchStage.$or = [
        { serie: { $regex: dn, $options: 'i' } },
        { correlativo: { $regex: dn, $options: 'i' } },
        { receiptNumeroDocumento: { $regex: dn, $options: 'i' } },
      ]
    }

    // Filtro tipo de documento
    if (filters.tipo && filters.tipo !== 'all') {
      matchStage.expenseType = filters.tipo
    }

    // Filtro proyecto — el id puede estar guardado como ObjectId (PM, CC, otros)
    // o como string (facturas), así que se filtra por ambas representaciones.
    if (filters.projectId && /^[0-9a-fA-F]{24}$/.test(filters.projectId)) {
      matchStage.proyectId = {
        $in: [filters.projectId, new Types.ObjectId(filters.projectId)],
      }
    }

    // Filtro categoría — idem (ObjectId o string)
    if (filters.categoryId && /^[0-9a-fA-F]{24}$/.test(filters.categoryId)) {
      matchStage.categoryId = {
        $in: [filters.categoryId, new Types.ObjectId(filters.categoryId)],
      }
    }

    pipeline.push({ $match: matchStage })

    // Filtros de fecha sobre fechaEmision (string con formato dd/mm/yyyy o yyyy-mm-dd)
    if (filters.dateFrom || filters.dateTo) {
      pipeline.push({
        $addFields: {
          _parsedDate: {
            $cond: {
              if: {
                $regexMatch: {
                  input: { $ifNull: ['$fechaEmision', ''] },
                  regex: /^\d{2}\/\d{2}\/\d{4}$/,
                },
              },
              then: {
                $dateFromString: {
                  dateString: {
                    $concat: [
                      { $substr: ['$fechaEmision', 6, 4] },
                      '-',
                      { $substr: ['$fechaEmision', 3, 2] },
                      '-',
                      { $substr: ['$fechaEmision', 0, 2] },
                    ],
                  },
                },
              },
              else: {
                $dateFromString: {
                  dateString: { $ifNull: ['$fechaEmision', '1970-01-01'] },
                  onError: new Date('1970-01-01'),
                },
              },
            },
          },
        },
      })

      const dateMatch: any = {}
      if (filters.dateFrom) dateMatch.$gte = new Date(filters.dateFrom)
      if (filters.dateTo) {
        const to = new Date(filters.dateTo)
        to.setHours(23, 59, 59, 999)
        dateMatch.$lte = to
      }
      pipeline.push({ $match: { _parsedDate: dateMatch } })
    }

    // Count total
    const countPipeline = [...pipeline, { $count: 'total' }]
    const countResult = await this.expenseModel.aggregate(countPipeline).exec()
    const total = countResult[0]?.total ?? 0

    // Lookup proyecto y categoría.
    // proyectId/categoryId pueden venir guardados como ObjectId (PM, CC, otros)
    // o como string (facturas creadas por el flujo de invoices). El $lookup es
    // estricto en tipos, así que primero se normaliza a ObjectId con $convert:
    // un ObjectId pasa intacto, un string hex válido se castea, y cualquier otro
    // caso queda en null (el lookup no resuelve, igual que antes).
    pipeline.push(
      {
        $addFields: {
          _proyectOid: {
            $convert: {
              input: '$proyectId',
              to: 'objectId',
              onError: null,
              onNull: null,
            },
          },
          _categoryOid: {
            $convert: {
              input: '$categoryId',
              to: 'objectId',
              onError: null,
              onNull: null,
            },
          },
        },
      },
      {
        $lookup: {
          from: 'projects',
          localField: '_proyectOid',
          foreignField: '_id',
          as: '_project',
        },
      },
      {
        $lookup: {
          from: 'categories',
          localField: '_categoryOid',
          foreignField: '_id',
          as: '_category',
        },
      },
      {
        $addFields: {
          _projectDoc: { $arrayElemAt: ['$_project', 0] },
          _categoryDoc: { $arrayElemAt: ['$_category', 0] },
        },
      },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit }
    )

    const expenses = await this.expenseModel.aggregate(pipeline).exec()

    // Adjuntar info del reporte a cada gasto
    const data = expenses.map(e => ({
      ...e,
      _report: reportMap.get(String(e.expenseReportId)) ?? null,
      _projectDoc: e._projectDoc ?? e._project?.[0] ?? null,
      _categoryDoc: e._categoryDoc ?? e._category?.[0] ?? null,
    }))

    return { data, total, page, limit, pages: Math.ceil(total / limit) }
  }

  /**
   * Lista las rendiciones directas de un cliente a nivel de REPORTE (una fila por
   * rendición), con su total gastado, depósito/saldo y quién la generó. Alimenta
   * la pestaña "Rendiciones directas" (vista por rendición), separada de la
   * pestaña "Gastos" (vista por comprobante, ver findDirectRendicionExpenses).
   */
  async findDirectRendicionReports(
    clientId: string,
    filters: { dateFrom?: string; dateTo?: string; userId?: string } = {}
  ) {
    const query: any = {
      clientId: new Types.ObjectId(clientId),
      isDirecta: true,
    }
    if (filters.userId && /^[0-9a-fA-F]{24}$/.test(filters.userId)) {
      query.userId = new Types.ObjectId(filters.userId)
    }
    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {}
      if (filters.dateFrom) query.createdAt.$gte = new Date(filters.dateFrom)
      if (filters.dateTo) {
        const to = new Date(filters.dateTo)
        to.setHours(23, 59, 59, 999)
        query.createdAt.$lte = to
      }
    }

    const reports = await this.expenseReportModel
      .find(query)
      .select(
        '_id codigo userId title motivo gestion budget status createdAt createdBy directaDeposit expenseIds returnVoucher'
      )
      .populate('userId', 'name email')
      .populate({
        path: 'createdBy',
        select: 'name email roleId',
        populate: { path: 'roleId', select: 'name' },
      })
      .populate('expenseIds', 'total')
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    return reports.map((r: any) => {
      const creator: any = r.createdBy
      const roleName = String(creator?.roleId?.name ?? '').toLowerCase()
      let origin: 'contabilidad' | 'coordinador' | 'colaborador'
      if (r.directaDeposit || /contabilidad|administrador/.test(roleName)) {
        origin = 'contabilidad'
      } else if (/coordinador/.test(roleName)) {
        origin = 'coordinador'
      } else {
        origin = 'colaborador'
      }
      const expenses = (r.expenseIds as any[]) || []
      const totalGastado = expenses.reduce(
        (s, e) => s + (Number(e?.total) || 0),
        0
      )
      const deposited = Number(r.directaDeposit?.amount ?? r.budget ?? 0)
      const hasFunds = !!r.directaDeposit
      return {
        _id: String(r._id),
        codigo: r.codigo ?? null,
        userId: r.userId,
        title: r.title ?? null,
        motivo: r.motivo ?? null,
        status: r.status ?? null,
        // Cerrada (a efectos de label): devuelta con comprobante.
        effectivelyClosed: r.status === 'closed' || !!r.returnVoucher,
        createdAt: r.createdAt,
        hasDeposit: hasFunds,
        deposited,
        totalGastado,
        saldo: hasFunds ? deposited - totalGastado : null,
        expenseCount: expenses.length,
        generatedByName: creator?.name || creator?.email || null,
        generatedByRole: creator?.roleId?.name || null,
        origin,
      }
    })
  }

  async addExpenseToReport(reportId: string, expenseId: string) {
    const existing = await this.expenseReportModel
      .findById(reportId)
      .select('status userId clientId expenseIds')
      .lean()
      .exec()

    const updateOp: Record<string, unknown> = {
      $push: { expenseIds: new Types.ObjectId(expenseId) },
    }
    const wasRejected = (existing as any)?.status === 'rejected'
    if (wasRejected) {
      updateOp.$set = { status: 'submitted' }
      updateOp.$unset = { rejectionReason: '', rejectedByRole: '' }
    }

    const updated = await this.expenseReportModel
      .findByIdAndUpdate(reportId, updateOp, { new: true })
      .exec()

    const ownerId = (existing as any)?.userId?.toString()
    const reportClientId = (existing as any)?.clientId?.toString()
    const wasSubmitted = (existing as any)?.status === 'submitted'
    if (ownerId && reportClientId) {
      if (wasRejected) {
        // Rendición rechazada y corregida: se (re)construye la cadena de
        // TODOS sus comprobantes (mismo criterio que un reenvío normal desde
        // `update()`) — el revisor vuelve a validar todo desde cero.
        const expenseIds = [
          ...((existing as any)?.expenseIds ?? []),
          new Types.ObjectId(expenseId),
        ] as Types.ObjectId[]
        await this.buildExpenseChains(expenseIds, ownerId, reportClientId, { force: true })
      } else if (wasSubmitted) {
        // Rendición ya enviada y en curso de aprobación: solo se construye la
        // cadena del comprobante NUEVO — no se toca la de los existentes, que
        // pueden tener aprobaciones N1/N2 ya en curso.
        await this.buildExpenseChains([new Types.ObjectId(expenseId)], ownerId, reportClientId)
      }
    }

    return updated
  }

  /** Cambia silenciosamente el estado de una rendición rechazada a enviada, sin notificaciones. */
  async resubmitSilent(reportId: string): Promise<void> {
    const existing = await this.expenseReportModel
      .findById(reportId)
      .select('status userId clientId expenseIds')
      .lean()
      .exec()
    if (!existing || (existing as any).status !== 'rejected') return
    await this.expenseReportModel
      .findByIdAndUpdate(reportId, {
        $set: { status: 'submitted' },
        $unset: { rejectionReason: '', rejectedByRole: '' },
      })
      .exec()
    // Igual que en `update()`: al reenviar se (re)construye la cadena de cada
    // comprobante — sin esto, comprobantes de la rendición reabierta quedaban
    // con `approverChain` sin (re)construir, o con el de un envío anterior.
    const ownerId = (existing as any).userId?.toString()
    const reportClientId = (existing as any).clientId?.toString()
    if (ownerId && reportClientId) {
      await this.buildExpenseChains(
        ((existing as any).expenseIds ?? []) as Types.ObjectId[],
        ownerId,
        reportClientId,
        { force: true }
      )
    }
  }

  async removeExpenseFromReport(
    reportId: string,
    expenseId: string
  ): Promise<void> {
    await this.expenseReportModel
      .findByIdAndUpdate(reportId, {
        $pull: { expenseIds: new Types.ObjectId(expenseId) },
      })
      .exec()
  }

  async addAdvanceToReport(reportId: string, advanceId: string) {
    return await this.expenseReportModel
      .findByIdAndUpdate(
        reportId,
        { $addToSet: { advanceIds: new Types.ObjectId(advanceId) } },
        { new: true }
      )
      .exec()
  }

  async updateSettlement(reportId: string, settlement: any) {
    return await this.expenseReportModel
      .findByIdAndUpdate(reportId, { $set: { settlement } }, { new: true })
      .exec()
  }

  /**
   * Fondos entregados al colaborador en una rendición directa: depósito de
   * contabilidad. Base para calcular devolución vs reembolso.
   */
  private directaFundsGiven(report: any): number {
    return Number(report?.directaDeposit?.amount ?? 0)
  }

  async setApprovedBy(reportId: string, userId: string) {
    await this.expenseReportModel
      .findByIdAndUpdate(reportId, {
        $set: { approvedBy: new Types.ObjectId(userId) },
      })
      .exec()
  }

  async setCoordinatorApproval(reportId: string, userId: string) {
    await this.expenseReportModel
      .findByIdAndUpdate(reportId, {
        $set: {
          coordinatorApprovedBy: new Types.ObjectId(userId),
          coordinatorApprovedAt: new Date(),
        },
      })
      .exec()
  }

  async setContabilidadApproval(reportId: string, userId: string) {
    await this.expenseReportModel
      .findByIdAndUpdate(reportId, {
        $set: {
          contabilidadApprovedBy: new Types.ObjectId(userId),
          contabilidadApprovedAt: new Date(),
        },
      })
      .exec()
  }

  async registerAffidavit(
    reportId: string,
    dto: CreateAffidavitDto,
    generatedBy: string
  ) {
    const report = await this.findOne(reportId)
    if (!report) {
      throw new NotFoundException(
        `Expense report with ID ${reportId} not found`
      )
    }
    if (report.status !== 'closed') {
      throw new BadRequestException(
        'La declaración jurada solo puede generarse cuando la rendición está cerrada.'
      )
    }

    const reportExpenses = (report.expenseIds || []).map((e: any) =>
      String(e._id)
    )
    const missing = dto.expenseIds.filter(
      id => !reportExpenses.includes(String(id))
    )
    if (missing.length > 0) {
      throw new BadRequestException(
        'Los comprobantes seleccionados no pertenecen a esta rendición.'
      )
    }

    await this.expenseReportModel.findByIdAndUpdate(reportId, {
      $push: {
        affidavits: {
          type: dto.type,
          expenseIds: dto.expenseIds.map(id => new Types.ObjectId(id)),
          generatedBy: new Types.ObjectId(generatedBy),
          generatedAt: new Date(),
        },
      },
    })

    return {
      reportId,
      type: dto.type,
      expenseIds: dto.expenseIds,
      generatedBy,
      generatedAt: new Date().toISOString(),
    }
  }

  async markReimbursementAccountingNotified(reportId: string): Promise<void> {
    await this.expenseReportModel.findByIdAndUpdate(reportId, {
      $set: { reimbursementAccountingNotifiedAt: new Date() },
    })
  }

  /**
   * Viáticos (rendiciones tipo viatico) aprobados y pendientes de pago, para el
   * lote de pagos BBVA. Devuelve el saldo por pagar y los datos bancarios (de la
   * solicitud si existen, si no del perfil del colaborador). VD-7.
   */
  async findBatchPayableViaticos(clientId: string) {
    const rows = await this.expenseReportModel
      .find({
        clientId: new Types.ObjectId(clientId),
        type: 'viatico',
        status: { $in: ['viatico_approved', 'partially_paid'] },
      })
      .populate('userId', 'name email dni documentType bankAccount')
      .lean()
      .exec()

    return rows
      .map((r: any) => {
        const remaining =
          Number(r.viaticoAmount ?? 0) - Number(r.viaticoPaidAmount ?? 0)
        return {
          reportId: String(r._id),
          user: r.userId,
          remaining: Math.round(remaining * 100) / 100,
          bankName: r.viaticoBankName ?? r.userId?.bankAccount?.bankName ?? '',
          accountNumber:
            r.viaticoAccountNumber ?? r.userId?.bankAccount?.accountNumber ?? '',
          cci: r.viaticoCci ?? r.userId?.bankAccount?.cci ?? '',
        }
      })
      .filter(x => x.remaining > 0.009)
  }

  async findPendingReimbursementsByClient(clientId: string) {
    const cid = new Types.ObjectId(clientId)
    const noPayment = [
      { reimbursementPaymentInfo: { $exists: false } },
      { reimbursementPaymentInfo: null },
    ]

    // 1. Reportes con reembolso ya liquidado (settlement persistido).
    const settled = await this.expenseReportModel
      .find({
        clientId: cid,
        status: 'approved',
        'settlement.type': 'reembolso',
        $or: noPayment,
      })
      .populate('userId', 'name email bankAccount dni documentType')
      .sort({ updatedAt: -1 })
      .lean()
      .exec()

    // 2. Rendiciones directas aprobadas SIN settlement de reembolso persistido
    //    (p. ej. aprobadas antes de VD-26). Se calcula el saldo a favor del
    //    colaborador desde los gastos (todo gasto no rechazado, menos el depósito
    //    si lo hubiera) y, si es positivo, se adjunta un settlement calculado para
    //    que Tesorería pueda registrar el pago. Al confirmar, el backend recomputa
    //    y persiste el settlement real (registerReimbursementPayment). VD-37.
    const directas = await this.expenseReportModel
      .find({
        clientId: cid,
        isDirecta: true,
        status: 'approved',
        'settlement.type': { $ne: 'reembolso' },
        $or: noPayment,
      })
      .populate('userId', 'name email bankAccount dni documentType')
      .populate('expenseIds', 'total status')
      .sort({ updatedAt: -1 })
      .lean()
      .exec()

    const computedDirectas = directas
      .map(r => {
        const deposit = Number((r as any).directaDeposit?.amount ?? 0)
        const gastado = (((r as any).expenseIds as any[]) || []).reduce(
          (s: number, e: any) => {
            const st = String(e?.status || '').toLowerCase()
            return st === 'rejected' ? s : s + (Number(e?.total) || 0)
          },
          0
        )
        return { r, deposit, gastado, difference: deposit - gastado }
      })
      // difference < 0 ⇒ el colaborador gastó más de lo depositado ⇒ reembolso.
      .filter(x => x.difference < -0.01)
      .map(({ r, deposit, gastado, difference }) => ({
        ...r,
        settlement: {
          advanceTotal: deposit,
          expenseTotal: gastado,
          difference,
          type: 'reembolso' as const,
        },
      }))

    return [...settled, ...computedDirectas].sort((a, b) =>
      String((b as any).updatedAt ?? '').localeCompare(
        String((a as any).updatedAt ?? '')
      )
    )
  }

  async findMyDocuments(userId: string, clientId: string) {
    const reimbursementRows = await this.expenseReportModel
      .find({
        userId: new Types.ObjectId(userId),
        clientId: new Types.ObjectId(clientId),
        reimbursementPaymentInfo: { $exists: true, $ne: null },
      })
      .select(
        'title reimbursementPaymentInfo reimbursedAt settlement.difference'
      )
      .sort({ reimbursedAt: -1 })
      .lean()
      .exec()

    const viaticoRows =
      await this.advanceService.findPaymentReceiptsForCollaborator(
        userId,
        clientId
      )

    const reimbursementDocs = reimbursementRows.map(r => ({
      kind: 'reembolso_rendicion' as const,
      expenseReportId: String(r._id),
      title: r.title || 'Rendición',
      receiptUrl: r.reimbursementPaymentInfo?.paymentReceiptUrl || '',
      receiptFileName:
        r.reimbursementPaymentInfo?.paymentReceiptFileName ||
        'comprobante-reembolso.pdf',
      date:
        r.reimbursedAt?.toISOString?.() ||
        r.reimbursementPaymentInfo?.transferDate ||
        '',
      amountFormatted:
        r.settlement?.difference != null
          ? Math.abs(Number(r.settlement.difference)).toFixed(2)
          : undefined,
      detailUrl: `${this.emailService.buildAppUrl(`/mis-rendiciones/${String(r._id)}/detalle`)}`,
    }))

    const viaticoDocs = (viaticoRows as any[]).flatMap(row => {
      const rep = row.expenseReportId
      const reportTitle =
        typeof rep === 'object' && rep?.title ? rep.title : 'Viáticos'
      const expenseReportId =
        typeof rep === 'object' && rep?._id
          ? String(rep._id)
          : rep
            ? String(rep)
            : undefined
      // Un documento por cada pago parcial; fallback a paymentInfo (legado).
      const list =
        Array.isArray(row.payments) && row.payments.length
          ? row.payments
          : row.paymentInfo
            ? [row.paymentInfo]
            : []
      const multiple = list.length > 1
      return list
        .filter((p: any) => p?.paymentReceiptUrl)
        .map((p: any, i: number) => ({
          kind: 'viatico_pago' as const,
          advanceId: String(row._id),
          title: multiple
            ? `${row.description || reportTitle} · Pago ${i + 1}`
            : row.description || reportTitle,
          receiptUrl: p.paymentReceiptUrl || '',
          receiptFileName:
            p.paymentReceiptFileName ||
            `comprobante-pago-viaticos${multiple ? `-${i + 1}` : ''}.pdf`,
          date:
            p.transferDate?.toISOString?.() ||
            p.createdAt?.toISOString?.() ||
            row.createdAt?.toString?.() ||
            '',
          expenseReportId,
        }))
    })

    return {
      items: [...reimbursementDocs, ...viaticoDocs].sort((a, b) =>
        String(b.date).localeCompare(String(a.date))
      ),
    }
  }

  async registerReimbursementPayment(
    reportId: string,
    dto: RegisterReimbursementPaymentDto,
    userRole: string,
    userPermissions?: { canApproveL2?: boolean },
    tenantCtx?: { requestClientId: string; isSuperAdmin: boolean },
    opts?: { bypassReceipt?: boolean }
  ) {
    // El reembolso lo registra Tesorería (Contabilidad/SuperAdmin o delegado
    // con L2). El Coordinador queda excluido aunque tenga canApproveL2 o el
    // RolesGuard lo aliase a Administrador: por rol no participa en el pago.
    const canPay =
      userRole !== ROLES.COORDINADOR &&
      (userRole === ROLES.SUPER_ADMIN ||
        userRole === ROLES.TESORERIA ||
        userPermissions?.canApproveL2 === true)
    if (!canPay) {
      throw new ForbiddenException(
        'No tienes permiso para registrar pagos de reembolso.'
      )
    }

    if (!opts?.bypassReceipt && dto.method !== 'efectivo' && !dto.paymentReceiptUrl) {
      throw new BadRequestException(
        'El comprobante es obligatorio para pagos por transferencia o cheque.'
      )
    }

    if (dto.paymentReceiptUrl) {
      const receiptValidation = this.validatePaymentReceipt(
        dto.paymentReceiptMimeType,
        dto.paymentReceiptFileName,
        dto.paymentReceiptSizeBytes
      )
      if (!receiptValidation.ok) {
        throw new BadRequestException(receiptValidation.reason)
      }
    }

    const report = await this.expenseReportModel.findById(reportId).exec()
    if (!report) {
      throw new NotFoundException(
        `Expense report with ID ${reportId} not found`
      )
    }

    if (tenantCtx && !tenantCtx.isSuperAdmin) {
      const rid = this.normalizeExpenseReportClientId(report.clientId)
      if (!tenantCtx.requestClientId || rid !== tenantCtx.requestClientId) {
        throw new ForbiddenException(
          'La rendición no pertenece a su organización.'
        )
      }
    }

    if (report.status !== 'approved' && report.status !== 'closed') {
      throw new BadRequestException(
        'Solo se puede registrar el reembolso cuando la rendición está aprobada o cerrada.'
      )
    }

    // Calcular liquidación efectiva desde los montos reales (no confiar en el tipo almacenado)
    let settlementType = report.settlement?.type
    let preSettlement: Record<string, unknown> | null = null
    if (!settlementType || settlementType !== 'reembolso') {
      const populated = await this.expenseReportModel
        .findById(reportId)
        .populate('expenseIds', 'total')
        .exec()
      const expenses = (populated?.expenseIds ?? []) as any[]
      const expenseTotal = expenses.reduce(
        (s: number, e: any) => s + (Number(e.total) || 0),
        0
      )
      const rawAdvanceIds = ((report as any).advanceIds ?? []).map((x: any) =>
        x && typeof x === 'object' && '_id' in x ? String(x._id) : String(x)
      )
      const linkedAdvances = await this.advanceService.findByExpenseReportId(
        reportId,
        rawAdvanceIds
      )
      const activeAdvances = linkedAdvances.filter((a: any) =>
        ['approved', 'partially_paid', 'paid', 'settled'].includes(a.status)
      )
      // Si no hay anticipos activos, el colaborador gastó de su propio bolsillo (saldo = 0 - gastos).
      // Excepción: en una rendición directa con depósito de Contabilidad, ese depósito funciona como anticipo.
      const depositTotal = this.directaFundsGiven(report)
      const advanceTotal =
        activeAdvances.reduce(
          (s: number, a: any) =>
            s +
            (a.status === 'approved'
              ? 0
              : Number(a.paidAmount ?? a.amount) || 0),
          0
        ) + depositTotal
      const difference = advanceTotal - expenseTotal
      if (Math.abs(difference) >= 0.01) {
        settlementType = difference > 0 ? 'devolucion' : 'reembolso'
        preSettlement = {
          advanceTotal,
          expenseTotal,
          difference,
          type: settlementType,
          settledAt: new Date(),
        }
      }
    }

    if (settlementType !== 'reembolso') {
      throw new BadRequestException(
        'Esta rendición no tiene saldo a favor del colaborador que deba reembolsarse.'
      )
    }
    if (report.reimbursementPaymentInfo) {
      throw new BadRequestException(
        'El reembolso de esta rendición ya fue registrado.'
      )
    }

    // Usar findByIdAndUpdate con $set para evitar el conflicto de Mongoose con el campo 'type' en settlement
    const updateFields: Record<string, unknown> = {
      reimbursementPaymentInfo: {
        method: dto.method,
        bankName: dto.bankName,
        accountNumber: dto.accountNumber,
        cci: dto.cci,
        transferDate: new Date(dto.transferDate),
        reference: dto.reference,
        paymentReceiptUrl: dto.paymentReceiptUrl,
        paymentReceiptFileName: dto.paymentReceiptFileName,
        paymentReceiptMimeType: dto.paymentReceiptMimeType,
        paymentReceiptSizeBytes: dto.paymentReceiptSizeBytes,
        scannedAmount: dto.scannedAmount,
        operationNumber: dto.operationNumber,
        operationDate: dto.operationDate,
        operationTime: dto.operationTime,
        titular: dto.titular,
      },
      reimbursedAt: new Date(),
    }
    if (report.status !== 'closed') {
      updateFields.status = 'reimbursed'
    }
    if (preSettlement) {
      updateFields.settlement = preSettlement
    }
    await this.expenseReportModel
      .findByIdAndUpdate(reportId, { $set: updateFields })
      .exec()

    await this.notifyCollaboratorReimbursementPaid(reportId)

    return this.findOne(reportId)
  }

  private async notifyCollaboratorReimbursementPaid(reportId: string) {
    const report = await this.findOne(reportId)
    const owner = report.userId as any
    if (!owner?.email) return

    const ownerEmailEnabled = await this.userService.isEmailEnabled(
      String(owner._id || owner.id)
    )
    const profile = await this.userService.findTransactionalProfile(
      String(owner._id || owner.id)
    )
    const coordinatorId = profile?.coordinatorId?.toString?.()
    const coordinator = coordinatorId
      ? await this.userService.findEmailNameClient(coordinatorId)
      : null
    const coordEmailEnabled = coordinatorId
      ? await this.userService.isEmailEnabled(coordinatorId)
      : false

    const diff = report.settlement?.difference ?? 0
    const amountFormatted = Math.abs(Number(diff)).toFixed(2)

    const platformUrl = this.emailService.buildAppUrl('/mis-documentos')

    const pi = report.reimbursementPaymentInfo
    const transferDate = pi?.transferDate
      ? new Date(pi.transferDate).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)

    const baseData = {
      clientId: String(report.clientId),
      collaboratorName: owner.name || 'Colaborador',
      coordinatorName: coordinator?.name,
      reportTitle: report.title || 'Rendición',
      amountFormatted,
      transferDate,
      reference: pi?.reference || '—',
      paymentMethod: pi?.method || 'transferencia_bancaria',
      paymentReceiptUrl: pi?.paymentReceiptUrl || '',
      paymentReceiptFileName:
        pi?.paymentReceiptFileName || 'comprobante-reembolso.pdf',
      platformUrl,
    }

    try {
      if (ownerEmailEnabled) {
        await this.emailService.sendRendicionReembolsoPagado(owner.email, {
          recipientName: owner.name || 'Colaborador',
          ...baseData,
        })
      }

      if (coordinator?.email && coordEmailEnabled) {
        await this.emailService.sendRendicionReembolsoPagado(
          coordinator.email,
          {
            recipientName: coordinator.name || 'Coordinador/a',
            ...baseData,
          }
        )
      }

      await this.notificationsService.create({
        userId: String(owner._id || owner.id),
        title: 'Reembolso registrado',
        message: `Se registró el pago del reembolso por S/ ${amountFormatted} para "${report.title}".`,
        type: 'success',
        actionUrl: `/mis-documentos`,
      })
    } catch (err) {
      console.error('Error enviando notificación de reembolso pagado', err)
    }
  }

  async findOneWithAdvances(id: string) {
    const report = await this.expenseReportModel
      .findById(id)
      .populate('userId', 'name email signature bankAccount dni area')
      .populate({
        path: 'expenseIds',
        populate: [
          { path: 'categoryId', select: 'name cuenta' },
          { path: 'proyectId', select: 'name' },
          {
            path: 'ordenTrabajoId',
            select: 'nombre costCenterId',
            populate: { path: 'costCenterId', select: 'code name' },
          },
        ],
      })
      .populate('advanceIds')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('projectId', 'name')
      .populate({
        path: 'viaticoOrdenTrabajoId',
        select: 'nombre costCenterId',
        populate: { path: 'costCenterId', select: 'code name' },
      })
      .exec()
    if (!report)
      throw new NotFoundException(`Expense report with ID ${id} not found`)
    return this.normalizeReportExpenseDates(report)
  }

  // ─── FASE 8 — Cierre Definitivo ──────────────────────────────────────────

  /** Valida todas las condiciones previas al cierre. Devuelve lista de errores (vacía = OK). */
  async validateClosureConditions(id: string): Promise<string[]> {
    const report = await this.expenseReportModel
      .findById(id)
      .populate('expenseIds')
      .exec()
    if (!report) throw new NotFoundException(`Rendición ${id} no encontrada`)
    const errors: string[] = []
    if (report.status === 'closed') {
      errors.push('La rendición ya está cerrada')
      return errors
    }
    if (report.status !== 'approved' && report.status !== 'reimbursed') {
      errors.push(
        `Estado actual "${report.status}" no permite cierre. Se requiere estado aprobado o reembolsado.`
      )
    }
    const expenses = (report.expenseIds as any[]) || []
    const hasPendingExpenses = expenses.some(
      e => e?.status === 'pending_review' || e?.status === 'pending_sunat'
    )
    if (hasPendingExpenses) {
      errors.push(
        'Existen gastos en estado pendiente de revisión o validación SUNAT'
      )
    }
    const returnRecord = (report as any).returnRecord
    if (returnRecord && returnRecord.status !== 'validated') {
      errors.push(
        `Devolución pendiente en estado: ${returnRecord.status}. Se requiere validación de Contabilidad.`
      )
    }

    // Determinar tipo de liquidación para validar comprobantes previos al cierre
    {
      const existingSettlement = (report as any).settlement
      let effectiveSettlementType = existingSettlement?.type as
        | string
        | undefined
      if (!effectiveSettlementType) {
        const expenses = (report.expenseIds as any[]) || []
        const expenseTotal = expenses.reduce(
          (s: number, e: any) => s + (Number(e.total) || 0),
          0
        )
        const rawAdvanceIds = ((report as any).advanceIds ?? []).map(
          (x: any) =>
            x && typeof x === 'object' && '_id' in x ? String(x._id) : String(x)
        )
        const linkedAdvances = await this.advanceService.findByExpenseReportId(
          id,
          rawAdvanceIds
        )
        const activeAdvances = linkedAdvances.filter((a: any) =>
          ['approved', 'partially_paid', 'paid', 'settled'].includes(a.status)
        )
        const depositTotal = this.directaFundsGiven(report)
        const advanceTotal =
          activeAdvances.reduce(
            (s: number, a: any) =>
              s +
              (a.status === 'approved'
                ? 0
                : Number(a.paidAmount ?? a.amount) || 0),
            0
          ) + depositTotal
        const difference = advanceTotal - expenseTotal
        if (Math.abs(difference) >= 0.01) {
          effectiveSettlementType = difference > 0 ? 'devolucion' : 'reembolso'
        }
      }
      if (
        effectiveSettlementType === 'devolucion' &&
        !(report as any).returnVoucher &&
        !(report as any).settlement?.toBolsa
      ) {
        errors.push(
          'El colaborador debe adjuntar el comprobante de devolución antes de cerrar la rendición.'
        )
      }
      if (
        effectiveSettlementType === 'reembolso' &&
        !(report as any).reimbursementPaymentInfo
      ) {
        errors.push(
          'Contabilidad debe registrar el comprobante de reembolso al colaborador antes de cerrar la rendición.'
        )
      }
    }

    return errors
  }

  /** Cierra definitivamente la rendición. Bloquea toda edición posterior. */
  async close(id: string, closedBy: string): Promise<ExpenseReportDocument> {
    // Para viáticos: recomputar settlement antes de validar (corrige datos stale o mal calculados).
    try {
      await this.liquidateViaticoReport(id, /* fromClose= */ true)
    } catch (err) {
      console.error(`[close] Pre-validation viatico liquidation error for ${id}:`, err)
    }
    const errors = await this.validateClosureConditions(id)
    if (errors.length > 0) {
      throw new BadRequestException(errors.join(' | '))
    }
    // Compute settlement before closing in case it was skipped at approval time
    // (liquidateExpenseReport requires status === 'approved', which is still true here)
    try {
      await this.advanceService.liquidateExpenseReport(id, /* fromClose= */ true)
    } catch (err) {
      console.error(`[close] Pre-close liquidation error for ${id}:`, err)
    }
    const closureRecord = {
      closedAt: new Date(),
      closedBy,
      reopeningStatus: 'none' as const,
      documentHashes: [],
    }
    const updated = await this.expenseReportModel
      .findByIdAndUpdate(
        id,
        { $set: { status: 'closed', closureRecord } },
        { new: true }
      )
      .exec()
    if (!updated) throw new NotFoundException(`Rendición ${id} no encontrada`)
    const collaborator = await this.userService.findEmailNameClient(
      updated.userId.toString()
    )
    const collaboratorEmailEnabled = collaborator?.email
      ? await this.userService.isEmailEnabled(updated.userId.toString())
      : false
    const closedAtStr = this.emailService.formatDateDDMMYYYY(
      closureRecord.closedAt
    )
    const clientIdStr = updated.clientId.toString()
    if (collaboratorEmailEnabled) {
      this.emailService
        .sendRendicionCerrada(collaborator!.email, {
          clientId: clientIdStr,
          recipientName: collaborator!.name,
          reportTitle: updated.title,
          closedAt: closedAtStr,
        })
        .catch(() => { })
    }

    const settlement = (updated as any).settlement
    const settlementDiffAbs = Math.abs(Number(settlement?.difference ?? 0))
    const clientId = clientIdStr
    const platformUrl = this.emailService.buildAppUrl(
      `/mis-rendiciones/${id}/detalle`
    )

    // Solo enviar correos de devolución / reembolso si hay un monto real (>= 0.01).
    // Evita los correos con "S/ 0.00" cuando el settlement persistido quedó stale.
    if (settlement?.type === 'devolucion' && settlementDiffAbs >= 0.01) {
      const amountFormatted = settlementDiffAbs.toFixed(2)
      if (collaboratorEmailEnabled) {
        this.emailService
          .sendRendicionDevolucionColaborador(collaborator!.email, {
            clientId,
            recipientName: collaborator!.name,
            reportTitle: updated.title,
            amountFormatted,
            closedAt: closedAtStr,
            platformUrl,
          })
          .catch(() => { })
      }
      if (collaborator) {
        this.notificationsService
          .create({
            userId: updated.userId.toString(),
            title: 'Devolución de saldo pendiente',
            message: `Tu rendición "${updated.title}" fue cerrada. Tienes un saldo de S/ ${amountFormatted} a devolver a la empresa. Por favor, adjunta el comprobante de depósito.`,
            type: 'warning',
            actionUrl: `/mis-rendiciones/${id}/detalle`,
          })
          .catch(() => { })
      }
    } else if (settlement?.type === 'reembolso' && settlementDiffAbs >= 0.01) {
      const amountFormatted = settlementDiffAbs.toFixed(2)
      const accountingUsers =
        await this.userService.findAccountingRecipientsWithIds(clientId)
      for (const u of accountingUsers) {
        this.emailService
          .sendRendicionReembolsoContabilidad(u.email, {
            clientId,
            recipientName: u.name,
            reportLabel: updated.title,
            reportTitle: updated.title,
            collaboratorName: collaborator?.name || 'Colaborador',
            amountFormatted,
            detailUrl: platformUrl,
          })
          .catch(() => { })
        this.notificationsService
          .create({
            userId: u._id,
            title: 'Reembolso pendiente — Rendición cerrada',
            message: `La rendición "${updated.title}" fue cerrada. Hay un reembolso de S/ ${amountFormatted} pendiente de pago al colaborador ${collaborator?.name || ''}.`,
            type: 'info',
            actionUrl: `/mis-rendiciones/${id}/detalle`,
          })
          .catch(() => { })
      }
    }

    return updated
  }

  async registerReturnVoucher(
    id: string,
    dto: {
      depositDate: string
      bankOrigin?: string
      operationNumber?: string
      fileUrl: string
      fileName?: string
      scannedAmount?: number
      operationDate?: string
      operationTime?: string
      titular?: string
    },
    userId: string
  ): Promise<ExpenseReportDocument> {
    const report = await this.expenseReportModel
      .findById(id)
      .populate('expenseIds', 'total status')
      .exec()
    if (!report) throw new NotFoundException(`Rendición ${id} no encontrada`)
    if (report.status !== 'closed' && report.status !== 'approved') {
      throw new BadRequestException(
        'El comprobante de devolución solo puede cargarse cuando la rendición está aprobada o cerrada.'
      )
    }
    if ((report as any).returnVoucher) {
      throw new BadRequestException(
        'Ya se ha cargado un comprobante de devolución para esta rendición.'
      )
    }
    if (report.userId.toString() !== userId) {
      throw new ForbiddenException(
        'Solo el colaborador dueño puede cargar el comprobante de devolución.'
      )
    }

    // Compute live balance from linked advances — used for notification amount only, never blocks the upload
    const rawAdvanceIds = ((report as any).advanceIds ?? []).map((x: any) =>
      x && typeof x === 'object' && '_id' in x ? String(x._id) : String(x)
    )
    const linkedAdvances = await this.advanceService.findByExpenseReportId(
      id,
      rawAdvanceIds
    )
    const activeAdvances = linkedAdvances.filter(a =>
      ['approved', 'partially_paid', 'paid', 'settled'].includes(a.status)
    )
    const expenses = (report.expenseIds as any[]) || []
    const expenseTotal = expenses.reduce(
      (s, e) => s + (Number(e.total) || 0),
      0
    )
    const advanceTotal =
      activeAdvances.length > 0
        ? activeAdvances.reduce(
          (s, a) =>
            s +
            (a.status === 'approved'
              ? 0
              : Number(a.paidAmount ?? a.amount) || 0),
          0
        )
        : Number((report as any).budget ?? 0)
    const difference = advanceTotal - expenseTotal
    const notifySettlement = {
      advanceTotal,
      expenseTotal,
      difference,
      type: 'devolucion' as const,
      settledAt: new Date(),
    }
    // Update settlement in DB only if not already set or the stored type conflicts with actual balance
    const existingSettlement = (report as any).settlement
    if (
      !existingSettlement ||
      (difference > 0.01 && existingSettlement.type !== 'devolucion')
    ) {
      await this.expenseReportModel
        .findByIdAndUpdate(id, { $set: { settlement: notifySettlement } })
        .exec()
    }

    const voucher = {
      url: dto.fileUrl,
      fileName: dto.fileName,
      depositDate: dto.depositDate,
      bankOrigin: dto.bankOrigin,
      operationNumber: dto.operationNumber,
      scannedAmount: dto.scannedAmount,
      operationDate: dto.operationDate,
      operationTime: dto.operationTime,
      titular: dto.titular,
      uploadedAt: new Date(),
    }
    await this.expenseReportModel
      .findByIdAndUpdate(id, { $set: { returnVoucher: voucher } })
      .exec()

    const amountFormatted = Math.abs(
      Number(notifySettlement.difference ?? 0)
    ).toFixed(2)
    const clientId = report.clientId.toString()
    const platformUrl = this.emailService.buildAppUrl(
      `/mis-rendiciones/${id}/detalle`
    )
    const collaborator = await this.userService.findEmailNameClient(userId)
    const collaboratorName = collaborator?.name || 'Colaborador'
    const collaboratorEmailEnabled = collaborator?.email
      ? await this.userService.isEmailEnabled(userId)
      : false

    if (collaboratorEmailEnabled) {
      this.emailService
        .sendRendicionCerrada(collaborator!.email, {
          clientId,
          recipientName: collaboratorName,
          reportTitle: report.title,
          closedAt: this.emailService.formatDateDDMMYYYY(voucher.uploadedAt),
        })
        .catch(() => { })
    }
    this.notificationsService
      .create({
        userId,
        title: 'Comprobante de devolución enviado',
        message: `Tu comprobante de devolución para la rendición "${report.title}" fue enviado correctamente. Contabilidad verificará el depósito.`,
        type: 'success',
        actionUrl: `/mis-rendiciones/${id}/detalle`,
      })
      .catch(() => { })

    const accountingUsers =
      await this.userService.findAccountingRecipientsWithIds(clientId)
    for (const u of accountingUsers) {
      this.emailService
        .sendRendicionDevolucionCargada(u.email, {
          clientId,
          recipientName: u.name,
          collaboratorName,
          reportTitle: report.title,
          amountFormatted,
          depositDate: dto.depositDate,
          bankOrigin: dto.bankOrigin,
          operationNumber: dto.operationNumber,
          platformUrl,
        })
        .catch(() => { })
      this.notificationsService
        .create({
          userId: u._id,
          title: 'Comprobante de devolución recibido',
          message: `${collaboratorName} adjuntó el comprobante de devolución de S/ ${amountFormatted} para la rendición "${report.title}". Por favor, verifica el depósito.`,
          type: 'info',
          actionUrl: `/mis-rendiciones/${id}/detalle`,
        })
        .catch(() => { })
    }

    return this.expenseReportModel
      .findById(id)
      .exec() as Promise<ExpenseReportDocument>
  }

  /** Solicita reapertura (rol Gerencia/Admin). */
  async requestReopening(
    id: string,
    requestedBy: string,
    reason: string
  ): Promise<ExpenseReportDocument> {
    const report = await this.expenseReportModel.findById(id).exec()
    if (!report) throw new NotFoundException(`Rendición ${id} no encontrada`)
    if (report.status !== 'closed') {
      throw new BadRequestException(
        'Solo se puede solicitar reapertura de rendiciones cerradas'
      )
    }
    if (reason.trim().length < 200) {
      throw new BadRequestException(
        'El motivo de reapertura debe tener al menos 200 caracteres'
      )
    }
    const updatedClosure = {
      ...(report as any).closureRecord,
      reopeningStatus: 'requested' as const,
      reopeningRequestedBy: requestedBy,
      reopeningRequestedAt: new Date(),
      reopeningReason: reason,
    }
    const updated = await this.expenseReportModel
      .findByIdAndUpdate(
        id,
        { $set: { closureRecord: updatedClosure } },
        { new: true }
      )
      .exec()
    return updated!
  }

  /** Contabilidad aprueba o rechaza la reapertura. */
  async approveReopening(
    id: string,
    approvedBy: string,
    approve: boolean
  ): Promise<ExpenseReportDocument> {
    const report = await this.expenseReportModel.findById(id).exec()
    if (!report) throw new NotFoundException(`Rendición ${id} no encontrada`)
    const cr = (report as any).closureRecord
    if (!cr || cr.reopeningStatus !== 'requested') {
      throw new BadRequestException('No hay solicitud de reapertura pendiente')
    }
    const updates: any = {}
    if (approve) {
      updates.status = 'approved'
      updates.closureRecord = {
        ...cr,
        reopeningStatus: 'approved' as const,
        reopeningApprovedBy: approvedBy,
        reopeningApprovedAt: new Date(),
        reopenedAt: new Date(),
      }
    } else {
      updates.closureRecord = {
        ...cr,
        reopeningStatus: 'none' as const,
        reopeningApprovedBy: approvedBy,
        reopeningApprovedAt: new Date(),
      }
    }
    const updated = await this.expenseReportModel
      .findByIdAndUpdate(id, { $set: updates }, { new: true })
      .exec()
    return updated!
  }

  // ─── Cancel / Delete por colaborador ────────────────────────────────────────

  /** Cancela una rendición en estado 'solicited'. Solo el propietario puede cancelar. */
  async cancel(
    id: string,
    userId: string,
    reason?: string
  ): Promise<ExpenseReportDocument> {
    const report = await this.expenseReportModel.findById(id).lean().exec()
    if (!report)
      throw new NotFoundException(`Expense report with ID ${id} not found`)

    if (
      String(report.userId) !== String(userId) &&
      String(report.createdBy) !== String(userId)
    ) {
      throw new ForbiddenException(
        'No tienes permiso para cancelar esta rendición'
      )
    }
    if (report.status !== 'solicited') {
      throw new BadRequestException(
        'Solo se puede cancelar una rendición en estado solicitada.'
      )
    }

    const updated = await this.expenseReportModel
      .findByIdAndUpdate(id, { $set: { status: 'cancelled' } }, { new: true })
      .exec()
    if (!updated)
      throw new NotFoundException(`Expense report with ID ${id} not found`)

    try {
      const admins = await this.userService.findAdminsByClient(
        String(report.clientId)
      )
      const user = await this.userService.findOne(userId)
      const collaboratorName = user.name || 'Un colaborador'

      for (const admin of admins) {
        if (admin.email) {
          await this.emailService.sendRendicionCancelada(admin.email, {
            clientId: String(report.clientId),
            adminName: admin.name || 'Administrador',
            collaboratorName,
            reportTitle: report.title,
            cancelReason: reason,
          })
        }
        await this.notificationsService.create({
          userId: String(admin._id),
          title: 'Rendición cancelada',
          message: `${collaboratorName} ha cancelado su solicitud de rendición: "${report.title}"`,
          type: 'warning',
          actionUrl: `/mis-rendiciones/${id}/detalle`,
        })
      }
    } catch (error) {
      console.error(
        'Error enviando notificaciones de rendición cancelada',
        error
      )
    }

    return updated
  }

  /** Contabilidad reabre una rendición directamente (sin ciclo request/approve). Vuelve a estado 'open'. */
  async reopen(
    id: string,
    reopenedBy: string,
    reason: string
  ): Promise<ExpenseReportDocument> {
    const trimmedReason = reason?.trim() ?? ''
    if (!trimmedReason) {
      throw new BadRequestException('El motivo de reapertura es obligatorio.')
    }
    const report = await this.expenseReportModel.findById(id).exec()
    if (!report) throw new NotFoundException(`Rendición ${id} no encontrada`)

    const nonReopenable: string[] = ['open', 'solicited', 'cancelled']
    if (nonReopenable.includes(report.status)) {
      throw new BadRequestException(
        `La rendición ya está en estado "${report.status}". No se puede reabrir.`
      )
    }

    const reopenEntry = {
      reason: trimmedReason,
      reopenedBy,
      reopenedAt: new Date(),
      fromStatus: report.status,
    }
    // Al reabrir, la notificación previa a contabilidad (si la hubo) queda obsoleta:
    // los montos pueden cambiar antes del próximo cierre. Limpiamos esa marca para
    // que el correo se vuelva a enviar con el monto correcto. No tocamos
    // `reimbursementPaymentInfo` ni `returnVoucher` porque representan pagos reales.
    // También limpiamos `settlement` porque sus montos (advanceTotal, expenseTotal,
    // difference) reflejan el estado al momento del cierre anterior; cualquier nuevo
    // anticipo o gasto durante esta reapertura los volvería stale. Sin settlement, la UI
    // y los flujos de cierre/reembolso/devolución caen al cómputo live. La próxima
    // aprobación reconstruirá un settlement fresco vía liquidateExpenseReport.
    const updated = await this.expenseReportModel
      .findByIdAndUpdate(
        id,
        {
          $set: { status: 'open' },
          $unset: { reimbursementAccountingNotifiedAt: '', settlement: '' },
          $push: { reopenHistory: reopenEntry },
        },
        { new: true }
      )
      .exec()
    if (!updated) throw new NotFoundException(`Rendición ${id} no encontrada`)

    const collaborator = await this.userService.findEmailNameClient(
      report.userId.toString()
    )
    const platformUrl = this.emailService.buildAppUrl(
      `/mis-rendiciones/${id}/detalle`
    )
    const clientIdStr = report.clientId.toString()
    const reportTitle = updated.title

    this.notificationsService
      .create({
        userId: report.userId.toString(),
        title: 'Rendición reabierta',
        message: `Tu rendición fue reabierta por contabilidad. Motivo: ${trimmedReason.slice(0, 100)}. Ya puedes editar tus comprobantes.`,
        type: 'warning',
        actionUrl: `/mis-rendiciones/${id}/detalle`,
      })
      .catch(() => { })

    if (collaborator?.email) {
      const collaboratorEmailEnabled = await this.userService.isEmailEnabled(
        report.userId.toString()
      )
      if (collaboratorEmailEnabled) {
        this.emailService
          .sendRendicionReabierta(collaborator.email, {
            clientId: clientIdStr,
            recipientName: collaborator.name,
            reportTitle,
            reason: trimmedReason,
            intro:
              'Su rendición cerrada fue reabierta por Contabilidad. Ya puede editar sus comprobantes y volver a enviarla.',
            platformUrl,
          })
          .catch((err: unknown) =>
            console.error(
              `Correo reapertura colaborador ${collaborator.email}: ${err instanceof Error ? err.message : String(err)}`
            )
          )
      }
    }

    // Notificar al coordinador (in-app + correo)
    try {
      const profile = await this.userService.findTransactionalProfile(
        report.userId.toString()
      )
      const coordinatorId = profile?.coordinatorId?.toString?.()
      if (coordinatorId) {
        this.notificationsService
          .create({
            userId: coordinatorId,
            title: 'Rendición reabierta por Contabilidad',
            message: `La rendición "${reportTitle}" fue reabierta. Motivo: ${trimmedReason.slice(0, 100)}.`,
            type: 'info',
            actionUrl: `/mis-rendiciones/${id}/detalle`,
          })
          .catch(() => { })

        try {
          const coordinator =
            await this.userService.findEmailNameClient(coordinatorId)
          const coordinatorEmailEnabled =
            await this.userService.isEmailEnabled(coordinatorId)
          if (coordinator?.email && coordinatorEmailEnabled) {
            this.emailService
              .sendRendicionReabierta(coordinator.email, {
                clientId: clientIdStr,
                recipientName: coordinator.name,
                reportTitle,
                reason: trimmedReason,
                intro: `La rendición de ${collaborator?.name || 'el colaborador'} que usted aprobó fue reabierta por Contabilidad.`,
                platformUrl,
              })
              .catch((err: unknown) =>
                console.error(
                  `Correo reapertura coordinador ${coordinator.email}: ${err instanceof Error ? err.message : String(err)}`
                )
              )
          }
        } catch { }
      }
    } catch { }

    return updated
  }

  /** Guard: lanza ForbiddenException si la rendición está cerrada. */
  async assertNotClosed(id: string): Promise<void> {
    const report = await this.expenseReportModel
      .findById(id)
      .select('status closureRecord')
      .exec()
    if (!report) throw new NotFoundException(`Rendición ${id} no encontrada`)
    if (report.status === 'closed') {
      throw new ForbiddenException(
        'La rendición está cerrada y no permite modificaciones'
      )
    }
  }

  // ─── VIÁTICOS UNIFICADOS (type = 'viatico') ──────────────────────────────────

  private viaticoStartOfDay(d: Date): Date {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    return x
  }

  private viaticoFormatMoney(value: number): string {
    if (!Number.isFinite(value)) return '0.00'
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  /** Símbolo de moneda ('S/' / '$') a partir del código SUNAT guardado en el viático. */
  private viaticoMoneySymbol(moneda?: string): string {
    return monedaSymbol(moneda)
  }

  private viaticoEscapeHtml(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  private computeViaticoLineTotal(line: CreateAdvanceLineDto): number {
    const imp = Number(line.importe) || 0
    const glp = Number(line.glpPerDay) || 0
    const d = Number(line.days) || 0
    const p = Number(line.peopleCount) || 0
    const raw = glp > 0 ? imp * glp * d : imp * p * d
    return Math.round(raw * 100) / 100
  }

  private isValidViaticoReceipt(mimeType?: string, fileName?: string, sizeBytes?: number) {
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png']
    const allowedExt = ['.pdf', '.jpg', '.jpeg', '.png']
    const mime = (mimeType ?? '').toLowerCase().trim()
    const name = (fileName ?? '').toLowerCase().trim()
    if (!allowedMimes.includes(mime) && !allowedExt.some(e => name.endsWith(e))) {
      return { ok: false, reason: 'Formato inválido. Solo se permite PDF, JPG o PNG.' }
    }
    if (typeof sizeBytes === 'number' && sizeBytes > 10 * 1024 * 1024) {
      return { ok: false, reason: 'El comprobante excede 10MB.' }
    }
    return { ok: true }
  }

  private addViaticoBusinessDays(date: Date, days: number): Date {
    const result = new Date(date)
    let added = 0
    while (added < days) {
      result.setDate(result.getDate() + 1)
      const dow = result.getDay()
      if (dow !== 0 && dow !== 6) added++
    }
    return result
  }

  private async validateViaticoLines(
    dto: { place: string; startDate: string; endDate: string; projectId: string; lines?: CreateAdvanceLineDto[]; observations?: string; amount: number },
    clientId: string
  ) {
    const start = this.viaticoStartOfDay(new Date(dto.startDate))
    const end = this.viaticoStartOfDay(new Date(dto.endDate))
    if (end < start) throw new BadRequestException('La fecha fin debe ser mayor o igual a la fecha inicio.')

    const today = this.viaticoStartOfDay(new Date())
    if (start < today) {
      throw new BadRequestException('La fecha de inicio no puede ser anterior a hoy.')
    }

    await this.projectService.findOne(dto.projectId, clientId)

    // El monto requerido lo ingresa directamente el colaborador; ya no se arma a
    // partir de un detalle por categoría. `lines` solo se procesa si viene (datos
    // legados o clientes antiguos en caché) y en ese caso valida contra `amount`.
    const lineDocs: { categoryId: Types.ObjectId; detalle?: string; importe: number; peopleCount: number; glpPerDay: number; days: number; lineTotal: number }[] = []
    const lines = dto.lines ?? []
    let sum = 0
    for (const line of lines) {
      const cat = await this.categoryService.findOne(line.categoryId, clientId)
      if (!cat.isActive) throw new BadRequestException(`La categoría "${cat.name}" está inactiva.`)
      const expected = this.computeViaticoLineTotal(line)
      if (Math.abs(line.lineTotal - expected) > 0.02) {
        throw new BadRequestException(`Total de línea inconsistente. Esperado S/ ${expected.toFixed(2)}, recibido S/ ${line.lineTotal.toFixed(2)}.`)
      }
      sum += line.lineTotal
      const det = line.detalle?.trim()
      lineDocs.push({ categoryId: new Types.ObjectId(line.categoryId), detalle: det?.length ? det : undefined, importe: line.importe, peopleCount: line.peopleCount, glpPerDay: line.glpPerDay, days: line.days, lineTotal: line.lineTotal })
    }

    let roundedSum: number
    if (lines.length > 0) {
      roundedSum = Math.round(sum * 100) / 100
      if (Math.abs(roundedSum - dto.amount) > 0.02) {
        throw new BadRequestException(`El monto total (S/ ${dto.amount}) debe coincidir con la suma de líneas (S/ ${roundedSum}).`)
      }
    } else {
      if (!Number.isFinite(dto.amount) || dto.amount <= 0) {
        throw new BadRequestException('Indique el monto requerido.')
      }
      roundedSum = Math.round(dto.amount * 100) / 100
    }

    const startFmt = this.emailService.formatDateDDMMYYYY(dto.startDate as any)
    const endFmt = this.emailService.formatDateDDMMYYYY(dto.endDate as any)
    const description = dto.observations?.trim()
      ? `Viático: ${dto.place.trim()} (${startFmt} → ${endFmt}) | ${dto.observations.trim()}`
      : `Viático: ${dto.place.trim()} (${startFmt} → ${endFmt})`

    return { lineDocs, roundedSum, description }
  }

  /**
   * Arma la cadena de aprobadores de la SOLICITUD de viático (regla 1.3):
   * N2(seleccionado) si el centro está asignado al colaborador; N2(principal)
   * → N2(seleccionado) si no lo está.
   */
  private async buildSolicitudCostCenterChain(
    profile: { projectIds?: string[]; primaryProjectId?: string },
    selectedProjectId: string,
    creatorId: string,
    clientId: string
  ): Promise<ChainStep[]> {
    const assignedProjectIds = profile.projectIds ?? []
    const idsToLoad = [...new Set([...assignedProjectIds, selectedProjectId])]
    const projects = await this.projectService.findManyByIds(idsToLoad, clientId)
    const projectById = new Map<string, ChainProject>(
      projects.map(p => [String(p._id), p as unknown as ChainProject])
    )
    return buildSolicitudChain({
      assignedProjectIds,
      primaryProjectId: profile.primaryProjectId,
      selectedProjectId,
      creatorId,
      projectById,
    })
  }

  /**
   * Construye la cadena de aprobación por documento (regla 1.4) de los
   * comprobantes indicados que **todavía no tengan una** (`approverChain ===
   * undefined`). No se usa ya únicamente al enviar la rendición completa: se
   * llama sobre todo al registrar CADA comprobante (ver
   * `buildChainForNewExpense`), para que N1/N2/[N2 sel] puedan empezar a
   * aprobar desde el momento en que se sube, sin esperar a que el colaborador
   * termine de cargar todo y haga clic en "Enviar". Que no toque comprobantes
   * que YA tienen cadena es deliberado: evita pisar aprobaciones en curso si
   * esta función se vuelve a llamar más tarde (p. ej. al enviar la rendición,
   * como red de seguridad para comprobantes legados sin cadena). Tampoco toca
   * comprobantes ya rechazados — su reapertura resetea la cadena aparte (ver
   * `ExpenseService.updateExpense`, rama de corrección de rechazo).
   *
   * `opts.force` reconstruye la cadena aunque ya exista una — solo lo usan
   * `addExpenseToReport` (rama `wasRejected`) y `resubmitSilent`: cuando se
   * rechaza la RENDICIÓN completa (no un comprobante individual) y el
   * colaborador corrige y reenvía, el revisor debe volver a validar todo
   * desde cero, así que cualquier aprobación N1/N2 previa se descarta.
   */
  private async buildExpenseChains(
    expenseIds: Types.ObjectId[],
    ownerUserId: string,
    clientId: string,
    opts: { force?: boolean } = {}
  ): Promise<void> {
    if (expenseIds.length === 0) return
    const profile = await this.userService.findTransactionalProfile(ownerUserId)
    const assignedProjectIds = profile?.projectIds ?? []
    const primaryProjectId = profile?.primaryProjectId

    const expenses = await this.expenseModel
      .find({ _id: { $in: expenseIds } })
      .select('proyectId status approverChain')
      .exec()

    const projectIdsToLoad = [
      ...new Set(
        [...assignedProjectIds, ...expenses.map(e => e.proyectId?.toString())].filter(
          (x): x is string => !!x
        )
      ),
    ]
    const projects = await this.projectService.findManyByIds(projectIdsToLoad, clientId)
    const projectById = new Map<string, ChainProject>(
      projects.map(p => [String(p._id), p as unknown as ChainProject])
    )

    for (const expense of expenses) {
      if (expense.status === 'rejected') continue
      if (expense.approverChain !== undefined && !opts.force) continue
      const selectedProjectId = expense.proyectId?.toString()
      if (!selectedProjectId) continue
      const chain = buildRendicionChain({
        assignedProjectIds,
        primaryProjectId,
        selectedProjectId,
        creatorId: ownerUserId,
        projectById,
      })
      expense.approverChain = chain
      expense.requiredLevels = chain.length
      expense.approvalLevel = 0
      await expense.save()
      // Aprobación en paralelo: TODOS los pasos son accionables desde que se
      // construye la cadena (no solo el primero) — se notifica a los
      // aprobadores de cada uno.
      for (const step of chain) {
        void this.notifyExpensePendingApprovers(expense, step)
      }
    }
  }

  /**
   * Construye la cadena de aprobación de UN comprobante recién creado —
   * público, lo llama `ExpenseService` justo después de guardarlo. Aprobación
   * en paralelo desde el momento del registro: N1/N2/[N2 sel] pueden empezar
   * a aprobar de inmediato, sin esperar a que se envíe la rendición completa.
   */
  async buildChainForNewExpense(
    expenseId: string,
    ownerUserId: string,
    clientId: string
  ): Promise<void> {
    if (!ownerUserId || !clientId) return
    await this.buildExpenseChains([new Types.ObjectId(expenseId)], ownerUserId, clientId)
  }

  /**
   * Notifica (in-app) a los approverIds de un paso de un comprobante que les
   * toca revisarlo. Se llama por cada paso pendiente al construir la cadena
   * (aprobación en paralelo: todos son accionables desde el envío).
   */
  async notifyExpensePendingApprovers(
    expense: { _id: unknown; total?: number; expenseReportId?: unknown },
    step: ChainStep
  ): Promise<void> {
    const expenseId = String((expense as any)._id)
    for (const approverId of step.approverIds) {
      try {
        await this.notificationsService.create({
          userId: approverId.toString(),
          title: 'Comprobante pendiente de tu aprobación',
          message: `Un comprobante de S/ ${Number((expense as any).total ?? 0).toFixed(2)} está pendiente de tu revisión (nivel ${step.level}).`,
          type: 'info',
          actionUrl: `/mis-rendiciones/${(expense as any).expenseReportId?.toString() ?? ''}/detalle`,
          metadata: { expenseId, event: 'expense_pending_coord' },
        })
      } catch (err: unknown) {
        this.logger.error(`Notif comprobante pendiente ${expenseId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  async createViatico(dto: CreateViaticoExpenseReportDto, userId: string, clientId: string): Promise<ExpenseReportDocument> {
    const profile = await this.userService.findTransactionalProfile(userId)
    if (!profile?.signature?.trim()) {
      throw new ForbiddenException('Debe registrar su firma digital en el perfil antes de solicitar viáticos.')
    }

    const chain = await this.buildSolicitudCostCenterChain(profile, dto.projectId, userId, clientId)

    // `dto.amount` es el costo del viático (suma de líneas). El saldo heredado NO se
    // suma al anticipo: prefinancia ese costo igual que un saldo de la bolsa.
    const { lineDocs, roundedSum, description } = await this.validateViaticoLines(
      { place: dto.place, startDate: dto.startDate, endDate: dto.endDate, projectId: dto.projectId, lines: dto.lines, observations: dto.observations, amount: dto.amount },
      clientId
    )

    // Regla 1.6: si todos los niveles del centro de costo quedaron omitidos
    // (vacíos, o el creador era el único aprobador sin nivel superior), la
    // cadena queda vacía — la solicitud pasa directo al gate de Contabilidad
    // en vez de quedar en pending_l1 sin nadie que pueda avanzarla.
    const initialStatus = chain.length === 0 ? 'pending_contabilidad' : 'pending_l1'

    const report = await this.expenseReportModel.create({
      type: 'viatico',
      userId: new Types.ObjectId(userId),
      clientId: new Types.ObjectId(clientId),
      createdBy: new Types.ObjectId(userId),
      projectId: new Types.ObjectId(dto.projectId),
      description,
      status: initialStatus,
      expenseIds: [],
      budget: roundedSum,
      viaticoAmount: roundedSum,
      viaticoMoneda: dto.moneda?.trim() || DEFAULT_MONEDA,
      viaticoApproverChain: chain,
      viaticoRequiredLevels: chain.length,
      viaticoApprovalLevel: 0,
      viaticoApprovalHistory: [],
      viaticoSolicitudVersion: 1,
      viaticoBudgetCommitmentRecorded: false,
      viaticoPlace: dto.place.trim(),
      ...(dto.lat != null && { viaticoLat: dto.lat }),
      ...(dto.lng != null && { viaticoLng: dto.lng }),
      viaticoStartDate: new Date(dto.startDate),
      viaticoEndDate: new Date(dto.endDate),
      viaticoLines: lineDocs,
      viaticoObservations: dto.observations?.trim(),
      ...(dto.bankName?.trim() && { viaticoBankName: dto.bankName.trim() }),
      ...(dto.accountNumber?.trim() && { viaticoAccountNumber: dto.accountNumber.trim() }),
      ...(dto.cci?.trim() && { viaticoCci: dto.cci.trim() }),
      ...(dto.ordenTrabajoId && { viaticoOrdenTrabajoId: new Types.ObjectId(dto.ordenTrabajoId) }),
    })

    if (initialStatus === 'pending_contabilidad') {
      void this.notifyContabilidadPendingApproval(report as ExpenseReportDocument)
    } else {
      void this.notifyViaticoCoordinator(report as ExpenseReportDocument, userId, clientId)
    }

    return this.findOne(String((report as any)._id)) as Promise<ExpenseReportDocument>
  }

  /**
   * Notifica a los aprobadores de TODOS los pasos aún pendientes de
   * `viaticoApproverChain` (aprobación en paralelo entre niveles: N1/N2/N3
   * son accionables desde el envío, sin importar el orden). Se llama tanto al
   * crear la solicitud como tras cada aprobación intermedia, para reforzar el
   * aviso a quienes todavía no actuaron.
   */
  private async notifyViaticoCoordinator(report: ExpenseReportDocument, collaboratorUserId: string, clientId: string): Promise<void> {
    const reportId = String((report as any)._id)
    const collaborator = await this.userService.findEmailNameClient(collaboratorUserId)
    const pendingSteps = (report.viaticoApproverChain ?? []).filter(s => !s.approved)
    const approverIds = [
      ...new Map(
        pendingSteps.flatMap(s => s.approverIds).map(id => [id.toString(), id])
      ).values(),
    ]
    if (approverIds.length === 0) {
      await this.expenseReportModel.updateOne({ _id: (report as any)._id }, { $set: { viaticoCoordinatorNotification: { status: 'skipped', sentAt: new Date(), errorMessage: 'Sin aprobador asignado en este paso' } } })
      return
    }

    // Cualquiera de los aprobadores de cualquier paso pendiente puede actuar — se notifica a todos.
    for (const coordId of approverIds) {
      const coordinator = await this.userService.findEmailNameClient(coordId.toString())
      if (!coordinator || !collaborator) {
        await this.expenseReportModel.updateOne({ _id: (report as any)._id }, { $set: { viaticoCoordinatorNotification: { recipientUserId: coordId, status: 'skipped', sentAt: new Date(), errorMessage: 'Coordinador o colaborador no encontrado' } } })
        continue
      }
      if (coordinator.clientId && collaborator.clientId && coordinator.clientId.toString() !== collaborator.clientId.toString()) {
        await this.expenseReportModel.updateOne({ _id: (report as any)._id }, { $set: { viaticoCoordinatorNotification: { recipientUserId: coordId, status: 'skipped', sentAt: new Date(), errorMessage: 'Coordinador de distinta empresa' } } })
        continue
      }

      try {
        await this.notificationsService.create({ userId: coordId.toString(), title: 'Nueva solicitud de viáticos pendiente', message: `${collaborator.name} solicitó viáticos — ${this.viaticoMoneySymbol(report.viaticoMoneda)} ${this.viaticoFormatMoney(report.viaticoAmount ?? 0)}. Ingresa a Aprobaciones para revisar.`, type: 'info', actionUrl: '/viaticos', metadata: { reportId, collaboratorUserId, event: 'viatico_submitted' } })
      } catch (err: unknown) { this.logger.error(`In-app notif viático ${reportId}: ${err instanceof Error ? err.message : String(err)}`) }

      const coordEmailEnabled = await this.userService.isEmailEnabled(coordId.toString())
      if (!coordEmailEnabled) {
        await this.expenseReportModel.updateOne({ _id: (report as any)._id }, { $set: { viaticoCoordinatorNotification: { recipientUserId: coordId, status: 'skipped', sentAt: new Date(), errorMessage: 'Notificaciones por correo deshabilitadas' } } })
        continue
      }

      try {
        const project = await this.projectService.findOne(report.projectId!.toString(), clientId)
        const projectLabel = `[${project.code} - ${project.name}]`
        const startStr = report.viaticoStartDate instanceof Date ? report.viaticoStartDate.toISOString().slice(0, 10) : String(report.viaticoStartDate ?? '').slice(0, 10)
        const endStr = report.viaticoEndDate instanceof Date ? report.viaticoEndDate.toISOString().slice(0, 10) : String(report.viaticoEndDate ?? '').slice(0, 10)
        await this.emailService.sendViaticoSolicitudToCoordinator(coordinator.email, {
          clientId, coordinatorName: coordinator.name, collaboratorName: collaborator.name,
          place: report.viaticoPlace ?? '', startDate: startStr, endDate: endStr,
          totalFormatted: this.viaticoFormatMoney(report.viaticoAmount ?? 0),
          currencySymbol: this.viaticoMoneySymbol(report.viaticoMoneda),
          projectLabel, platformUrl: this.emailService.buildAppUrl('/viaticos'),
        })
        await this.expenseReportModel.updateOne({ _id: (report as any)._id }, { $set: { viaticoCoordinatorNotification: { recipientUserId: coordId, status: 'sent', sentAt: new Date() } } })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(`Correo coordinador viático ${reportId}: ${msg}`)
        await this.expenseReportModel.updateOne({ _id: (report as any)._id }, { $set: { viaticoCoordinatorNotification: { recipientUserId: coordId, status: 'failed', sentAt: new Date(), errorMessage: msg } } })
      }
    }
  }

  /**
   * Aprueba UN paso de la cadena de aprobadores del viático (regla 1.3).
   * Aprobación en paralelo entre niveles: cualquier aprobador de cualquier
   * paso aún pendiente puede actuar, sin importar el orden, o
   * Superadministrador (llave maestra). Cuando TODOS los pasos quedan
   * aprobados, la solicitud pasa a la espera de Contabilidad.
   */
  async approveViatico(id: string, opts: { approvedBy: string; notes?: string }, actorId: string, actorRole: string): Promise<ExpenseReportDocument> {
    const report = await this.expenseReportModel.findById(id)
    if (!report) throw new NotFoundException(`Viático ${id} no encontrado`)
    if (report.type !== 'viatico') throw new BadRequestException('Esta rendición no es de tipo viático')
    if (report.status !== 'pending_l1') throw new BadRequestException(`El viático no está pendiente de aprobación (estado actual: ${report.status})`)

    const chain = report.viaticoApproverChain ?? []
    const stepIndex = findActionableChainStep({ chain, actorId, actorRole })
    if (stepIndex === -1) {
      throw new ForbiddenException('No te corresponde aprobar esta solicitud en este momento')
    }

    const step = chain[stepIndex]
    const approvalLevel = report.viaticoApprovalLevel ?? 0
    ;(report.viaticoApprovalHistory ?? []).push({ level: step.level, approvedBy: opts.approvedBy, action: 'approved', notes: opts.notes, date: new Date() })
    chain[stepIndex] = {
      ...plainChainStep(step),
      approved: true,
      approvedBy: new Types.ObjectId(actorId),
      approvedAt: new Date(),
    }
    report.viaticoApproverChain = chain
    const nextLevel = approvalLevel + 1
    const isComplete = isChainFullyApproved(chain)
    report.viaticoApprovalLevel = nextLevel

    if (isComplete) {
      // Todos los aprobadores de centro de costo terminaron: siempre pasa por el
      // gate de Contabilidad antes de quedar lista para pago (aplica incluso si
      // el viático quedó 100% cubierto por saldo, sin desembolso real).
      report.status = 'pending_contabilidad'
      await report.save()
      this.notificationsService.create({ userId: report.userId.toString(), title: 'Solicitud de viáticos en aprobación final', message: `Tu solicitud por ${this.viaticoMoneySymbol(report.viaticoMoneda)} ${this.viaticoFormatMoney(report.viaticoAmount ?? 0)} fue aprobada por los centros de costo y está pendiente de la aprobación final de Contabilidad.`, type: 'info', actionUrl: '/mis-rendiciones' }).catch(() => {})
      await this.notifyContabilidadPendingApproval(report as ExpenseReportDocument)
    } else {
      await report.save()
      this.notificationsService.create({ userId: report.userId.toString(), title: 'Solicitud de viáticos en revisión', message: `Tu solicitud por ${this.viaticoMoneySymbol(report.viaticoMoneda)} ${this.viaticoFormatMoney(report.viaticoAmount ?? 0)} fue aprobada por uno de sus aprobadores (${nextLevel} de ${report.viaticoRequiredLevels ?? chain.length}) y está pendiente de los demás niveles.`, type: 'info', actionUrl: '/mis-rendiciones' }).catch(() => {})
      this.notifyViaticoCoordinator(report as ExpenseReportDocument, report.userId.toString(), report.clientId.toString()).catch(() => {})
    }

    return this.findOne(id) as Promise<ExpenseReportDocument>
  }

  /** Notifica a Contabilidad que un viático terminó su cadena de centro de costo y espera su aprobación final. */
  private async notifyContabilidadPendingApproval(report: ExpenseReportDocument): Promise<void> {
    try {
      const recipients = await this.userService.findViaticoAccountingNotifyRecipients(report.clientId.toString())
      const collaborator = await this.userService.findEmailNameClient(report.userId.toString())
      for (const r of recipients) {
        await this.emailService.sendViaticoAprobacionContabilidad(r.email, {
          clientId: report.clientId.toString(), recipientName: r.name, urgent: false, urgentBanner: '',
          emailTitle: 'Solicitud de viáticos pendiente de tu aprobación',
          detailBody: `<p>Viático por ${this.viaticoMoneySymbol(report.viaticoMoneda)} ${this.viaticoEscapeHtml(this.viaticoFormatMoney(report.viaticoAmount ?? 0))} de ${this.viaticoEscapeHtml(collaborator?.name ?? '')} fue aprobado por los centros de costo correspondientes. Requiere tu aprobación final antes de quedar lista para pago.</p>`,
          projectLabel: '', platformUrl: this.emailService.buildAppUrl('/viaticos'),
        }).catch(() => {})
      }
    } catch (err: unknown) {
      this.logger.error(`Notificación Contabilidad pendiente viático ${(report as any)._id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Gate final: Contabilidad aprueba una solicitud de viático que ya completó
   * su cadena de aprobadores de centro de costo. Solo entonces se registra el
   * compromiso presupuestal y se notifica a Tesorería para el pago.
   */
  async approveViaticoContabilidad(id: string, opts: { approvedBy: string; notes?: string }, actorId: string, actorRole: string): Promise<ExpenseReportDocument> {
    const report = await this.expenseReportModel.findById(id)
    if (!report) throw new NotFoundException(`Viático ${id} no encontrado`)
    if (report.type !== 'viatico') throw new BadRequestException('Esta rendición no es de tipo viático')
    if (report.status !== 'pending_contabilidad') throw new BadRequestException(`El viático no está pendiente de la aprobación de Contabilidad (estado actual: ${report.status})`)
    if (actorRole !== ROLES.CONTABILIDAD && actorRole !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenException('Solo Contabilidad puede aprobar este paso.')
    }

    const chainLevels = report.viaticoRequiredLevels ?? report.viaticoApproverChain?.length ?? 0
    ;(report.viaticoApprovalHistory ?? []).push({ level: chainLevels + 1, approvedBy: opts.approvedBy, action: 'approved', notes: opts.notes, date: new Date() })
    // Campos propios de la SOLICITUD — no usar contabilidadApprovedAt/By: esos
    // pertenecen a la aprobación de la RENDICIÓN de comprobantes (regla 1.4,
    // posterior al pago) y se pisarían entre sí.
    report.viaticoSolicitudContabilidadApprovedAt = new Date()
    report.viaticoSolicitudContabilidadApprovedBy = new Types.ObjectId(actorId)
    report.status = 'viatico_approved'
    await report.save()

    const autoOpenedBySaldo = await this.onViaticoFullyApproved(report as ExpenseReportDocument)

    if (!autoOpenedBySaldo) {
      this.notificationsService.create({ userId: report.userId.toString(), title: 'Solicitud de viáticos aprobada', message: `Tu solicitud por ${this.viaticoMoneySymbol(report.viaticoMoneda)} ${this.viaticoFormatMoney(report.viaticoAmount ?? 0)} fue aprobada. El pago está siendo procesado.`, type: 'success', actionUrl: '/mis-rendiciones' }).catch(() => {})
    }

    return this.findOne(id) as Promise<ExpenseReportDocument>
  }

  /** Devuelve `true` si el viático quedó cubierto 100% con saldo y se abrió sin pago. */
  private async onViaticoFullyApproved(report: ExpenseReportDocument): Promise<boolean> {
    if (report.projectId && !report.viaticoBudgetCommitmentRecorded) {
      try {
        await this.projectService.adjustCommittedAdvanceTotal(report.projectId.toString(), report.clientId.toString(), report.viaticoAmount ?? 0)
        await this.expenseReportModel.updateOne({ _id: (report as any)._id }, { $set: { viaticoBudgetCommitmentRecorded: true } })
      } catch (err: unknown) { this.logger.error(`Compromiso presupuestal viático ${(report as any)._id}: ${err instanceof Error ? err.message : String(err)}`) }
    }
    try {
      const recipients = await this.userService.findViaticoAccountingNotifyRecipients(report.clientId.toString())
      const collaborator = await this.userService.findEmailNameClient(report.userId.toString())
      for (const r of recipients) {
        await this.emailService.sendViaticoAprobacionContabilidad(r.email, {
          clientId: report.clientId.toString(), recipientName: r.name, urgent: false, urgentBanner: '', emailTitle: 'Solicitud de viáticos aprobada',
          detailBody: `<p>Viático por ${this.viaticoMoneySymbol(report.viaticoMoneda)} ${this.viaticoEscapeHtml(this.viaticoFormatMoney(report.viaticoAmount ?? 0))} de ${this.viaticoEscapeHtml(collaborator?.name ?? '')} aprobado y listo para pago.</p>`,
          projectLabel: '', platformUrl: this.emailService.buildAppUrl('/tesoreria'),
        }).catch(() => {})
      }
    } catch (err: unknown) { this.logger.error(`Notificación contabilidad viático ${(report as any)._id}: ${err instanceof Error ? err.message : String(err)}`) }

    // Notificar a tesorería con datos de pago del colaborador
    try {
      const reportId = String((report as any)._id)
      const clientIdStr = report.clientId.toString()
      console.log(`[TESORERÍA VIÁTICO] Buscando usuarios de tesorería para clientId=${clientIdStr}, reportId=${reportId}`)
      const tesoreriaRecipients = await this.userService.findTesoreriaNotifyRecipients(clientIdStr)
      const tesoreriaEmails = tesoreriaRecipients.map(r => r.email)
      console.log(`[TESORERÍA VIÁTICO] Emails de tesorería: ${JSON.stringify(tesoreriaEmails)}`)
      if (tesoreriaEmails.length > 0) {
        const collab = await this.userService.findOne(report.userId.toString())
        // Prefer bank data from the solicitud itself; fall back to user profile.
        const requestBank = report.viaticoAccountNumber?.trim()
          ? { bankName: report.viaticoBankName, accountNumber: report.viaticoAccountNumber, cci: report.viaticoCci, accountType: undefined as string | undefined }
          : null
        const profileBank = collab?.bankAccount ?? null
        const bank = requestBank ?? profileBank
        const hasBankAccount = !!(bank?.accountNumber)
        console.log(`[TESORERÍA VIÁTICO] colaborador=${collab?.name}, hasBankAccount=${hasBankAccount}, source=${requestBank ? 'solicitud' : 'perfil'}`)

        let projectLabel: string | undefined
        if (report.projectId) {
          try {
            const proj = await this.projectService.findOne(report.projectId.toString(), clientIdStr)
            projectLabel = `${proj.code ?? '—'} - ${proj.name ?? '—'}`
          } catch { /* proyecto opcional */ }
        }

        const platformUrl = this.emailService.buildAppUrl('/tesoreria')
        for (const tesoEmail of tesoreriaEmails) {
          console.log(`[TESORERÍA VIÁTICO] Enviando a ${tesoEmail}...`)
          await this.emailService.sendViaticoAprobadoTesoreria(tesoEmail, {
            clientId: clientIdStr,
            advanceDescription: report.viaticoPlace ?? report.title ?? 'Solicitud de viáticos',
            collaboratorName: collab?.name ?? 'Colaborador',
            collaboratorDni: collab?.dni,
            budgetFormatted: Number(report.viaticoAmount ?? 0).toFixed(2),
            currencySymbol: this.viaticoMoneySymbol(report.viaticoMoneda),
            projectLabel,
            hasBankAccount,
            bankName: bank?.bankName || undefined,
            accountType: (bank as any)?.accountType === 'ahorros' ? 'Ahorros' : (bank as any)?.accountType === 'corriente' ? 'Corriente' : undefined,
            accountNumber: bank?.accountNumber || undefined,
            cci: bank?.cci || undefined,
            platformUrl,
          })
          console.log(`[TESORERÍA VIÁTICO] Enviado a ${tesoEmail} OK`)
        }
      }
    } catch (err: unknown) {
      console.error(`[TESORERÍA VIÁTICO] ERROR:`, err)
    }

    return false
  }

  async rejectViatico(id: string, opts: { rejectedBy: string; rejectionReason: string }, actorId: string, actorRole: string): Promise<ExpenseReportDocument> {
    const report = await this.expenseReportModel.findById(id)
    if (!report) throw new NotFoundException(`Viático ${id} no encontrado`)
    if (report.type !== 'viatico') throw new BadRequestException('Esta rendición no es de tipo viático')
    if (!['pending_l1', 'pending_contabilidad'].includes(report.status)) {
      throw new BadRequestException(`No se puede rechazar en estado "${report.status}"`)
    }

    let rejectedByRole: 'centro_costo' | 'contabilidad'
    let rejectedAtLevel = (report.viaticoApprovalLevel ?? 0) + 1
    if (report.status === 'pending_contabilidad') {
      if (actorRole !== ROLES.CONTABILIDAD && actorRole !== ROLES.SUPER_ADMIN) {
        throw new ForbiddenException('No tienes permiso para rechazar esta solicitud')
      }
      rejectedByRole = 'contabilidad'
    } else {
      // Aprobación en paralelo: cualquier aprobador de un paso aún pendiente
      // puede rechazar la solicitud completa — no solo "el turno actual".
      const chain = report.viaticoApproverChain ?? []
      const stepIndex = findActionableChainStep({ chain, actorId, actorRole })
      if (stepIndex === -1) {
        throw new ForbiddenException('No tienes permiso para rechazar esta solicitud')
      }
      rejectedAtLevel = chain[stepIndex].level
      rejectedByRole = 'centro_costo'
    }

    if ((opts.rejectionReason?.trim() ?? '').length < 10) throw new BadRequestException('El motivo de rechazo debe tener al menos 10 caracteres.')

    ;(report.viaticoApprovalHistory ?? []).push({ level: rejectedAtLevel, approvedBy: opts.rejectedBy, action: 'rejected', notes: opts.rejectionReason, date: new Date() })
    report.status = 'rejected'
    report.viaticoRejectedBy = opts.rejectedBy
    report.viaticoRejectionReason = opts.rejectionReason
    report.viaticoRejectedByRole = rejectedByRole
    await report.save()

    this.notificationsService.create({ userId: report.userId.toString(), title: 'Solicitud de viáticos rechazada', message: `Tu solicitud por ${this.viaticoMoneySymbol(report.viaticoMoneda)} ${this.viaticoFormatMoney(report.viaticoAmount ?? 0)} fue rechazada. Motivo: ${opts.rejectionReason}`, type: 'error', actionUrl: '/mis-rendiciones' }).catch(() => {})

    const collaborator = await this.userService.findEmailNameClient(report.userId.toString())
    if (collaborator?.email && await this.userService.isEmailEnabled(report.userId.toString())) {
      this.emailService.sendViaticoRechazoColaborador(collaborator.email, {
        clientId: report.clientId.toString(), collaboratorName: collaborator.name,
        collaboratorDocument: '', collaboratorArea: '', collaboratorCargo: '',
        projectLabel: '', rejectionReason: opts.rejectionReason,
        platformUrl: this.emailService.buildAppUrl(`/mis-rendiciones`),
      }).catch(() => {})
    }

    return this.findOne(id) as Promise<ExpenseReportDocument>
  }

  /**
   * @removed approveDirecta/rejectDirecta/notifyDirectaCoordinator — la
   * aprobación de rendición directa ya no vive a nivel de reporte: usa la
   * misma cadena por comprobante que la rendición normal (ver
   * `buildExpenseChains` y `ExpenseService.approveByCoord/rejectByCoord`).
   */

  async resubmitViatico(id: string, dto: ResubmitViaticoDto, actingUserId: string, clientId: string): Promise<ExpenseReportDocument> {
    const report = await this.expenseReportModel.findById(id)
    if (!report) throw new NotFoundException(`Viático ${id} no encontrado`)
    if (report.type !== 'viatico') throw new BadRequestException('Esta rendición no es de tipo viático')
    if (!['rejected', 'pending_l1'].includes(report.status)) throw new BadRequestException('Solo pueden reenviarse solicitudes rechazadas o pendientes de aprobación.')
    if (report.userId.toString() !== actingUserId) throw new ForbiddenException('Solo el colaborador solicitante puede corregir y reenviar esta solicitud.')
    if (report.clientId.toString() !== clientId) throw new ForbiddenException('La solicitud no pertenece a su organización.')

    const profile = await this.userService.findTransactionalProfile(actingUserId)
    if (!profile?.signature?.trim()) throw new ForbiddenException('Debe registrar su firma digital en el perfil antes de reenviar viáticos.')

    const { lineDocs, roundedSum, description } = await this.validateViaticoLines(
      { place: dto.place, startDate: dto.startDate, endDate: dto.endDate, projectId: dto.projectId, lines: dto.lines, observations: dto.observations, amount: dto.amount },
      clientId
    )

    // La cadena de aprobadores se recalcula desde el centro de costo elegido y
    // los centros de costo asignados actuales del colaborador (pueden haber
    // cambiado desde la solicitud original).
    const chain = await this.buildSolicitudCostCenterChain(profile, dto.projectId, actingUserId, clientId)

    const wasEditing = report.status === 'pending_l1'
    report.viaticoPlace = dto.place.trim()
    if (dto.lat != null) report.viaticoLat = dto.lat
    if (dto.lng != null) report.viaticoLng = dto.lng
    report.viaticoStartDate = new Date(dto.startDate)
    report.viaticoEndDate = new Date(dto.endDate)
    report.projectId = new Types.ObjectId(dto.projectId)
    report.viaticoLines = lineDocs
    report.viaticoObservations = dto.observations?.trim()
    report.viaticoBankName = dto.bankName?.trim() || undefined
    report.viaticoAccountNumber = dto.accountNumber?.trim() || undefined
    report.viaticoCci = dto.cci?.trim() || undefined
    report.viaticoOrdenTrabajoId = dto.ordenTrabajoId
      ? new Types.ObjectId(dto.ordenTrabajoId)
      : undefined
    report.viaticoAmount = roundedSum
    if (dto.moneda?.trim()) report.viaticoMoneda = dto.moneda.trim()
    report.budget = roundedSum
    report.description = description
    // Regla 1.6: cadena vacía (todos los niveles omitidos) va directo a Contabilidad.
    report.status = chain.length === 0 ? 'pending_contabilidad' : 'pending_l1'
    report.viaticoApprovalLevel = 0
    report.viaticoApproverChain = chain
    report.viaticoRequiredLevels = chain.length
    report.viaticoRejectedBy = undefined
    report.viaticoRejectionReason = undefined
    report.viaticoBudgetCommitmentRecorded = false
    report.viaticoSolicitudVersion = (report.viaticoSolicitudVersion ?? 1) + 1
    ;(report.viaticoApprovalHistory ?? []).push({ level: 0, approvedBy: actingUserId, action: 'resubmitted', notes: wasEditing ? 'Solicitud editada antes de aprobación' : 'Solicitud corregida y reenviada tras rechazo', date: new Date() })
    await report.save()

    if (report.status === 'pending_contabilidad') {
      void this.notifyContabilidadPendingApproval(report as ExpenseReportDocument)
    } else {
      void this.notifyViaticoCoordinator(report as ExpenseReportDocument, actingUserId, clientId)
    }

    return this.findOne(id) as Promise<ExpenseReportDocument>
  }

  async registerViaticoPayment(id: string, dto: PayViaticoDto, userRole: string, userPermissions?: any, opts?: { bypassReceipt?: boolean }): Promise<ExpenseReportDocument> {
    const report = await this.expenseReportModel.findById(id)
    if (!report) throw new NotFoundException(`Viático ${id} no encontrado`)
    if (report.type !== 'viatico') throw new BadRequestException('Esta rendición no es de tipo viático')
    // Estados con saldo del anticipo aún por depositar. Tras el envío del colaborador
    // (submitted/pending_accounting) contabilidad todavía puede completar el pago parcial;
    // en esos casos solo se actualiza el monto pagado, sin tocar el estado del flujo.
    const PAYABLE_STATUSES = ['viatico_approved', 'partially_paid', 'submitted', 'pending_accounting']
    if (!PAYABLE_STATUSES.includes(report.status)) {
      throw new BadRequestException(`Solo se puede registrar pago de viáticos aprobados (estado actual: ${report.status})`)
    }

    const canPay = [ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD, ROLES.TESORERIA].includes(userRole as ROLES) || userPermissions?.canApproveL2 === true
    if (!canPay) throw new ForbiddenException('No tienes permiso para registrar pagos')

    if (!opts?.bypassReceipt && dto.method !== 'efectivo' && !dto.paymentReceiptUrl) throw new BadRequestException('El comprobante es obligatorio para pagos por transferencia o cheque.')
    if (dto.paymentReceiptUrl) {
      const v = this.isValidViaticoReceipt(dto.paymentReceiptMimeType, dto.paymentReceiptFileName, dto.paymentReceiptSizeBytes)
      if (!v.ok) throw new BadRequestException(v.reason)
    }

    const prevPaid = Number(report.viaticoPaidAmount ?? 0)
    const isFirstPayment = !report.viaticoPayments || report.viaticoPayments.length === 0
    const paymentAmount = Number(dto.amount ?? Math.max((report.viaticoAmount ?? 0) - prevPaid, 0))
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) throw new BadRequestException('El monto del pago debe ser mayor a 0.')

    if (isFirstPayment && report.viaticoBudgetCommitmentRecorded && report.projectId) {
      try {
        await this.projectService.adjustCommittedAdvanceTotal(report.projectId.toString(), report.clientId.toString(), -(report.viaticoAmount ?? 0))
      } catch (err: unknown) { this.logger.error(`Libera compromiso viático ${id}: ${err instanceof Error ? err.message : String(err)}`) }
      report.viaticoBudgetCommitmentRecorded = false
    }

    const paymentRecord = {
      amount: paymentAmount, method: dto.method, bankName: dto.bankName, accountNumber: dto.accountNumber,
      cci: dto.cci, transferDate: new Date(dto.transferDate), reference: dto.reference,
      paymentReceiptUrl: dto.paymentReceiptUrl ?? '', paymentReceiptFileName: dto.paymentReceiptFileName,
      paymentReceiptMimeType: dto.paymentReceiptMimeType, paymentReceiptSizeBytes: dto.paymentReceiptSizeBytes,
      scannedAmount: dto.scannedAmount, scannedTitular: dto.scannedTitular, operationNumber: dto.operationNumber,
      operationDate: dto.operationDate, operationTime: dto.operationTime, createdAt: new Date(),
    }
    report.viaticoPayments = [...(report.viaticoPayments ?? []), paymentRecord]
    report.viaticoPaidAmount = prevPaid + paymentAmount

    if (isFirstPayment) {
      report.viaticoPaymentInfo = { method: dto.method, bankName: dto.bankName, accountNumber: dto.accountNumber, cci: dto.cci, transferDate: new Date(dto.transferDate), reference: dto.reference, paymentReceiptUrl: dto.paymentReceiptUrl ?? '', paymentReceiptFileName: dto.paymentReceiptFileName, paymentReceiptMimeType: dto.paymentReceiptMimeType, paymentReceiptSizeBytes: dto.paymentReceiptSizeBytes }
    }

    const fullyPaid = report.viaticoPaidAmount >= (report.viaticoAmount ?? 0)

    // El estado solo se gestiona mientras la rendición está en fase de pago/carga
    // (aún no enviada por el colaborador): con el pago total pasa a 'open' para que
    // registre gastos; si sigue parcial queda 'partially_paid'. Si el colaborador ya
    // la envió (submitted/pending_accounting), el avance del flujo manda y completar
    // el pago solo actualiza el monto, sin revertir el estado.
    const inPrePaymentPhase =
      report.status === 'viatico_approved' || report.status === 'partially_paid'
    if (inPrePaymentPhase) {
      report.status = fullyPaid ? 'open' : 'partially_paid'
    }

    await report.save()

    const collabId = report.userId.toString()
    const collaborator = await this.userService.findEmailNameClient(collabId)
    const reportId = String((report as any)._id)

    // Centro de costo legible para los correos (igual que en el flujo de anticipo).
    let projectLabel = ''
    if (report.projectId) {
      try {
        const p = await this.projectService.findOne(report.projectId.toString(), report.clientId.toString())
        projectLabel = `[${p.code} - ${p.name}]`
      } catch { /* fallback a etiqueta vacía */ }
    }

    // Coordinador del colaborador: recibe copia del aviso de pago (correo + in-app),
    // igual que en la ruta del anticipo (advance.service.notifyViaticoPaymentRegistered).
    const profile = await this.userService.findTransactionalProfile(collabId)
    const coordinatorId = profile?.coordinatorId?.toString?.()
    const coordinator = coordinatorId ? await this.userService.findEmailNameClient(coordinatorId) : null
    const coordEmailEnabled = coordinatorId ? await this.userService.isEmailEnabled(coordinatorId) : false

    const viaticoSym = this.viaticoMoneySymbol(report.viaticoMoneda)
    const paymentEmailData = {
      clientId: report.clientId.toString(),
      collaboratorName: collaborator?.name ?? 'Colaborador',
      coordinatorName: coordinator?.name,
      projectLabel,
      amountFormatted: this.viaticoFormatMoney(report.viaticoAmount ?? 0),
      currencySymbol: viaticoSym,
      transferDate: new Date(dto.transferDate).toISOString().slice(0, 10),
      reference: dto.reference ?? '—',
      paymentMethod: dto.method,
      paymentReceiptUrl: dto.paymentReceiptUrl ?? '',
      paymentReceiptFileName: dto.paymentReceiptFileName ?? 'comprobante.pdf',
      platformUrl: this.emailService.buildAppUrl('/mis-rendiciones'),
    }

    const fullyPaidMsg = fullyPaid
      ? (inPrePaymentPhase
          ? `Se registró el pago de tu viático por ${viaticoSym} ${this.viaticoFormatMoney(paymentAmount)}. Ya puedes registrar tus gastos.`
          : `Se registró el pago restante de tu viático por ${viaticoSym} ${this.viaticoFormatMoney(paymentAmount)} (total pagado ${viaticoSym} ${this.viaticoFormatMoney(report.viaticoPaidAmount ?? 0)}).`)
      : `Se registró un pago parcial de tu viático por ${viaticoSym} ${this.viaticoFormatMoney(paymentAmount)} (total pagado ${viaticoSym} ${this.viaticoFormatMoney(report.viaticoPaidAmount ?? 0)} de ${viaticoSym} ${this.viaticoFormatMoney(report.viaticoAmount ?? 0)}).`

    this.notificationsService.create({ userId: collabId, title: fullyPaid ? 'Pago de viático registrado' : 'Pago parcial de viático registrado', message: fullyPaidMsg, type: 'success', actionUrl: `/mis-rendiciones/${reportId}/detalle` }).catch(() => {})

    if (collaborator?.email && await this.userService.isEmailEnabled(collabId)) {
      this.emailService.sendViaticoPagoRealizado(collaborator.email, {
        recipientName: collaborator.name,
        ...paymentEmailData,
      }).catch(() => {})
    }

    // Copia al coordinador: correo + notificación in-app.
    if (coordinator?.email && coordEmailEnabled) {
      this.emailService.sendViaticoPagoRealizado(coordinator.email, {
        recipientName: coordinator.name,
        ...paymentEmailData,
      }).catch(() => {})
    }
    if (coordinatorId) {
      this.notificationsService.create({
        userId: coordinatorId,
        title: fullyPaid ? 'Pago de viático registrado' : 'Pago parcial de viático registrado',
        message: `Se registró el pago del viático de ${collaborator?.name ?? 'un colaborador'} por ${viaticoSym} ${this.viaticoFormatMoney(paymentAmount)}.`,
        type: 'info',
        actionUrl: `/mis-rendiciones/${reportId}/detalle`,
      }).catch(() => {})
    }

    return this.findOne(id) as Promise<ExpenseReportDocument>
  }

  async cancelViatico(id: string, userId: string): Promise<ExpenseReportDocument> {
    const report = await this.expenseReportModel.findById(id)
    if (!report) throw new NotFoundException(`Viático ${id} no encontrado`)
    if (report.type !== 'viatico') throw new BadRequestException('Esta rendición no es de tipo viático')
    if (report.userId.toString() !== userId) throw new ForbiddenException('Solo el colaborador solicitante puede cancelar esta solicitud.')
    if (report.status !== 'pending_l1') throw new BadRequestException('Solo se puede cancelar una solicitud en estado pendiente de aprobación.')
    report.status = 'cancelled'
    await report.save()
    return this.findOne(id) as Promise<ExpenseReportDocument>
  }


  async findViaticos(opts: { requesterId: string; requesterRole: string; requesterPermissions?: any; clientId: string; status?: string; dateFrom?: string; dateTo?: string }) {
    const isAdmin = [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD].includes(opts.requesterRole as ROLES)
    // El rol "Coordinador" casi nunca se asigna literalmente: en la práctica un
    // aprobador es un Colaborador asignado como N1/N2 en algún centro de costo.
    // Sin este chequeo, cualquier aprobador-Colaborador caía en el filtro por
    // userId (solo sus propias solicitudes) y nunca veía las que debía aprobar.
    const isApprover =
      !isAdmin &&
      (opts.requesterRole === ROLES.COORDINADOR ||
        (await this.projectService.isApproverForClient(opts.requesterId, opts.clientId)))
    const filter: Record<string, unknown> = { type: 'viatico', clientId: new Types.ObjectId(opts.clientId) }

    // `viaticoApproverChain` es un array de pasos (`{ approverIds: ObjectId[] }`),
    // no un array de ObjectId — hay que filtrar por el subcampo.
    if (isApprover) filter['viaticoApproverChain.approverIds'] = new Types.ObjectId(opts.requesterId)
    else if (!isAdmin) filter['userId'] = new Types.ObjectId(opts.requesterId)

    if (opts.status && opts.status !== 'all') filter['status'] = opts.status
    if (opts.dateFrom || opts.dateTo) {
      const dateFilter: Record<string, Date> = {}
      if (opts.dateFrom) dateFilter['$gte'] = new Date(opts.dateFrom)
      if (opts.dateTo) { const to = new Date(opts.dateTo); to.setHours(23, 59, 59, 999); dateFilter['$lte'] = to }
      filter['createdAt'] = dateFilter
    }

    return this.expenseReportModel.find(filter)
      .populate('userId', 'name email bankAccount dni')
      .populate('projectId', 'code name')
      .populate('viaticoOrdenTrabajoId', 'nombre costCenterId')
      .populate('viaticoApproverChain.approverIds', 'name email')
      .sort({ viaticoStartDate: -1, createdAt: -1 })
      .exec()
  }

  async findMyViaticos(userId: string, clientId: string) {
    return this.expenseReportModel.find({
      type: 'viatico',
      userId: new Types.ObjectId(userId),
      clientId: new Types.ObjectId(clientId),
    })
      .populate('userId', 'name email')
      .populate('projectId', 'code name')
      .populate('viaticoOrdenTrabajoId', 'nombre costCenterId')
      .sort({ createdAt: -1 })
      .exec()
  }

  async initiateViaticoReturnTracking(id: string): Promise<ExpenseReportDocument> {
    const report = await this.expenseReportModel.findById(id)
    if (!report) throw new NotFoundException(`Viático ${id} no encontrado`)
    if (report.type !== 'viatico') throw new BadRequestException('Esta rendición no es de tipo viático')
    if (report.status !== 'settled') throw new BadRequestException('Solo se puede iniciar devolución desde estado liquidado')
    if (!report.settlement || report.settlement.type !== 'devolucion') throw new BadRequestException('Este viático no tiene saldo a devolver')

    const dueDate = this.addViaticoBusinessDays(new Date(), 10)
    await this.expenseReportModel.findByIdAndUpdate(id, {
      $set: { viaticoReturnRecord: { status: 'pending', amountDue: report.settlement.difference, dueDate, isOverdue: false, remindersSent: 0 } },
    })
    const collaborator = await this.userService.findEmailNameClient(report.userId.toString())
    if (collaborator?.email) {
      this.emailService.sendDevolucionPendiente(collaborator.email, {
        clientId: report.clientId.toString(), recipientName: collaborator.name,
        amountDue: this.viaticoFormatMoney(report.settlement.difference),
        currencySymbol: this.viaticoMoneySymbol(report.viaticoMoneda),
        dueDate: this.emailService.formatDateDDMMYYYY(dueDate), advanceId: id,
      }).catch(() => {})
    }
    return this.findOne(id) as Promise<ExpenseReportDocument>
  }

  async uploadViaticoReturnProof(id: string, proof: { depositDate: Date; amountReturned: number; bankOrigin: string; operationNumber: string; fileUrl: string; fileKey?: string; note?: string; scannedAmount?: number; operationDate?: string; operationTime?: string; titular?: string }): Promise<ExpenseReportDocument> {
    const report = await this.expenseReportModel.findById(id)
    if (!report) throw new NotFoundException(`Viático ${id} no encontrado`)
    if (report.type !== 'viatico') throw new BadRequestException('Esta rendición no es de tipo viático')
    const rr = (report as any).viaticoReturnRecord
    if (!rr || rr.status !== 'pending') throw new BadRequestException('No hay devolución pendiente de comprobante')
    if (proof.amountReturned < rr.amountDue) throw new BadRequestException(`El monto devuelto (${proof.amountReturned}) es menor al monto adeudado (${rr.amountDue})`)
    await this.expenseReportModel.findByIdAndUpdate(id, { $set: { viaticoReturnRecord: { ...rr, status: 'proof_uploaded', proof: { ...proof, uploadedAt: new Date() } } } })
    return this.findOne(id) as Promise<ExpenseReportDocument>
  }

  async validateViaticoReturn(id: string, approved: boolean, validatedBy: string, rejectionReason?: string): Promise<ExpenseReportDocument> {
    const report = await this.expenseReportModel.findById(id)
    if (!report) throw new NotFoundException(`Viático ${id} no encontrado`)
    if (report.type !== 'viatico') throw new BadRequestException('Esta rendición no es de tipo viático')
    const rr = (report as any).viaticoReturnRecord
    if (!rr || rr.status !== 'proof_uploaded') throw new BadRequestException('No hay comprobante pendiente de validación')
    if (!approved && (!rejectionReason || rejectionReason.trim().length < 50)) throw new BadRequestException('El motivo de rechazo debe tener al menos 50 caracteres')

    const validation = { validatedBy, validatedAt: new Date(), approved, rejectionReason }
    const updates: any = { viaticoReturnRecord: { ...rr, status: approved ? 'validated' : 'rejected', validation } }
    if (approved) updates.status = 'returned'
    await this.expenseReportModel.findByIdAndUpdate(id, { $set: updates })

    const collaborator = await this.userService.findEmailNameClient(report.userId.toString())
    if (collaborator?.email && await this.userService.isEmailEnabled(report.userId.toString())) {
      const sendFn = approved ? this.emailService.sendDevolucionValidada.bind(this.emailService) : this.emailService.sendDevolucionRechazada.bind(this.emailService)
      sendFn(collaborator.email, { clientId: report.clientId.toString(), recipientName: collaborator.name, amountDue: this.viaticoFormatMoney(rr.amountDue), rejectionReason, advanceId: id }).catch(() => {})
    }
    return this.findOne(id) as Promise<ExpenseReportDocument>
  }

  async findViaticosPendingReturns(clientId: string) {
    return this.expenseReportModel.find({
      type: 'viatico',
      clientId: new Types.ObjectId(clientId),
      'viaticoReturnRecord.status': { $in: ['pending', 'proof_uploaded', 'rejected'] },
    })
      .populate('userId', 'name email bankAccount dni')
      .exec()
  }

  /** Liquidación para rendiciones de tipo viático (sin Advance externo). */
  async liquidateViaticoReport(reportId: string, fromClose = false): Promise<void> {
    const report = await this.expenseReportModel.findById(reportId).populate('expenseIds').exec()
    if (!report || report.type !== 'viatico' || report.status !== 'approved') return

    const expenses = (report.expenseIds as any[]) || []
    const expenseTotal = expenses.reduce((sum, e) => {
      if (String(e?.status ?? '').toLowerCase() !== 'approved') return sum
      return sum + (Number(e.total) || 0)
    }, 0)

    const advanceTotal = Number(report.viaticoPaidAmount ?? 0)
    // Solo omitir si ambos son cero (nada que liquidar).
    if (advanceTotal <= 0 && expenseTotal <= 0) return

    const difference = advanceTotal - expenseTotal
    const type: 'reembolso' | 'devolucion' | 'equilibrado' =
      Math.abs(difference) < 0.01 ? 'equilibrado' : difference > 0 ? 'devolucion' : 'reembolso'

    await this.updateSettlement(reportId, { advanceTotal, expenseTotal, difference, type, settledAt: new Date() })

    // Auto-cierre inmediato cuando el viático queda equilibrado.
    // fromClose=true indica que esta llamada viene desde close() — evita recursión.
    if (!fromClose && type === 'equilibrado') {
      await this.close(reportId, 'sistema')
    }
  }
}
