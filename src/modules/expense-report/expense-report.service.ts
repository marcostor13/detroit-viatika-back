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
import { ADVANCE_THRESHOLDS } from '../advance/entities/advance.entity'
import { CreateViaticoExpenseReportDto } from './dto/create-viatico-expense-report.dto'
import { PayViaticoDto } from './dto/pay-viatico.dto'
import { ResubmitViaticoDto } from './dto/resubmit-viatico.dto'
import { CreateAdvanceLineDto } from '../advance/dto/create-advance.dto'
import { SaldoService } from '../saldo/saldo.service'
import { ClientService } from '../client/client.service'
import { Logger } from '@nestjs/common'

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
    private readonly categoryService: CategoryService,
    private readonly saldoService: SaldoService,
    private readonly clientService: ClientService
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

    // Saldos de la bolsa seleccionados (rendición directa financiada con saldo).
    const saldoIds = Array.isArray(createExpenseReportDto.saldoIds)
      ? createExpenseReportDto.saldoIds
      : []
    const hasSaldos = saldoIds.length > 0
    const saldoBudget = hasSaldos
      ? await this.saldoService.sumAmounts(
        saldoIds,
        createExpenseReportDto.userId,
        createExpenseReportDto.clientId
      )
      : 0

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
      pendingBalanceFromReportId:
        createExpenseReportDto.pendingBalanceFromReportId
          ? new Types.ObjectId(
            createExpenseReportDto.pendingBalanceFromReportId
          )
          : undefined,
      // Presupuesto: si se financia con saldos de la bolsa = suma de saldos;
      // si hereda saldo pendiente = monto heredado; caso normal = budget recibido.
      budget: hasSaldos
        ? saldoBudget
        : createExpenseReportDto.pendingBalanceFromReportId
          ? (createExpenseReportDto.pendingBalanceAmount ?? 0)
          : (createExpenseReportDto.budget ?? 0),
      saldoIds: hasSaldos
        ? saldoIds.map(id => new Types.ObjectId(id))
        : undefined,
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

    // Consumir (completo) los saldos de la bolsa que financian esta rendición directa.
    if (hasSaldos) {
      await this.saldoService.consume(saldoIds, {
        userId: createExpenseReportDto.userId,
        clientId: createExpenseReportDto.clientId,
        context: 'rendicion_directa',
        reportId: String(savedReport._id),
      })

      // Las rendiciones que originaron los remanentes consumidos quedan resueltas
      // ("saldo trasladado a esta nueva rendición") → se muestran como cerradas.
      const sourceReportIds =
        await this.saldoService.getSourceReportIds(saldoIds)
      for (const srcId of sourceReportIds) {
        await this.expenseReportModel
          .findByIdAndUpdate(srcId, {
            pendingBalanceUsedInRendicionId: savedReport._id,
          })
          .exec()
      }
    }

    // Si se creó desde saldo de otra rendición directa, marcar la rendición fuente
    if (createExpenseReportDto.pendingBalanceFromReportId) {
      await this.expenseReportModel
        .findByIdAndUpdate(createExpenseReportDto.pendingBalanceFromReportId, {
          pendingBalanceUsedInRendicionId: savedReport._id,
        })
        .exec()

      // Si la rendición fuente había dejado su sobrante en la bolsa, consumirlo: el
      // dinero se trasladó al presupuesto de esta nueva rendición. Evita el doble
      // conteo (el saldo seguía mostrándose como disponible).
      try {
        await this.saldoService.removeRemnantBySourceReport(
          createExpenseReportDto.pendingBalanceFromReportId,
          String(savedReport._id)
        )
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(
          `Consumir remanente de bolsa al heredar saldo de ${createExpenseReportDto.pendingBalanceFromReportId}: ${msg}`
        )
      }
    }

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
    const report = await this.create(
      {
        isDirecta: true,
        userId: dto.userId,
        clientId,
        gestion: dto.gestion,
        budget: dto.amount,
      } as CreateExpenseReportDto,
      createdBy,
      false // no es flujo de colaborador → no notifica admins
    )

    report.directaDeposit = {
      amount: dto.amount,
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
    const report = new this.expenseReportModel({
      title,
      userId: advance.userId,
      clientId: advance.clientId,
      createdBy: advance.userId,
      projectId: advance.projectId ?? undefined,
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
      .sort({ createdAt: -1 })
      .exec()
  }

  async findAllByCoordinator(coordinatorId: string, clientId: string) {
    const userIds = await this.userService.findUserIdsByCoordinator(
      coordinatorId,
      clientId
    )
    return await this.expenseReportModel
      .find({
        userId: { $in: userIds },
        clientId: new Types.ObjectId(clientId),
        isCajaChica: { $ne: true },
      })
      .populate('userId', 'name email signature bankAccount')
      .populate('createdBy', 'name email')
      // Nombre de categoría por línea de viático (para el detalle al aprobar).
      .populate('viaticoLines.categoryId', 'name')
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
      .populate('expenseIds', 'total approvalCoord approvalCont')
      .populate('createdBy', 'name email')
      .populate('viaticoLines.categoryId', 'name')
      .populate('projectId', 'code name')
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
        'total expenseType fechaEmision proveedor approvalCoord approvalCont'
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
      (e: any) =>
        e?.approvalCoord?.status === 'approved' ||
        e?.approvalCont?.status === 'approved'
    )
    // `createdByOther`: la solicitud la creó alguien distinto del dueño (ej.
    // Contabilidad creó una rendición directa para el colaborador). En ese caso
    // el dueño no puede eliminarla; el front oculta el botón.
    const createdById = String(report.createdBy?._id ?? report.createdBy ?? '')
    const ownerId = String(report.userId?._id ?? report.userId ?? '')
    const createdByOther = !!createdById && !!ownerId && createdById !== ownerId
    // `inheritedBalance`: la rendición directa se creó con saldo heredado de otra.
    // El dueño no puede eliminarla (rompería la cadena del saldo); solo Contabilidad.
    const inheritedBalance = !!report.pendingBalanceFromReportId
    return { ...report, hasApprovedExpense, createdByOther, inheritedBalance }
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
      filter['expenseType'] =
        opts.type === 'comprobante_caja'
          ? { $in: ['comprobante_caja', 'recibo_caja'] }
          : opts.type
    }
    if (opts.status && opts.status !== 'all') {
      // El filtro se basa en la aprobación dual (approvalCont / approvalCoord),
      // que es lo que la UI muestra como badge. Si un comprobante legacy no
      // tiene aprobación dual, la UI lo muestra como "Pendiente" por defecto,
      // por lo que el campo legacy `status` se ignora aquí para mantener
      // coherencia visual.
      if (opts.status === 'approved') {
        filter['approvalCont.status'] = 'approved'
        filter['approvalCoord.status'] = 'approved'
      } else if (opts.status === 'rejected') {
        and.push({
          $or: [
            { 'approvalCont.status': 'rejected' },
            { 'approvalCoord.status': 'rejected' },
          ],
        })
      } else if (opts.status === 'pending') {
        filter['$nor'] = [
          {
            'approvalCont.status': 'approved',
            'approvalCoord.status': 'approved',
          },
          { 'approvalCont.status': 'rejected' },
          { 'approvalCoord.status': 'rejected' },
        ]
      } else {
        filter['status'] = opts.status
      }
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
      .populate('userId', 'name email signature bankAccount dni')
      .populate({
        path: 'expenseIds',
        populate: [
          { path: 'categoryId', select: 'name' },
          { path: 'proyectId', select: 'name' },
        ],
      })
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('projectId', 'name')
      .populate({
        path: 'saldoIds',
        select: 'type amount concepto deposit sourceReportId createdAt',
        populate: { path: 'sourceReportId', select: 'codigo title gestion' },
      })
      .exec()

    if (!report) {
      throw new NotFoundException(`Expense report with ID ${id} not found`)
    }
    // Auto-sanado (lazy, idempotente): directa financiada con bolsa ya aprobada cuyo
    // sobrante aún no se reflejó en la bolsa (aprobadas antes de esta funcionalidad).
    // Se corrige sola al abrir el detalle, una rendición a la vez, sin barrido global.
    await this.ensureDirectaBolsaRemnant(id, report).catch(() => undefined)
    // Auto-sanado (lazy): si el remanente de esta rendición ya fue consumido por otra
    // pero la fuente no quedó marcada como "trasladada", se corrige al abrirla.
    await this.ensureSourceMarkedIfRemnantConsumed(id, report).catch(() => undefined)
    const normalized = this.normalizeReportExpenseDates(report)
      // Flag derivado para el front: si la caja chica fue finalizada, el
      // colaborador ya no puede subir gastos (botón "Añadir Gasto" oculto).
      ; (
        normalized as unknown as { lockedByCajaChica?: boolean }
      ).lockedByCajaChica =
        (normalized as unknown as { isCajaChica?: boolean }).isCajaChica === true
          ? await this.isLockedByFinalizedCajaChica(id)
          : false
    // Código de la rendición de origen del saldo heredado, para mostrar en el detalle
    // y el reporte "de qué rendición proviene el saldo" (en vez de un genérico).
    const fromId = (report as unknown as { pendingBalanceFromReportId?: unknown })
      .pendingBalanceFromReportId
    if (fromId) {
      const src = await this.expenseReportModel
        .findById(String(fromId))
        .select('codigo')
        .lean()
        .exec()
        ; (
          normalized as unknown as { pendingBalanceFromCodigo?: string }
        ).pendingBalanceFromCodigo = (src as { codigo?: string } | null)?.codigo
    }
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

  async update(id: string, updateExpenseReportDto: UpdateExpenseReportDto) {
    const dto = updateExpenseReportDto
    const existing = await this.expenseReportModel
      .findById(id)
      .select('status isDirecta type')
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

    // Rendición directa: al enviar (submitted), auto-transicionar a pending_accounting
    if (dto.status !== undefined) {
      if (dto.status === 'submitted' && isDirecta) {
        $set.status = 'pending_accounting'
      } else {
        $set.status = dto.status
      }
    }
    if (dto.userId !== undefined) $set.userId = new Types.ObjectId(dto.userId)
    if (dto.clientId !== undefined)
      $set.clientId = new Types.ObjectId(dto.clientId)
    if (dto.projectId !== undefined) {
      $set.projectId = dto.projectId ? new Types.ObjectId(dto.projectId) : null
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
    // No aplica a rendiciones directas (ellas llegan aquí desde submitted automáticamente)
    if (dto.status === 'pending_accounting' && !isDirecta) {
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

    // Contabilidad aprueba la rendición (→ approved): notificar colaborador
    // En rendición directa: solo colaborador. En flujo normal: colaborador + coordinador.
    if (dto.status === 'approved') {
      console.log(`[APROBACIÓN RENDICIÓN] Entrando al bloque approved para rendición ${id}`)
      const owner = fullyUpdatedReport.userId as any
      const ownerId = owner?._id ? String(owner._id) : String(owner)

      // Directa financiada con la bolsa: el sobrante regresa a la bolsa del colaborador.
      await this.settleDirectaFinanciadaConBolsa(id, fullyUpdatedReport, ownerId)

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
        console.log(`[TESORESRÍA RENDICIÓN] Buscando emails para clientId=${clientIdStr}`)
        const tesoreriaEmails = await this.clientService.getTesoreriaEmails(clientIdStr)
        console.log(`[TESORERÍA RENDICIÓN] Emails configurados: ${JSON.stringify(tesoreriaEmails)}`)
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
          // Rendición directa: salta coordinador. Va directo a Contabilidad.
          await this.notificationsService.create({
            userId: ownerId2,
            title: 'Rendición enviada a Contabilidad',
            message: `Tu rendición "${fullyUpdatedReport.title}" fue enviada directamente a contabilidad para su revisión.`,
            type: 'info',
            actionUrl: `/mis-rendiciones/${id}/detalle`,
          })

          const sentEmails = new Set<string>()
          if (ownerEmailKey) sentEmails.add(ownerEmailKey)

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

          const accountingUsers =
            await this.userService.findAccountingRecipientsWithIds(clientId)
          for (const u of accountingUsers) {
            if (u._id === ownerId2) continue
            await this.notificationsService.create({
              userId: u._id,
              title: 'Nueva Rendición para Revisar',
              message: `${creatorName} ha enviado la rendición directa "${fullyUpdatedReport.title}" para tu revisión.`,
              type: 'warning',
              actionUrl: `/mis-rendiciones/${id}/detalle`,
            })
          }
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

    const role = actor?.role ?? ''
    const isSuperAdmin = role === ROLES.SUPER_ADMIN
    const isContabilidad = role === ROLES.CONTABILIDAD
    const isColaborador = role === ROLES.COLABORADOR

    // Carga los comprobantes adjuntos para evaluar el estado de aprobación.
    const expenseIds = report.expenseIds ?? []
    const expenses = expenseIds.length
      ? await this.expenseModel
        .find({ _id: { $in: expenseIds } })
        .select('_id file approvalCoord approvalCont')
        .lean()
        .exec()
      : []

    // "Aprobado por alguien" = aprobación a nivel comprobante O a nivel reporte.
    const reportLevelApproved =
      !!report.coordinatorApprovedBy || !!report.contabilidadApprovedBy
    const anyExpenseApproved = expenses.some(
      e =>
        e.approvalCoord?.status === 'approved' ||
        e.approvalCont?.status === 'approved'
    )

    // Condiciones que restringen el borrado a solo Contabilidad/Superadmin (el
    // colaborador/coordinador dueño ya no puede eliminar).
    let restricted = reportLevelApproved || anyExpenseApproved
    let restrictedMsg =
      'Esta solicitud ya tiene una aprobación; solo Contabilidad puede eliminarla.'

    // Rendición directa creada por Contabilidad para el colaborador/coordinador
    // (createdBy distinto del dueño), o creada con saldo heredado de otra
    // rendición (borrarla rompería la cadena del saldo): solo Contabilidad.
    if (!restricted && report.isDirecta) {
      const createdById = String(report.createdBy ?? '')
      const ownerId = String(report.userId ?? '')
      if (createdById && ownerId && createdById !== ownerId) {
        restricted = true
        restrictedMsg =
          'Esta rendición directa fue creada por Contabilidad; solo Contabilidad puede eliminarla.'
      } else if (report.pendingBalanceFromReportId && expenses.length > 0) {
        // Saldo heredado CON gastos ya cargados: borrarla rompería la cadena del
        // saldo, solo Contabilidad. Si aún NO se subió ningún gasto, el dueño
        // puede eliminarla: el borrado restaura el saldo a la bolsa
        // (restoreByConsumer) y libera la rendición de origen
        // (unmarkPendingBalanceUsed), volviendo todo al estado anterior.
        restricted = true
        restrictedMsg =
          'Esta rendición directa se creó con saldo heredado de otra rendición; solo Contabilidad puede eliminarla.'
      }
    }

    // Caja chica ya incluida (jalada) por Contabilidad en un reporte —borrador o
    // finalizado—: solo Contabilidad puede eliminarla.
    if (!restricted && report.isCajaChica) {
      if (await this.isReferencedByCajaChica(id)) {
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
    if (!report.isDirecta && !report.isCajaChica) {
      const rawAdvanceIds: string[] = (
        Array.isArray(report.advanceIds) ? report.advanceIds : []
      ).map((x: any) => (x && typeof x === 'object' && '_id' in x ? String(x._id) : String(x)))
      const linked = await this.advanceService.findByExpenseReportId(id, rawAdvanceIds)
      const hasApprovedAdvance = linked.some((a: any) =>
        ['approved', 'partially_paid', 'paid', 'settled'].includes(a.status)
      )
      if (hasApprovedAdvance && !isSuperAdmin) {
        throw new ForbiddenException(
          'El anticipo de esta rendición ya fue aprobado/pagado; la rendición no puede eliminarse.'
        )
      }
    }

    if (restricted) {
      if (!isContabilidad && !isSuperAdmin) {
        throw new ForbiddenException(restrictedMsg)
      }
    } else if (isColaborador) {
      // Estados iniciales: el colaborador solo puede eliminar las suyas.
      const ownerId = String(report.createdBy ?? report.userId ?? '')
      if (ownerId !== String(actor.userId)) {
        throw new ForbiddenException(
          'Solo puedes eliminar tus propias solicitudes.'
        )
      }
    }

    // Cascada: elimina los comprobantes adjuntos y sus archivos en S3.
    if (expenses.length > 0) {
      for (const e of expenses) {
        await this.tryDeleteS3File(e.file)
      }
      await this.expenseModel.deleteMany({ _id: { $in: expenseIds } }).exec()
    }

    // Devolver a la bolsa los saldos que esta rendición había consumido (si los
    // hubo), para que el colaborador no los pierda al eliminarla. Si devolvió un
    // "vuelto" (saldo > total), se neutraliza primero para no contarlo dos veces.
    try {
      await this.saldoService.removeViaticoChangeByReport(id)
      await this.saldoService.restoreByConsumer({ reportId: id })
      // Saldo heredado: libera la rendición de origen para que su saldo vuelva a estar
      // disponible (en el caso típico no dejó remanente en la bolsa que restaurar).
      if (report.pendingBalanceFromReportId) {
        await this.unmarkPendingBalanceUsed(String(report.pendingBalanceFromReportId), id)
      }
    } catch (err: unknown) {
      this.logger.error(
        `Revertir saldos al eliminar ${id}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    await this.expenseReportModel.findByIdAndDelete(id).exec()
    return report
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
        '_id codigo userId title motivo gestion budget status createdAt createdBy directaDeposit expenseIds pendingBalanceFromReportId pendingBalanceAmount saldoIds pendingBalanceUsedInRendicionId pendingBalanceUsedInAdvanceId returnVoucher'
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
      // Rendición directa creada desde el saldo de otra (saldo heredado): no tiene
      // `directaDeposit`, pero su presupuesto disponible es el saldo trasladado.
      const hasInheritedBalance =
        !!r.pendingBalanceFromReportId &&
        Number(r.pendingBalanceAmount ?? 0) > 0
      // Rendición directa financiada con saldos de la bolsa: su presupuesto disponible
      // es el `budget` (suma de los saldos consumidos).
      const hasSaldoFinancing =
        Array.isArray(r.saldoIds) && r.saldoIds.length > 0
      const deposited = Number(
        r.directaDeposit?.amount ?? r.pendingBalanceAmount ?? r.budget ?? 0
      )
      const hasFunds =
        !!r.directaDeposit || hasInheritedBalance || hasSaldoFinancing
      return {
        _id: String(r._id),
        codigo: r.codigo ?? null,
        userId: r.userId,
        title: r.title ?? null,
        motivo: r.motivo ?? null,
        status: r.status ?? null,
        // Cerrada (a efectos de label): saldo trasladado a otra rendición/anticipo o devuelto.
        effectivelyClosed:
          r.status === 'closed' ||
          !!r.pendingBalanceUsedInRendicionId ||
          !!r.pendingBalanceUsedInAdvanceId ||
          !!r.returnVoucher,
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
      .select('status')
      .lean()
      .exec()

    const updateOp: Record<string, unknown> = {
      $push: { expenseIds: new Types.ObjectId(expenseId) },
    }
    if ((existing as any)?.status === 'rejected') {
      updateOp.$set = { status: 'submitted' }
      updateOp.$unset = { rejectionReason: '', rejectedByRole: '' }
    }

    return await this.expenseReportModel
      .findByIdAndUpdate(reportId, updateOp, { new: true })
      .exec()
  }

  /** Cambia silenciosamente el estado de una rendición rechazada a enviada, sin notificaciones. */
  async resubmitSilent(reportId: string): Promise<void> {
    const existing = await this.expenseReportModel
      .findById(reportId)
      .select('status')
      .lean()
      .exec()
    if (!existing || (existing as any).status !== 'rejected') return
    await this.expenseReportModel
      .findByIdAndUpdate(reportId, {
        $set: { status: 'submitted' },
        $unset: { rejectionReason: '', rejectedByRole: '' },
      })
      .exec()
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

  async markPendingBalanceUsed(reportId: string, advanceId: string) {
    return await this.expenseReportModel
      .findByIdAndUpdate(
        reportId,
        {
          $set: {
            pendingBalanceUsedInAdvanceId: new Types.ObjectId(advanceId),
          },
        },
        { new: true }
      )
      .exec()
  }

  /**
   * Revierte la marca de "saldo trasladado" en la rendición de origen cuando el
   * documento que heredó su saldo (viático/anticipo) se rechaza, cancela o elimina, de
   * modo que ese saldo vuelva a estar disponible para reutilizarse. Solo actúa si la
   * marca apunta a ese mismo documento consumidor (no pisa un traslado posterior).
   */
  async unmarkPendingBalanceUsed(sourceReportId: string, consumerId: string) {
    const consumer = new Types.ObjectId(consumerId)
    return await this.expenseReportModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(sourceReportId),
          $or: [
            { pendingBalanceUsedInAdvanceId: consumer },
            { pendingBalanceUsedInRendicionId: consumer },
          ],
        },
        {
          $unset: {
            pendingBalanceUsedInAdvanceId: '',
            pendingBalanceUsedInRendicionId: '',
          },
        },
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
   * contabilidad, saldo heredado de otra rendición, o financiamiento con la bolsa
   * de saldos (`saldoIds` → presupuesto). Base para calcular devolución vs reembolso.
   */
  private directaFundsGiven(report: any): number {
    const deposit = Number(report?.directaDeposit?.amount ?? 0)
    if (deposit > 0) return deposit
    const inherited = Number(report?.pendingBalanceAmount ?? 0)
    if (report?.pendingBalanceFromReportId && inherited > 0) return inherited
    if (Array.isArray(report?.saldoIds) && report.saldoIds.length > 0) {
      return Number(report?.budget ?? 0)
    }
    return 0
  }

  /**
   * Al aprobar una rendición directa financiada con la bolsa de saldos, el
   * sobrante (presupuesto − gastado) regresa automáticamente a la bolsa del
   * colaborador como saldo remanente (`rendicion_directa`). Si luego decide
   * devolverlo a contabilidad, ese remanente se descuenta. Idempotente por rendición.
   */
  private async settleDirectaFinanciadaConBolsa(
    reportId: string,
    report: any,
    ownerId: string
  ): Promise<void> {
    // El sobrante regresa a la bolsa cuando los fondos venían del propio colaborador:
    // saldos de la bolsa (saldoIds) o saldo heredado de otra rendición
    // (pendingBalanceFromReportId). Las directas con depósito de contabilidad
    // mantienen su flujo de devolución y no entran aquí.
    const hasBolsa = Array.isArray(report?.saldoIds) && report.saldoIds.length > 0
    const hasInherited =
      !!report?.pendingBalanceFromReportId &&
      Number(report?.pendingBalanceAmount ?? 0) > 0
    if (!report?.isDirecta || (!hasBolsa && !hasInherited)) {
      return
    }
    // El sobrante no debe (re)publicarse en la bolsa si ya tuvo otro destino:
    // - trasladado a otra rendición/anticipo (pendingBalanceUsedIn*): ya está
    //   representado como presupuesto de la rendición destino.
    // - devuelto a contabilidad (returnVoucher): el dinero regresó a la empresa,
    //   no puede seguir en la bolsa del colaborador.
    // En ambos casos, evita el doble conteo.
    if (
      report?.pendingBalanceUsedInRendicionId ||
      report?.pendingBalanceUsedInAdvanceId ||
      report?.returnVoucher
    ) {
      return
    }
    const budget = Number(report?.budget ?? 0)
    const populated = await this.expenseReportModel
      .findById(reportId)
      .populate('expenseIds', 'total')
      .lean()
      .exec()
    const gastado = (((populated as any)?.expenseIds as any[]) ?? []).reduce(
      (s, e) => s + (Number(e?.total) || 0),
      0
    )
    const difference = budget - gastado
    if (Math.abs(difference) >= 0.01) {
      await this.updateSettlement(reportId, {
        advanceTotal: budget,
        expenseTotal: gastado,
        difference,
        type: difference > 0 ? 'devolucion' : 'reembolso',
        settledAt: new Date(),
        // El sobrante quedó disponible en la bolsa (no exige comprobante para cerrar).
        toBolsa: difference > 0,
      })
    }
    if (difference > 0.01) {
      try {
        await this.saldoService.createFromRemnant({
          userId: ownerId,
          clientId: report.clientId,
          projectId: report?.projectId ?? null,
          sourceReportId: reportId,
          amount: difference,
          type: 'rendicion_directa',
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(`Remanente directa-bolsa ${reportId}: ${msg}`)
      }
    }
  }

  /**
   * Garantiza (perezosamente, al abrir el detalle) que una directa financiada con
   * bolsa ya aprobada con sobrante tenga su remanente en la bolsa. Solo actúa si aún
   * no fue liquidada (`!settlement`) y hay sobrante; idempotente y no bloqueante.
   */
  private async ensureDirectaBolsaRemnant(
    reportId: string,
    report: any
  ): Promise<void> {
    const status = report?.status
    const hasBolsa = Array.isArray(report?.saldoIds) && report.saldoIds.length > 0
    const hasInherited =
      !!report?.pendingBalanceFromReportId &&
      Number(report?.pendingBalanceAmount ?? 0) > 0
    if (
      !report?.isDirecta ||
      (!hasBolsa && !hasInherited) ||
      (status !== 'approved' && status !== 'closed') ||
      report?.settlement
    ) {
      return
    }
    const budget = Number(report?.budget ?? 0)
    const gastado = ((report?.expenseIds as any[]) ?? []).reduce(
      (s, e) => s + (Number(e?.total) || 0),
      0
    )
    if (budget - gastado <= 0.01) return
    const owner = report.userId
    const ownerId = owner?._id ? String(owner._id) : String(owner)
    await this.settleDirectaFinanciadaConBolsa(reportId, report, ownerId)
  }

  /**
   * Si el remanente que originó esta rendición directa ya fue consumido por otra
   * (financiándola con la bolsa) pero la fuente no quedó marcada como "trasladada",
   * la marca al abrir el detalle. Idempotente y no bloqueante.
   */
  private async ensureSourceMarkedIfRemnantConsumed(
    reportId: string,
    report: any
  ): Promise<void> {
    if (!report?.isDirecta || report?.pendingBalanceUsedInRendicionId) return
    const consumer = await this.saldoService.findRemnantConsumer(reportId)
    if (!consumer) return
    await this.expenseReportModel
      .findByIdAndUpdate(reportId, {
        pendingBalanceUsedInRendicionId: new Types.ObjectId(consumer),
      })
      .exec()
    report.pendingBalanceUsedInRendicionId = new Types.ObjectId(consumer)
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

  async findPendingReimbursementsByClient(clientId: string) {
    return this.expenseReportModel
      .find({
        clientId: new Types.ObjectId(clientId),
        status: 'approved',
        'settlement.type': 'reembolso',
        $or: [
          { reimbursementPaymentInfo: { $exists: false } },
          { reimbursementPaymentInfo: null },
        ],
      })
      .populate('userId', 'name email bankAccount')
      .sort({ updatedAt: -1 })
      .lean()
      .exec()
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
    tenantCtx?: { requestClientId: string; isSuperAdmin: boolean }
  ) {
    // El reembolso lo registra Tesorería (Contabilidad/SuperAdmin o delegado
    // con L2). El Coordinador queda excluido aunque tenga canApproveL2 o el
    // RolesGuard lo aliase a Administrador: por rol no participa en el pago.
    const canPay =
      userRole !== ROLES.COORDINADOR &&
      (userRole === ROLES.SUPER_ADMIN || userPermissions?.canApproveL2 === true)
    if (!canPay) {
      throw new ForbiddenException(
        'No tienes permiso para registrar pagos de reembolso.'
      )
    }

    if (dto.method !== 'efectivo' && !dto.paymentReceiptUrl) {
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
      .populate('userId', 'name email signature bankAccount dni')
      .populate({
        path: 'expenseIds',
        populate: [
          { path: 'categoryId', select: 'name' },
          { path: 'proyectId', select: 'name' },
        ],
      })
      .populate('advanceIds')
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('projectId', 'name')
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

    // Si el sobrante había quedado en la bolsa (directa financiada con saldo) y el
    // colaborador decide devolverlo a contabilidad, se descuenta de la bolsa.
    try {
      await this.saldoService.removeRemnantBySourceReport(id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`Descontar remanente al devolver ${id}: ${msg}`)
    }

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
    dto: { place: string; startDate: string; endDate: string; projectId: string; lines: CreateAdvanceLineDto[]; observations?: string; amount: number },
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

    const lineDocs: { categoryId: Types.ObjectId; detalle?: string; importe: number; peopleCount: number; glpPerDay: number; days: number; lineTotal: number }[] = []
    let sum = 0
    for (const line of dto.lines) {
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

    const roundedSum = Math.round(sum * 100) / 100
    if (Math.abs(roundedSum - dto.amount) > 0.02) {
      throw new BadRequestException(`El monto total (S/ ${dto.amount}) debe coincidir con la suma de líneas (S/ ${roundedSum}).`)
    }

    const startFmt = this.emailService.formatDateDDMMYYYY(dto.startDate as any)
    const endFmt = this.emailService.formatDateDDMMYYYY(dto.endDate as any)
    const description = dto.observations?.trim()
      ? `Viático: ${dto.place.trim()} (${startFmt} → ${endFmt}) | ${dto.observations.trim()}`
      : `Viático: ${dto.place.trim()} (${startFmt} → ${endFmt})`

    return { lineDocs, roundedSum, description, requiredLevels: roundedSum > ADVANCE_THRESHOLDS.L1_MAX ? 2 : 1 }
  }

  async createViatico(dto: CreateViaticoExpenseReportDto, userId: string, clientId: string): Promise<ExpenseReportDocument> {
    const profile = await this.userService.findTransactionalProfile(userId)
    if (!profile?.signature?.trim()) {
      throw new ForbiddenException('Debe registrar su firma digital en el perfil antes de solicitar viáticos.')
    }

    const pendingAmt = Number(dto.pendingBalanceAmount ?? 0)

    // `dto.amount` es el costo del viático (suma de líneas). El saldo heredado NO se
    // suma al anticipo: prefinancia ese costo igual que un saldo de la bolsa.
    const { lineDocs, roundedSum, description, requiredLevels } = await this.validateViaticoLines(
      { place: dto.place, startDate: dto.startDate, endDate: dto.endDate, projectId: dto.projectId, lines: dto.lines, observations: dto.observations, amount: dto.amount },
      clientId
    )

    const report = await this.expenseReportModel.create({
      type: 'viatico',
      userId: new Types.ObjectId(userId),
      clientId: new Types.ObjectId(clientId),
      createdBy: new Types.ObjectId(userId),
      projectId: new Types.ObjectId(dto.projectId),
      description,
      status: 'pending_l1',
      expenseIds: [],
      budget: roundedSum,
      viaticoAmount: roundedSum,
      viaticoRequiredLevels: requiredLevels,
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
      coordinatorId: profile.coordinatorId ?? undefined,
      ...(pendingAmt > 0 && dto.pendingBalanceFromReportId && {
        pendingBalanceFromReportId: new Types.ObjectId(dto.pendingBalanceFromReportId),
        pendingBalanceAmount: pendingAmt,
      }),
    })

    // Financiamiento con saldo heredado de otra rendición (mismo centro de costo).
    if (pendingAmt > 0 && dto.pendingBalanceFromReportId) {
      await this.applyViaticoPendingFinancing(report, {
        userId,
        clientId,
        projectId: dto.projectId,
        pendingAmt,
        fromReportId: dto.pendingBalanceFromReportId,
      })
      await report.save()
    }

    // Financiamiento con saldos de la bolsa (mismo centro de costo).
    const saldoIds = Array.isArray(dto.saldoIds) ? dto.saldoIds : []
    if (saldoIds.length > 0) {
      await this.applyViaticoSaldoFinancing(report, saldoIds, {
        userId,
        clientId,
        projectId: dto.projectId,
      })
      await report.save()
    }

    void this.notifyViaticoCoordinator(report as ExpenseReportDocument, userId, clientId)

    return this.findOne(String((report as any)._id)) as Promise<ExpenseReportDocument>
  }

  /**
   * Financia un viático con saldos de la bolsa (mismo centro de costo). El saldo
   * prefinancia el anticipo: se registra como ya pagado (`viaticoPaidAmount`), de modo
   * que contabilidad solo deposite la diferencia (viaticoAmount − saldo aplicado).
   *
   * El saldo nunca paga más que el total del viático: si el saldo seleccionado SUPERA
   * el total, solo se usa lo necesario y el sobrante ("vuelto") vuelve de inmediato a
   * la bolsa como saldo disponible del mismo centro de costo. En ese caso contabilidad
   * no deposita nada. `consume` valida dueño, disponibilidad y centro de costo. No
   * persiste el documento (lo hace quien llama).
   */
  private async applyViaticoSaldoFinancing(
    report: ExpenseReportDocument,
    saldoIds: string[],
    opts: { userId: string; clientId: string; projectId: string }
  ): Promise<void> {
    const reportId = String((report as any)._id)
    const saldoTotal = await this.saldoService.consume(saldoIds, {
      userId: opts.userId,
      clientId: opts.clientId,
      context: 'viatico',
      projectId: opts.projectId,
      reportId,
    })
    report.saldoIds = saldoIds.map(sid => new Types.ObjectId(sid))

    const viaticoAmount = Number(report.viaticoAmount ?? 0)
    // El saldo nunca cubre más que el total del viático.
    report.viaticoPaidAmount = Math.round(Math.min(saldoTotal, viaticoAmount) * 100) / 100

    // Sobrante: el saldo seleccionado superó el total → vuelve ya mismo a la bolsa.
    const excess = Math.round((saldoTotal - viaticoAmount) * 100) / 100
    if (excess > 0.01) {
      await this.saldoService.createViaticoChange({
        userId: opts.userId,
        clientId: opts.clientId,
        projectId: opts.projectId,
        changeFromReportId: reportId,
        amount: excess,
      })
    }
  }

  /**
   * Financia un viático con el saldo heredado (`pendingBalance`) de otra rendición del
   * mismo centro de costo. Funciona igual que el financiamiento con saldos de la bolsa:
   * el saldo prefinancia el costo (`viaticoPaidAmount`), de modo que contabilidad solo
   * deposite la diferencia (viaticoAmount − saldo aplicado). Si el saldo heredado SUPERA
   * el costo del viático, solo se usa lo necesario y el sobrante vuelve de inmediato a la
   * bolsa como saldo disponible del mismo centro de costo (contabilidad no deposita nada).
   * Marca la rendición de origen como trasladada y consume su remanente en la bolsa (si
   * lo dejó) para evitar el doble conteo del mismo dinero. No persiste el documento.
   */
  private async applyViaticoPendingFinancing(
    report: ExpenseReportDocument,
    opts: {
      userId: string
      clientId: string
      projectId: string
      pendingAmt: number
      fromReportId: string
    }
  ): Promise<void> {
    const reportId = String((report as any)._id)
    const viaticoAmount = Number(report.viaticoAmount ?? 0)

    // El saldo heredado nunca cubre más que el costo del viático.
    report.viaticoPaidAmount =
      Math.round(Math.min(opts.pendingAmt, viaticoAmount) * 100) / 100

    // Marca la rendición de origen como "saldo trasladado" y consume el remanente que
    // hubiera dejado en la bolsa, para que ese dinero no se cuente dos veces.
    await this.markPendingBalanceUsed(opts.fromReportId, reportId)
    try {
      await this.saldoService.removeRemnantBySourceReport(opts.fromReportId, reportId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(
        `Consumir remanente de bolsa al heredar saldo de ${opts.fromReportId}: ${msg}`
      )
    }

    // Sobrante: el saldo heredado superó el costo → vuelve ya mismo a la bolsa.
    const excess = Math.round((opts.pendingAmt - viaticoAmount) * 100) / 100
    if (excess > 0.01) {
      await this.saldoService.createViaticoChange({
        userId: opts.userId,
        clientId: opts.clientId,
        projectId: opts.projectId,
        changeFromReportId: reportId,
        amount: excess,
      })
    }
  }

  private async notifyViaticoCoordinator(report: ExpenseReportDocument, collaboratorUserId: string, clientId: string): Promise<void> {
    const reportId = String((report as any)._id)
    const collaborator = await this.userService.findEmailNameClient(collaboratorUserId)
    const profile = await this.userService.findTransactionalProfile(collaboratorUserId)
    const coordId = profile?.coordinatorId
    if (!coordId) {
      await this.expenseReportModel.updateOne({ _id: (report as any)._id }, { $set: { viaticoCoordinatorNotification: { status: 'skipped', sentAt: new Date(), errorMessage: 'Sin coordinador asignado' } } })
      return
    }
    const coordinator = await this.userService.findEmailNameClient(coordId.toString())
    if (!coordinator || !collaborator) {
      await this.expenseReportModel.updateOne({ _id: (report as any)._id }, { $set: { viaticoCoordinatorNotification: { recipientUserId: coordId, status: 'skipped', sentAt: new Date(), errorMessage: 'Coordinador o colaborador no encontrado' } } })
      return
    }
    if (coordinator.clientId && collaborator.clientId && coordinator.clientId.toString() !== collaborator.clientId.toString()) {
      await this.expenseReportModel.updateOne({ _id: (report as any)._id }, { $set: { viaticoCoordinatorNotification: { recipientUserId: coordId, status: 'skipped', sentAt: new Date(), errorMessage: 'Coordinador de distinta empresa' } } })
      return
    }

    try {
      await this.notificationsService.create({ userId: coordId.toString(), title: 'Nueva solicitud de viáticos pendiente', message: `${collaborator.name} solicitó viáticos — S/ ${this.viaticoFormatMoney(report.viaticoAmount ?? 0)}. Ingresa a Aprobaciones para revisar.`, type: 'info', actionUrl: '/viaticos', metadata: { reportId, collaboratorUserId, event: 'viatico_submitted' } })
    } catch (err: unknown) { this.logger.error(`In-app notif viático ${reportId}: ${err instanceof Error ? err.message : String(err)}`) }

    const coordEmailEnabled = await this.userService.isEmailEnabled(coordId.toString())
    if (!coordEmailEnabled) {
      await this.expenseReportModel.updateOne({ _id: (report as any)._id }, { $set: { viaticoCoordinatorNotification: { recipientUserId: coordId, status: 'skipped', sentAt: new Date(), errorMessage: 'Notificaciones por correo deshabilitadas' } } })
      return
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
        projectLabel, platformUrl: this.emailService.buildAppUrl('/viaticos'),
      })
      await this.expenseReportModel.updateOne({ _id: (report as any)._id }, { $set: { viaticoCoordinatorNotification: { recipientUserId: coordId, status: 'sent', sentAt: new Date() } } })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`Correo coordinador viático ${reportId}: ${msg}`)
      await this.expenseReportModel.updateOne({ _id: (report as any)._id }, { $set: { viaticoCoordinatorNotification: { recipientUserId: coordId, status: 'failed', sentAt: new Date(), errorMessage: msg } } })
    }
  }

  async approveViaticoL1(id: string, opts: { approvedBy: string; notes?: string }, userRole: string, userPermissions?: any): Promise<ExpenseReportDocument> {
    console.log(`[APROBACIÓN VIÁTICO L1] id=${id}, userRole=${userRole}`)
    const report = await this.expenseReportModel.findById(id)
    if (!report) throw new NotFoundException(`Viático ${id} no encontrado`)
    if (report.type !== 'viatico') throw new BadRequestException('Esta rendición no es de tipo viático')
    if (report.status !== 'pending_l1') throw new BadRequestException(`El viático no está en pending_l1 (estado actual: ${report.status})`)

    const canApprove = [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(userRole as ROLES) || userPermissions?.canApproveL1 === true
    if (!canApprove) throw new ForbiddenException('No tienes permiso para aprobar en nivel 1')

    ;(report.viaticoApprovalHistory ?? []).push({ level: 1, approvedBy: opts.approvedBy, action: 'approved', notes: opts.notes, date: new Date() })
    report.viaticoApprovalLevel = 1

    const isSingleLevel = (report.viaticoRequiredLevels ?? 1) === 1
    console.log(`[APROBACIÓN VIÁTICO L1] isSingleLevel=${isSingleLevel}, viaticoAmount=${report.viaticoAmount}`)
    let autoOpenedBySaldo = false
    if (isSingleLevel) {
      report.status = 'viatico_approved'
      await report.save()
      autoOpenedBySaldo = await this.onViaticoFullyApproved(report as ExpenseReportDocument)
    } else {
      report.status = 'pending_l2'
      await report.save()
      this.notificationsService.create({ userId: report.userId.toString(), title: 'Solicitud de viáticos en revisión', message: `Tu solicitud por S/ ${this.viaticoFormatMoney(report.viaticoAmount ?? 0)} fue aprobada en nivel 1 y está pendiente de aprobación final.`, type: 'info', actionUrl: '/mis-rendiciones' }).catch(() => {})
    }

    // Si quedó cubierto 100% con saldo (status 'open'), onViaticoFullyApproved ya
    // notificó al colaborador; evitamos el mensaje genérico de "pago en proceso".
    if (!autoOpenedBySaldo) {
      this.notificationsService.create({ userId: report.userId.toString(), title: isSingleLevel ? 'Solicitud de viáticos aprobada' : 'Solicitud en revisión', message: isSingleLevel ? `Tu solicitud por S/ ${this.viaticoFormatMoney(report.viaticoAmount ?? 0)} fue aprobada. El pago está siendo procesado.` : `Tu solicitud por S/ ${this.viaticoFormatMoney(report.viaticoAmount ?? 0)} fue aprobada en nivel 1.`, type: 'success', actionUrl: '/mis-rendiciones' }).catch(() => {})
    }

    return this.findOne(id) as Promise<ExpenseReportDocument>
  }

  async approveViaticoL2(id: string, opts: { approvedBy: string; notes?: string }, userRole: string, userPermissions?: any): Promise<ExpenseReportDocument> {
    console.log(`[APROBACIÓN VIÁTICO L2] id=${id}, userRole=${userRole}`)
    const report = await this.expenseReportModel.findById(id)
    if (!report) throw new NotFoundException(`Viático ${id} no encontrado`)
    if (report.type !== 'viatico') throw new BadRequestException('Esta rendición no es de tipo viático')
    if (report.status !== 'pending_l2') throw new BadRequestException(`El viático no está en pending_l2 (estado actual: ${report.status})`)

    const canApprove = userRole === ROLES.SUPER_ADMIN || userPermissions?.canApproveL2 === true
    if (!canApprove) throw new ForbiddenException('No tienes permiso para aprobar en nivel 2')

    ;(report.viaticoApprovalHistory ?? []).push({ level: 2, approvedBy: opts.approvedBy, action: 'approved', notes: opts.notes, date: new Date() })
    report.viaticoApprovalLevel = 2
    report.status = 'viatico_approved'
    await report.save()

    const autoOpenedBySaldo = await this.onViaticoFullyApproved(report as ExpenseReportDocument)
    // Si quedó cubierto 100% con saldo (status 'open'), onViaticoFullyApproved ya
    // notificó al colaborador; evitamos el mensaje genérico de "pago en proceso".
    if (!autoOpenedBySaldo) {
      this.notificationsService.create({ userId: report.userId.toString(), title: 'Solicitud de viáticos aprobada', message: `Tu solicitud por S/ ${this.viaticoFormatMoney(report.viaticoAmount ?? 0)} fue aprobada. El pago está siendo procesado.`, type: 'success', actionUrl: '/mis-rendiciones' }).catch(() => {})
    }

    return this.findOne(id) as Promise<ExpenseReportDocument>
  }

  /** Devuelve `true` si el viático quedó cubierto 100% con saldo y se abrió sin pago. */
  private async onViaticoFullyApproved(report: ExpenseReportDocument): Promise<boolean> {
    // Viático cubierto 100% con saldo de la bolsa: no hay desembolso de contabilidad
    // (la diferencia es 0). No pasa por tesorería: se abre directamente para que el
    // colaborador registre sus gastos, igual que tras un pago totalmente liquidado.
    const fullyFundedBySaldo =
      Array.isArray(report.saldoIds) &&
      report.saldoIds.length > 0 &&
      Number(report.viaticoPaidAmount ?? 0) >= Number(report.viaticoAmount ?? 0) - 0.01
    if (fullyFundedBySaldo) {
      await this.expenseReportModel.updateOne(
        { _id: (report as any)._id },
        { $set: { status: 'open' } }
      )
      report.status = 'open'
      this.notificationsService.create({
        userId: report.userId.toString(),
        title: 'Viático aprobado y cubierto con tu saldo',
        message: `Tu viático por S/ ${this.viaticoFormatMoney(report.viaticoAmount ?? 0)} fue aprobado y quedó cubierto con tu saldo. Contabilidad no realiza ningún depósito. Ya puedes registrar tus gastos.`,
        type: 'success',
        actionUrl: `/mis-rendiciones/${String((report as any)._id)}/detalle`,
      }).catch(() => {})
      return true
    }

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
          detailBody: `<p>Viático por S/ ${this.viaticoEscapeHtml(this.viaticoFormatMoney(report.viaticoAmount ?? 0))} de ${this.viaticoEscapeHtml(collaborator?.name ?? '')} aprobado y listo para pago.</p>`,
          projectLabel: '', platformUrl: this.emailService.buildAppUrl('/tesoreria'),
        }).catch(() => {})
      }
    } catch (err: unknown) { this.logger.error(`Notificación contabilidad viático ${(report as any)._id}: ${err instanceof Error ? err.message : String(err)}`) }

    // Notificar a tesorería con datos de pago del colaborador
    try {
      const reportId = String((report as any)._id)
      const clientIdStr = report.clientId.toString()
      console.log(`[TESORERÍA VIÁTICO] Buscando emails para clientId=${clientIdStr}, reportId=${reportId}`)
      const tesoreriaEmails = await this.clientService.getTesoreriaEmails(clientIdStr)
      console.log(`[TESORERÍA VIÁTICO] Emails configurados: ${JSON.stringify(tesoreriaEmails)}`)
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

  async rejectViatico(id: string, opts: { rejectedBy: string; rejectionReason: string }, userRole: string, userPermissions?: any): Promise<ExpenseReportDocument> {
    const report = await this.expenseReportModel.findById(id)
    if (!report) throw new NotFoundException(`Viático ${id} no encontrado`)
    if (report.type !== 'viatico') throw new BadRequestException('Esta rendición no es de tipo viático')
    if (!['pending_l1', 'pending_l2'].includes(report.status)) throw new BadRequestException(`No se puede rechazar en estado "${report.status}"`)

    const canReject = [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(userRole as ROLES) || userPermissions?.canApproveL1 === true || userPermissions?.canApproveL2 === true
    if (!canReject) throw new ForbiddenException('No tienes permiso para rechazar viáticos')

    if ((opts.rejectionReason?.trim() ?? '').length < 10) throw new BadRequestException('El motivo de rechazo debe tener al menos 10 caracteres.')

    ;(report.viaticoApprovalHistory ?? []).push({ level: report.status === 'pending_l2' ? 2 : 1, approvedBy: opts.rejectedBy, action: 'rejected', notes: opts.rejectionReason, date: new Date() })
    report.status = 'rejected'
    report.viaticoRejectedBy = opts.rejectedBy
    report.viaticoRejectionReason = opts.rejectionReason
    await this.revertViaticoSaldoFinancing(report)
    await report.save()

    this.notificationsService.create({ userId: report.userId.toString(), title: 'Solicitud de viáticos rechazada', message: `Tu solicitud por S/ ${this.viaticoFormatMoney(report.viaticoAmount ?? 0)} fue rechazada. Motivo: ${opts.rejectionReason}`, type: 'error', actionUrl: '/mis-rendiciones' }).catch(() => {})

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

  async resubmitViatico(id: string, dto: ResubmitViaticoDto, actingUserId: string, clientId: string): Promise<ExpenseReportDocument> {
    const report = await this.expenseReportModel.findById(id)
    if (!report) throw new NotFoundException(`Viático ${id} no encontrado`)
    if (report.type !== 'viatico') throw new BadRequestException('Esta rendición no es de tipo viático')
    if (!['rejected', 'pending_l1'].includes(report.status)) throw new BadRequestException('Solo pueden reenviarse solicitudes rechazadas o pendientes de aprobación.')
    if (report.userId.toString() !== actingUserId) throw new ForbiddenException('Solo el colaborador solicitante puede corregir y reenviar esta solicitud.')
    if (report.clientId.toString() !== clientId) throw new ForbiddenException('La solicitud no pertenece a su organización.')

    const profile = await this.userService.findTransactionalProfile(actingUserId)
    if (!profile?.signature?.trim()) throw new ForbiddenException('Debe registrar su firma digital en el perfil antes de reenviar viáticos.')

    const { lineDocs, roundedSum, description, requiredLevels } = await this.validateViaticoLines(
      { place: dto.place, startDate: dto.startDate, endDate: dto.endDate, projectId: dto.projectId, lines: dto.lines, observations: dto.observations, amount: dto.amount },
      clientId
    )

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
    report.viaticoAmount = roundedSum
    report.budget = roundedSum
    // Re-aplicar saldo de la bolsa si la corrección lo selecciona y el viático no
    // tiene ya uno aplicado (caso típico: fue rechazado y su saldo se devolvió a la
    // bolsa). Si ya tenía saldo (edición antes de aprobación), se conserva intacto.
    const alreadyHasSaldo =
      Array.isArray(report.saldoIds) && report.saldoIds.length > 0
    const reselectedSaldos = Array.isArray(dto.saldoIds) ? dto.saldoIds : []
    if (!alreadyHasSaldo && reselectedSaldos.length > 0) {
      await this.applyViaticoSaldoFinancing(report, reselectedSaldos, {
        userId: actingUserId,
        clientId,
        projectId: dto.projectId,
      })
    }
    // Re-financia el saldo heredado: el costo pudo cambiar en la corrección, así que se
    // recalcula cuánto prefinancia (viaticoPaidAmount) y el sobrante que vuelve a la
    // bolsa. Se neutraliza primero el vuelto anterior para no contarlo dos veces.
    const pendingAmt = Number(report.pendingBalanceAmount ?? 0)
    if (pendingAmt > 0 && report.pendingBalanceFromReportId) {
      await this.saldoService.removeViaticoChangeByReport(id)
      report.viaticoPaidAmount =
        Math.round(Math.min(pendingAmt, roundedSum) * 100) / 100
      const excess = Math.round((pendingAmt - roundedSum) * 100) / 100
      if (excess > 0.01) {
        await this.saldoService.createViaticoChange({
          userId: actingUserId,
          clientId,
          projectId: dto.projectId,
          changeFromReportId: id,
          amount: excess,
        })
      }
    }
    report.description = description
    report.status = 'pending_l1'
    report.viaticoApprovalLevel = 0
    report.viaticoRequiredLevels = requiredLevels
    report.viaticoRejectedBy = undefined
    report.viaticoRejectionReason = undefined
    report.viaticoBudgetCommitmentRecorded = false
    report.viaticoSolicitudVersion = (report.viaticoSolicitudVersion ?? 1) + 1
    ;(report.viaticoApprovalHistory ?? []).push({ level: 0, approvedBy: actingUserId, action: 'resubmitted', notes: wasEditing ? 'Solicitud editada antes de aprobación' : 'Solicitud corregida y reenviada tras rechazo', date: new Date() })
    await report.save()

    void this.notifyViaticoCoordinator(report as ExpenseReportDocument, actingUserId, clientId)

    return this.findOne(id) as Promise<ExpenseReportDocument>
  }

  async registerViaticoPayment(id: string, dto: PayViaticoDto, userRole: string, userPermissions?: any): Promise<ExpenseReportDocument> {
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

    const canPay = [ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD].includes(userRole as ROLES) || userPermissions?.canApproveL2 === true
    if (!canPay) throw new ForbiddenException('No tienes permiso para registrar pagos')

    if (dto.method !== 'efectivo' && !dto.paymentReceiptUrl) throw new BadRequestException('El comprobante es obligatorio para pagos por transferencia o cheque.')
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

    const paymentEmailData = {
      clientId: report.clientId.toString(),
      collaboratorName: collaborator?.name ?? 'Colaborador',
      coordinatorName: coordinator?.name,
      projectLabel,
      amountFormatted: this.viaticoFormatMoney(report.viaticoAmount ?? 0),
      transferDate: new Date(dto.transferDate).toISOString().slice(0, 10),
      reference: dto.reference ?? '—',
      paymentMethod: dto.method,
      paymentReceiptUrl: dto.paymentReceiptUrl ?? '',
      paymentReceiptFileName: dto.paymentReceiptFileName ?? 'comprobante.pdf',
      platformUrl: this.emailService.buildAppUrl('/mis-rendiciones'),
    }

    const fullyPaidMsg = fullyPaid
      ? (inPrePaymentPhase
          ? `Se registró el pago de tu viático por S/ ${this.viaticoFormatMoney(paymentAmount)}. Ya puedes registrar tus gastos.`
          : `Se registró el pago restante de tu viático por S/ ${this.viaticoFormatMoney(paymentAmount)} (total pagado S/ ${this.viaticoFormatMoney(report.viaticoPaidAmount ?? 0)}).`)
      : `Se registró un pago parcial de tu viático por S/ ${this.viaticoFormatMoney(paymentAmount)} (total pagado S/ ${this.viaticoFormatMoney(report.viaticoPaidAmount ?? 0)} de S/ ${this.viaticoFormatMoney(report.viaticoAmount ?? 0)}).`

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
        message: `Se registró el pago del viático de ${collaborator?.name ?? 'un colaborador'} por S/ ${this.viaticoFormatMoney(paymentAmount)}.`,
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
    await this.revertViaticoSaldoFinancing(report)
    await report.save()
    return this.findOne(id) as Promise<ExpenseReportDocument>
  }

  /**
   * Devuelve a la bolsa los saldos que prefinanciaban un viático que ya no
   * continuará (rechazado/cancelado) y limpia su financiamiento, evitando que el
   * colaborador pierda ese saldo. Reject/cancel ocurren antes del pago de
   * contabilidad, por lo que tras restaurar viaticoPaidAmount queda en 0.
   *
   * Si al crear se devolvió un "vuelto" a la bolsa (saldo seleccionado > total), se
   * neutraliza primero para no contarlo dos veces al restaurar los saldos originales.
   */
  private async revertViaticoSaldoFinancing(
    report: ExpenseReportDocument
  ): Promise<void> {
    try {
      const reportId = String((report as any)._id)
      // Neutraliza el vuelto antes de restaurar los saldos completos (evita doble conteo).
      await this.saldoService.removeViaticoChangeByReport(reportId)
      const restored = await this.saldoService.restoreByConsumer({ reportId })
      if (restored > 0) {
        report.viaticoPaidAmount = 0
        report.saldoIds = undefined
      }
      // Saldo heredado de otra rendición: libera la fuente (su saldo vuelve a estar
      // disponible) y resetea el prefinanciamiento. En el caso típico la fuente no dejó
      // remanente en la bolsa, así que `restored` es 0 y hay que limpiarlo explícitamente.
      if (report.pendingBalanceFromReportId) {
        await this.unmarkPendingBalanceUsed(
          String(report.pendingBalanceFromReportId),
          reportId
        )
        report.viaticoPaidAmount = 0
      }
    } catch (err: unknown) {
      this.logger.error(
        `Revertir saldo viático ${(report as any)._id}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  async findViaticos(opts: { requesterId: string; requesterRole: string; requesterPermissions?: any; clientId: string; status?: string; dateFrom?: string; dateTo?: string }) {
    const isAdmin = [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD].includes(opts.requesterRole as ROLES)
    const isApprover = !isAdmin && opts.requesterPermissions?.canApproveL1 === true
    const filter: Record<string, unknown> = { type: 'viatico', clientId: new Types.ObjectId(opts.clientId) }

    if (isApprover) filter['coordinatorId'] = new Types.ObjectId(opts.requesterId)
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

    // Remanente positivo (devolución): el saldo no gastado queda disponible para
    // el colaborador en su bolsa de "Saldo" (tipo `rendicion`, con su centro de costo).
    if (type === 'devolucion' && difference > 0.01) {
      try {
        await this.saldoService.createFromRemnant({
          userId: report.userId,
          clientId: report.clientId,
          projectId: report.projectId ?? null,
          sourceReportId: reportId,
          amount: difference,
          type: 'rendicion',
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(`Crear saldo remanente viático ${reportId}: ${msg}`)
      }
    }

    // Auto-cierre inmediato cuando el viático queda equilibrado.
    // fromClose=true indica que esta llamada viene desde close() — evita recursión.
    if (!fromClose && type === 'equilibrado') {
      await this.close(reportId, 'sistema')
    }
  }
}
