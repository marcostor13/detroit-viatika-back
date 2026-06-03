import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
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
  parseFechaEmisionInput,
  applyFechaEmisionDisplayToExpense,
} from '../expense/utils/fecha-emision.util'
import { EmailService } from '../email/email.service'
import { NotificationsService } from '../notifications/notifications.service'
import { UserService } from '../user/user.service'
import { CreateAffidavitDto } from './dto/create-affidavit.dto'
import { RegisterReimbursementPaymentDto } from './dto/register-reimbursement-payment.dto'
import { AdvanceService } from '../advance/advance.service'
import { ROLES } from '../auth/enums/roles.enum'
import { applyFechaEmisionDisplayToExpenses } from '../expense/utils/fecha-emision.util'

@Injectable()
export class ExpenseReportService {
  constructor(
    @InjectModel(ExpenseReport.name)
    private readonly expenseReportModel: Model<ExpenseReportDocument>,
    @InjectModel(Expense.name)
    private readonly expenseModel: Model<ExpenseDocument>,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
    private readonly userService: UserService,
    @Inject(forwardRef(() => AdvanceService))
    private readonly advanceService: AdvanceService
  ) {}

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
    if (typeof clientId === 'object' && clientId !== null && '_id' in clientId) {
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
    const rawAdvanceIds: string[] = (Array.isArray(report.advanceIds) ? report.advanceIds : []).map(
      (x: any) => (x && typeof x === 'object' && '_id' in x ? String(x._id) : String(x))
    )
    const linkedAdvances = await this.advanceService.findByExpenseReportId(reportId, rawAdvanceIds)
    const total = linkedAdvances
      .filter((a: any) => ['approved', 'paid', 'settled'].includes(a.status))
      .reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0)
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
      throw new NotFoundException(`Expense report with ID ${reportId} not found`)
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
      throw new NotFoundException(`Expense report with ID ${reportId} not found`)
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

  async create(
    createExpenseReportDto: CreateExpenseReportDto,
    createdBy: string,
    isCollaborator = false
  ) {
    const isDirecta = createExpenseReportDto.isDirecta === true
    const title =
      createExpenseReportDto.title?.trim() ||
      createExpenseReportDto.motivo?.trim() ||
      'Rendición'

    const report = new this.expenseReportModel({
      ...createExpenseReportDto,
      title,
      userId: new Types.ObjectId(createExpenseReportDto.userId),
      clientId: new Types.ObjectId(createExpenseReportDto.clientId),
      createdBy: new Types.ObjectId(createdBy),
      projectId: createExpenseReportDto.projectId
        ? new Types.ObjectId(createExpenseReportDto.projectId)
        : undefined,
      // Rendición directa: siempre open desde el inicio, sin paso de solicitud
      status: isDirecta ? 'open' : isCollaborator ? 'solicited' : 'open',
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
    const title = advance.description?.trim() || advance.place?.trim() || 'Viático'
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
      .find({ clientId: new Types.ObjectId(clientId) })
      .populate('userId', 'name email signature bankAccount')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .exec()
  }

  async findAllByUser(userId: string, clientId: string) {
    return await this.expenseReportModel
      .find({
        userId: new Types.ObjectId(userId),
        clientId: new Types.ObjectId(clientId),
      })
      .populate('expenseIds', 'total')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .exec()
  }

  async findExpensesPaginated(
    reportId: string,
    opts: { page: number; limit: number; type?: string; status?: string; search?: string }
  ) {
    const report = await this.expenseReportModel
      .findById(reportId)
      .select('expenseIds')
      .exec()
    if (!report) throw new NotFoundException(`Report ${reportId} not found`)

    const ids = report.expenseIds.map(id => new Types.ObjectId(id.toString()))
    if (ids.length === 0) {
      return { data: [], total: 0, page: opts.page, limit: opts.limit, pages: 0 }
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
      .exec()

    const sorted = (all as unknown as Record<string, unknown>[]).sort((a, b) => {
      const dA = parseFechaEmisionInput(a['fechaEmision'] as string | undefined) ??
        new Date((a['createdAt'] as string | undefined) ?? 0)
      const dB = parseFechaEmisionInput(b['fechaEmision'] as string | undefined) ??
        new Date((b['createdAt'] as string | undefined) ?? 0)
      return dB.getTime() - dA.getTime()
    })

    const total = sorted.length
    const skip = (opts.page - 1) * opts.limit
    const data = sorted
      .slice(skip, skip + opts.limit)
      .map(e => applyFechaEmisionDisplayToExpense(e as { fechaEmision?: unknown; data?: unknown }))

    return { data, total, page: opts.page, limit: opts.limit, pages: Math.ceil(total / opts.limit) }
  }

  async findOne(id: string) {
    const report = await this.expenseReportModel
      .findById(id)
      .populate('userId', 'name email signature bankAccount dni')
      .populate({ path: 'expenseIds', populate: [{ path: 'categoryId', select: 'name' }, { path: 'proyectId', select: 'name' }] })
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('projectId', 'name')
      .exec()

    if (!report) {
      throw new NotFoundException(`Expense report with ID ${id} not found`)
    }
    return this.normalizeReportExpenseDates(report)
  }

  private normalizeReportExpenseDates(report: ExpenseReportDocument) {
    // Convertimos a POJO antes de tocar `expenseIds`: asignar POJOs sobre un
    // Document hace que Mongoose castee cada elemento de vuelta a ObjectId
    // (por el `ref: 'Expense'` del schema), descartando los datos populados.
    const pojo = (
      typeof (report as { toObject?: () => unknown }).toObject === 'function'
        ? (report as unknown as { toObject: () => Record<string, unknown> }).toObject()
        : (report as unknown as Record<string, unknown>)
    ) as Record<string, unknown>

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
      .select('status isDirecta')
      .lean()
      .exec()
    if (!existing) {
      throw new NotFoundException(`Expense report with ID ${id} not found`)
    }
    const isDirecta = (existing as any).isDirecta === true

    if (dto.status === 'reimbursed') {
      throw new BadRequestException(
        'El estado reembolsado se registra únicamente al cargar el comprobante de pago en tesorería.'
      )
    }

    if (
      dto.status === 'submitted' &&
      existing.status !== 'open' &&
      existing.status !== 'rejected'
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
    if (dto.status === 'pending_accounting' && existing.status !== 'submitted') {
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
        existing.status === 'pending_accounting' ? 'contabilidad' : 'coordinador'
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
        console.error('Error enviando notificaciones de rendición actualizada', error)
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

        const ownerProfile = await this.userService.findTransactionalProfile(ownerId)
        const ownerCoordinatorId = ownerProfile?.coordinatorId?.toString?.() || ''
        const ownerEmailLower =
          (typeof ownerRef === 'object' && ownerRef?.email
            ? String(ownerRef.email).trim().toLowerCase()
            : '')

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
            const accountingEmailEnabled = await this.userService.isEmailEnabled(u._id)
            if (accountingEmailEnabled) {
              await this.emailService.sendRendicionPendienteContabilidad(u.email, {
                clientId,
                recipientName: u.name,
                collaboratorName,
                reportTitle,
                budgetFormatted,
                expenseCount,
                platformUrl,
              })
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
        console.error('Error enviando notificaciones a contabilidad (pending_accounting)', error)
      }
    }

    // Contabilidad aprueba la rendición (→ approved): notificar colaborador
    // En rendición directa: solo colaborador. En flujo normal: colaborador + coordinador.
    if (dto.status === 'approved') {
      const owner = fullyUpdatedReport.userId as any
      const ownerId = owner?._id ? String(owner._id) : String(owner)
      const reportTitle = fullyUpdatedReport.title
      const budgetDisplay = await this.computeReportBudgetDisplay(fullyUpdatedReport)
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
          const profile = await this.userService.findTransactionalProfile(ownerId)
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
        console.error('Error enviando notificaciones de rendición aprobada por contabilidad', error)
      }

      try {
        await this.advanceService.liquidateExpenseReport(id)
      } catch (err) {
        console.error(`[ExpenseReportService] Liquidación post-aprobación ${id}:`, err)
      }

      // Si la liquidación arroja saldo a favor de la empresa, avisar al colaborador.
      try {
        const liquidated = await this.expenseReportModel
          .findById(id)
          .select('settlement title clientId')
          .lean<{ settlement?: { type?: string; difference?: number }; title?: string; clientId?: any }>()
          .exec()
        const diffAbs = Math.abs(Number(liquidated?.settlement?.difference ?? 0))
        if (liquidated?.settlement?.type === 'devolucion' && diffAbs >= 0.01) {
          const amountFormatted = diffAbs.toFixed(2)
          const ownerEmailLocal =
            (typeof owner === 'object' && owner?.email) || undefined
          if (ownerEmailLocal) {
            const ownerEmailEnabledLocal = ownerId
              ? await this.userService.isEmailEnabled(ownerId)
              : false
            if (ownerEmailEnabledLocal) {
              await this.emailService.sendRendicionDevolucionColaborador(ownerEmailLocal, {
                clientId: String(liquidated.clientId ?? fullyUpdatedReport.clientId),
                recipientName: collaboratorName,
                reportTitle: liquidated.title ?? reportTitle,
                amountFormatted,
                closedAt: this.emailService.formatDateDDMMYYYY(new Date()),
                platformUrl,
              })
            }
          }
          await this.notificationsService.create({
            userId: ownerId,
            title: 'Saldo pendiente de devolución',
            message: `Tu rendición "${reportTitle}" fue aprobada. Tienes un saldo de S/ ${amountFormatted} a devolver a la empresa.`,
            type: 'warning',
            actionUrl: `/mis-rendiciones/${id}/detalle`,
          }).catch(() => {})
        }
      } catch (err) {
        console.error(`[ExpenseReportService] Aviso devolución post-aprobación ${id}:`, err)
      }
    }

    // Rendición enviada (submitted)
    if (dto.status === 'submitted') {
      try {
        const ownerRef2 = fullyUpdatedReport.userId as any
        const ownerId2 = ownerRef2?._id ? String(ownerRef2._id) : String(ownerRef2)
        const user = await this.userService.findOne(ownerId2)
        const creatorName = user.name || 'Un colaborador'
        const clientId = String(fullyUpdatedReport.clientId)
        const budgetFormatted = (
          await this.computeReportBudgetDisplay(fullyUpdatedReport)
        ).toFixed(2)
        const expenseCount = fullyUpdatedReport.expenseIds?.length ?? 0
        const platformUrl = this.emailService.buildAppUrl(`/mis-rendiciones/${id}/detalle`)

        const emailData = {
          clientId,
          collaboratorName: creatorName,
          reportTitle: fullyUpdatedReport.title,
          budgetFormatted,
          expenseCount,
          platformUrl,
        }

        // Email del colaborador autor: lo reservamos primero en sentEmails para
        // que, si por configuración también figura en Contabilidad/Tesorería,
        // NO reciba el correo orientado al revisor; solo la confirmación "Usted
        // ha enviado…" que va al final.
        const ownerEmail = (fullyUpdatedReport.userId as any)?.email as string | undefined
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

          const profile = await this.userService.findTransactionalProfile(ownerId2)
          const coordinatorId = profile?.coordinatorId?.toString?.()
          if (coordinatorId) {
            const coordinator = await this.userService.findEmailNameClient(coordinatorId)
            if (coordinator?.email) {
              const coordEmailKey = coordinator.email.trim().toLowerCase()
              if (!sentEmails.has(coordEmailKey)) {
                sentEmails.add(coordEmailKey)
                const coordEmailEnabled = await this.userService.isEmailEnabled(coordinatorId)
                if (coordEmailEnabled) {
                  await this.emailService.sendRendicionSubmitted(coordinator.email, {
                    recipientName: coordinator.name,
                    ...emailData,
                  })
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
          const ownerEmailEnabled = await this.userService.isEmailEnabled(ownerId2)
          if (ownerEmailEnabled) {
            await this.emailService.sendRendicionSubmittedToColaborador(ownerEmail, {
              clientId,
              collaboratorName: creatorName,
              reportTitle: emailData.reportTitle,
              budgetFormatted: emailData.budgetFormatted,
              expenseCount: emailData.expenseCount,
              platformUrl: emailData.platformUrl,
            })
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
        const ownerEmail = (typeof ownerRef === 'object' && ownerRef?.email) || undefined
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
          const ownerEmailEnabled = await this.userService.isEmailEnabled(ownerId)
          if (ownerEmailEnabled) {
            await this.emailService.sendRendicionRechazadaColaborador(ownerEmail, {
              clientId: String(fullyUpdatedReport.clientId),
              collaboratorName,
              reportTitle,
              rejectionReason,
              rejectedBy: rejectedByLabel,
              platformUrl,
            })
          }
        }

        // Si lo rechazó Contabilidad, también notificar al coordinador (in-app + correo).
        if (rejectedByContabilidad) {
          const profile = await this.userService.findTransactionalProfile(ownerId)
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
        console.error('Error enviando notificación de rechazo de rendición', error)
      }
    }

    return fullyUpdatedReport
  }

  async remove(id: string) {
    const deleted = await this.expenseReportModel.findByIdAndDelete(id).exec()
    if (!deleted) {
      throw new NotFoundException(`Expense report with ID ${id} not found`)
    }
    return deleted
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
    } = {}
  ) {
    const page = Math.max(1, filters.page ?? 1)
    const limit = Math.min(200, filters.limit ?? 50)
    const skip = (page - 1) * limit

    // 1. Obtener IDs de todas las rendiciones directas del cliente
    const directReports = await this.expenseReportModel
      .find({ clientId: new Types.ObjectId(clientId), isDirecta: true })
      .select('_id userId title motivo')
      .populate('userId', 'name email')
      .lean()
      .exec()

    if (directReports.length === 0) {
      return { data: [], total: 0, page, limit, pages: 0 }
    }

    const reportIds = directReports.map(r => r._id)
    const reportMap = new Map(directReports.map(r => [String(r._id), r]))

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

    // Filtro proyecto
    if (filters.projectId && /^[0-9a-fA-F]{24}$/.test(filters.projectId)) {
      matchStage.proyectId = new Types.ObjectId(filters.projectId)
    }

    // Filtro categoría
    if (filters.categoryId && /^[0-9a-fA-F]{24}$/.test(filters.categoryId)) {
      matchStage.categoryId = new Types.ObjectId(filters.categoryId)
    }

    pipeline.push({ $match: matchStage })

    // Filtros de fecha sobre fechaEmision (string con formato dd/mm/yyyy o yyyy-mm-dd)
    if (filters.dateFrom || filters.dateTo) {
      pipeline.push({
        $addFields: {
          _parsedDate: {
            $cond: {
              if: { $regexMatch: { input: { $ifNull: ['$fechaEmision', ''] }, regex: /^\d{2}\/\d{2}\/\d{4}$/ } },
              then: {
                $dateFromString: {
                  dateString: {
                    $concat: [
                      { $substr: ['$fechaEmision', 6, 4] }, '-',
                      { $substr: ['$fechaEmision', 3, 2] }, '-',
                      { $substr: ['$fechaEmision', 0, 2] },
                    ],
                  },
                },
              },
              else: { $dateFromString: { dateString: { $ifNull: ['$fechaEmision', '1970-01-01'] }, onError: new Date('1970-01-01') } },
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

    // Lookup proyecto y categoría
    pipeline.push(
      { $lookup: { from: 'projects', localField: 'proyectId', foreignField: '_id', as: '_project' } },
      { $lookup: { from: 'categories', localField: 'categoryId', foreignField: '_id', as: '_category' } },
      { $addFields: { _projectDoc: { $arrayElemAt: ['$_project', 0] }, _categoryDoc: { $arrayElemAt: ['$_category', 0] } } },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit }
    )

    const expenses = await this.expenseModel.aggregate(pipeline).exec()

    // Adjuntar info del reporte a cada gasto
    const data = expenses.map(e => ({
      ...e,
      _report: reportMap.get(String(e.expenseReportId)) ?? null,
      _projectDoc: e._projectDoc ?? (e._project?.[0] ?? null),
      _categoryDoc: e._categoryDoc ?? (e._category?.[0] ?? null),
    }))

    return { data, total, page, limit, pages: Math.ceil(total / limit) }
  }

  async addExpenseToReport(reportId: string, expenseId: string) {
    return await this.expenseReportModel
      .findByIdAndUpdate(
        reportId,
        { $push: { expenseIds: new Types.ObjectId(expenseId) } },
        { new: true }
      )
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

  async updateSettlement(reportId: string, settlement: any) {
    return await this.expenseReportModel
      .findByIdAndUpdate(reportId, { $set: { settlement } }, { new: true })
      .exec()
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
        $set: { coordinatorApprovedBy: new Types.ObjectId(userId), coordinatorApprovedAt: new Date() },
      })
      .exec()
  }

  async setContabilidadApproval(reportId: string, userId: string) {
    await this.expenseReportModel
      .findByIdAndUpdate(reportId, {
        $set: { contabilidadApprovedBy: new Types.ObjectId(userId), contabilidadApprovedAt: new Date() },
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
      throw new NotFoundException(`Expense report with ID ${reportId} not found`)
    }
    if (report.status !== 'closed') {
      throw new BadRequestException(
        'La declaración jurada solo puede generarse cuando la rendición está cerrada.'
      )
    }

    const reportExpenses = (report.expenseIds || []).map((e: any) => String(e._id))
    const missing = dto.expenseIds.filter(id => !reportExpenses.includes(String(id)))
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

    const viaticoDocs = (viaticoRows as any[]).map(row => {
      const rep = row.expenseReportId
      const reportTitle =
        typeof rep === 'object' && rep?.title ? rep.title : 'Viáticos'
      return {
        kind: 'viatico_pago' as const,
        advanceId: String(row._id),
        title: row.description || reportTitle,
        receiptUrl: row.paymentInfo?.paymentReceiptUrl || '',
        receiptFileName:
          row.paymentInfo?.paymentReceiptFileName ||
          'comprobante-pago-viaticos.pdf',
        date:
          row.paymentInfo?.transferDate?.toISOString?.() ||
          row.createdAt?.toString?.() ||
          '',
        expenseReportId:
          typeof rep === 'object' && rep?._id
            ? String(rep._id)
            : rep
              ? String(rep)
              : undefined,
      }
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
    const canPay =
      userRole === ROLES.SUPER_ADMIN || userPermissions?.canApproveL2 === true
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
      throw new NotFoundException(`Expense report with ID ${reportId} not found`)
    }

    if (tenantCtx && !tenantCtx.isSuperAdmin) {
      const rid = this.normalizeExpenseReportClientId(report.clientId)
      if (
        !tenantCtx.requestClientId ||
        rid !== tenantCtx.requestClientId
      ) {
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
      const populated = await this.expenseReportModel.findById(reportId).populate('expenseIds', 'total').exec()
      const expenses = ((populated?.expenseIds ?? []) as any[])
      const expenseTotal = expenses.reduce((s: number, e: any) => s + (Number(e.total) || 0), 0)
      const rawAdvanceIds = ((report as any).advanceIds ?? []).map((x: any) =>
        (x && typeof x === 'object' && '_id' in x) ? String((x as any)._id) : String(x)
      )
      const linkedAdvances = await this.advanceService.findByExpenseReportId(reportId, rawAdvanceIds)
      const activeAdvances = linkedAdvances.filter((a: any) => ['approved', 'paid', 'settled'].includes(a.status))
      // Si no hay anticipos activos, el colaborador gastó de su propio bolsillo (saldo = 0 - gastos)
      const advanceTotal = activeAdvances.reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0)
      const difference = advanceTotal - expenseTotal
      if (Math.abs(difference) >= 0.01) {
        settlementType = difference > 0 ? 'devolucion' : 'reembolso'
        preSettlement = { advanceTotal, expenseTotal, difference, type: settlementType, settledAt: new Date() }
      }
    }

    if (settlementType !== 'reembolso') {
      throw new BadRequestException(
        'Esta rendición no tiene saldo a favor del colaborador que deba reembolsarse.'
      )
    }
    if (report.reimbursementPaymentInfo) {
      throw new BadRequestException('El reembolso de esta rendición ya fue registrado.')
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
      },
      reimbursedAt: new Date(),
    }
    if (report.status !== 'closed') {
      updateFields.status = 'reimbursed'
    }
    if (preSettlement) {
      updateFields.settlement = preSettlement
    }
    await this.expenseReportModel.findByIdAndUpdate(reportId, { $set: updateFields }).exec()

    await this.notifyCollaboratorReimbursementPaid(reportId)

    return this.findOne(reportId)
  }

  private async notifyCollaboratorReimbursementPaid(reportId: string) {
    const report = await this.findOne(reportId)
    const owner = report.userId as any
    if (!owner?.email) return

    const ownerEmailEnabled = await this.userService.isEmailEnabled(String(owner._id || owner.id))
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
        await this.emailService.sendRendicionReembolsoPagado(coordinator.email, {
          recipientName: coordinator.name || 'Coordinador/a',
          ...baseData,
        })
      }

      await this.notificationsService.create({
        userId: String(owner._id || owner.id),
        title: 'Reembolso registrado',
        message: `Se registró el pago del reembolso por S/ ${amountFormatted} para "${report.title}".`,
        type: 'success',
        actionUrl: `/mis-documentos`,
      })
    } catch (err) {
      console.error(
        'Error enviando notificación de reembolso pagado',
        err
      )
    }
  }

  async findOneWithAdvances(id: string) {
    const report = await this.expenseReportModel
      .findById(id)
      .populate('userId', 'name email signature bankAccount dni')
      .populate({ path: 'expenseIds', populate: [{ path: 'categoryId', select: 'name' }, { path: 'proyectId', select: 'name' }] })
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
    const report = await this.expenseReportModel.findById(id).populate('expenseIds').exec()
    if (!report) throw new NotFoundException(`Rendición ${id} no encontrada`)
    const errors: string[] = []
    if (report.status === 'closed') {
      errors.push('La rendición ya está cerrada')
      return errors
    }
    if (report.status !== 'approved' && report.status !== 'reimbursed') {
      errors.push(`Estado actual "${report.status}" no permite cierre. Se requiere estado aprobado o reembolsado.`)
    }
    const expenses = (report.expenseIds as any[]) || []
    const hasPendingExpenses = expenses.some(
      e => e?.status === 'pending_review' || e?.status === 'pending_sunat'
    )
    if (hasPendingExpenses) {
      errors.push('Existen gastos en estado pendiente de revisión o validación SUNAT')
    }
    const returnRecord = (report as any).returnRecord
    if (returnRecord && returnRecord.status !== 'validated') {
      errors.push(`Devolución pendiente en estado: ${returnRecord.status}. Se requiere validación de Contabilidad.`)
    }

    // Determinar tipo de liquidación para validar comprobantes previos al cierre
    {
      const existingSettlement = (report as any).settlement
      let effectiveSettlementType = existingSettlement?.type as string | undefined
      if (!effectiveSettlementType) {
        const expenses = (report.expenseIds as any[]) || []
        const expenseTotal = expenses.reduce((s: number, e: any) => s + (Number(e.total) || 0), 0)
        const rawAdvanceIds = ((report as any).advanceIds ?? []).map((x: any) =>
          (x && typeof x === 'object' && '_id' in x) ? String((x as any)._id) : String(x)
        )
        const linkedAdvances = await this.advanceService.findByExpenseReportId(id, rawAdvanceIds)
        const activeAdvances = linkedAdvances.filter((a: any) =>
          ['approved', 'paid', 'settled'].includes(a.status)
        )
        const advanceTotal = activeAdvances.reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0)
        const difference = advanceTotal - expenseTotal
        if (Math.abs(difference) >= 0.01) {
          effectiveSettlementType = difference > 0 ? 'devolucion' : 'reembolso'
        }
      }
      if (effectiveSettlementType === 'devolucion' && !(report as any).returnVoucher) {
        errors.push('El colaborador debe adjuntar el comprobante de devolución antes de cerrar la rendición.')
      }
      if (effectiveSettlementType === 'reembolso' && !(report as any).reimbursementPaymentInfo) {
        errors.push('Contabilidad debe registrar el comprobante de reembolso al colaborador antes de cerrar la rendición.')
      }
    }

    return errors
  }

  /** Cierra definitivamente la rendición. Bloquea toda edición posterior. */
  async close(id: string, closedBy: string): Promise<ExpenseReportDocument> {
    const errors = await this.validateClosureConditions(id)
    if (errors.length > 0) {
      throw new BadRequestException(errors.join(' | '))
    }
    // Compute settlement before closing in case it was skipped at approval time
    // (liquidateExpenseReport requires status === 'approved', which is still true here)
    try {
      await this.advanceService.liquidateExpenseReport(id)
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
      .findByIdAndUpdate(id, { $set: { status: 'closed', closureRecord } }, { new: true })
      .exec()
    if (!updated) throw new NotFoundException(`Rendición ${id} no encontrada`)
    const collaborator = await this.userService.findEmailNameClient(updated.userId.toString())
    const collaboratorEmailEnabled = collaborator?.email
      ? await this.userService.isEmailEnabled(updated.userId.toString())
      : false
    const closedAtStr = this.emailService.formatDateDDMMYYYY(closureRecord.closedAt)
    const clientIdStr = updated.clientId.toString()
    if (collaboratorEmailEnabled) {
      this.emailService.sendRendicionCerrada(collaborator!.email, {
        clientId: clientIdStr,
        recipientName: collaborator!.name,
        reportTitle: updated.title,
        closedAt: closedAtStr,
      }).catch(() => {})
    }

    const settlement = (updated as any).settlement
    const settlementDiffAbs = Math.abs(Number(settlement?.difference ?? 0))
    const clientId = clientIdStr
    const platformUrl = this.emailService.buildAppUrl(`/mis-rendiciones/${id}/detalle`)

    // Solo enviar correos de devolución / reembolso si hay un monto real (>= 0.01).
    // Evita los correos con "S/ 0.00" cuando el settlement persistido quedó stale.
    if (settlement?.type === 'devolucion' && settlementDiffAbs >= 0.01) {
      const amountFormatted = settlementDiffAbs.toFixed(2)
      if (collaboratorEmailEnabled) {
        this.emailService.sendRendicionDevolucionColaborador(collaborator!.email, {
          clientId,
          recipientName: collaborator!.name,
          reportTitle: updated.title,
          amountFormatted,
          closedAt: closedAtStr,
          platformUrl,
        }).catch(() => {})
      }
      if (collaborator) {
        this.notificationsService.create({
          userId: updated.userId.toString(),
          title: 'Devolución de saldo pendiente',
          message: `Tu rendición "${updated.title}" fue cerrada. Tienes un saldo de S/ ${amountFormatted} a devolver a la empresa. Por favor, adjunta el comprobante de depósito.`,
          type: 'warning',
          actionUrl: `/mis-rendiciones/${id}/detalle`,
        }).catch(() => {})
      }
    } else if (settlement?.type === 'reembolso' && settlementDiffAbs >= 0.01) {
      const amountFormatted = settlementDiffAbs.toFixed(2)
      const accountingUsers = await this.userService.findAccountingRecipientsWithIds(clientId)
      for (const u of accountingUsers) {
        this.emailService.sendRendicionReembolsoContabilidad(u.email, {
          clientId,
          recipientName: u.name,
          reportLabel: updated.title,
          reportTitle: updated.title,
          collaboratorName: collaborator?.name || 'Colaborador',
          amountFormatted,
          detailUrl: platformUrl,
        }).catch(() => {})
        this.notificationsService.create({
          userId: u._id,
          title: 'Reembolso pendiente — Rendición cerrada',
          message: `La rendición "${updated.title}" fue cerrada. Hay un reembolso de S/ ${amountFormatted} pendiente de pago al colaborador ${collaborator?.name || ''}.`,
          type: 'info',
          actionUrl: `/mis-rendiciones/${id}/detalle`,
        }).catch(() => {})
      }
    }

    return updated
  }

  async registerReturnVoucher(
    id: string,
    dto: { depositDate: string; bankOrigin?: string; operationNumber?: string; fileUrl: string; fileName?: string },
    userId: string
  ): Promise<ExpenseReportDocument> {
    const report = await this.expenseReportModel
      .findById(id)
      .populate('expenseIds', 'total status')
      .exec()
    if (!report) throw new NotFoundException(`Rendición ${id} no encontrada`)
    if (report.status !== 'closed' && report.status !== 'approved') {
      throw new BadRequestException('El comprobante de devolución solo puede cargarse cuando la rendición está aprobada o cerrada.')
    }
    if ((report as any).returnVoucher) {
      throw new BadRequestException('Ya se ha cargado un comprobante de devolución para esta rendición.')
    }
    if (report.userId.toString() !== userId) {
      throw new ForbiddenException('Solo el colaborador dueño puede cargar el comprobante de devolución.')
    }

    // Compute live balance from linked advances — used for notification amount only, never blocks the upload
    const rawAdvanceIds = ((report as any).advanceIds ?? []).map((x: any) =>
      (x && typeof x === 'object' && '_id' in x) ? String((x as any)._id) : String(x)
    )
    const linkedAdvances = await this.advanceService.findByExpenseReportId(id, rawAdvanceIds)
    const activeAdvances = linkedAdvances.filter(a =>
      ['approved', 'paid', 'settled'].includes(a.status)
    )
    const expenses = (report.expenseIds as any[]) || []
    const expenseTotal = expenses.reduce((s, e) => s + (Number(e.total) || 0), 0)
    const advanceTotal = activeAdvances.length > 0
      ? activeAdvances.reduce((s, a) => s + (Number(a.amount) || 0), 0)
      : Number((report as any).budget ?? 0)
    const difference = advanceTotal - expenseTotal
    const notifySettlement = { advanceTotal, expenseTotal, difference, type: 'devolucion' as const, settledAt: new Date() }
    // Update settlement in DB only if not already set or the stored type conflicts with actual balance
    const existingSettlement = (report as any).settlement
    if (!existingSettlement || (difference > 0.01 && existingSettlement.type !== 'devolucion')) {
      await this.expenseReportModel.findByIdAndUpdate(id, { $set: { settlement: notifySettlement } }).exec()
    }

    const voucher = {
      url: dto.fileUrl,
      fileName: dto.fileName,
      depositDate: dto.depositDate,
      bankOrigin: dto.bankOrigin,
      operationNumber: dto.operationNumber,
      uploadedAt: new Date(),
    }
    await this.expenseReportModel.findByIdAndUpdate(id, { $set: { returnVoucher: voucher } }).exec()

    const amountFormatted = Math.abs(Number(notifySettlement.difference ?? 0)).toFixed(2)
    const clientId = report.clientId.toString()
    const platformUrl = this.emailService.buildAppUrl(`/mis-rendiciones/${id}/detalle`)
    const collaborator = await this.userService.findEmailNameClient(userId)
    const collaboratorName = collaborator?.name || 'Colaborador'
    const collaboratorEmailEnabled = collaborator?.email
      ? await this.userService.isEmailEnabled(userId)
      : false

    if (collaboratorEmailEnabled) {
      this.emailService.sendRendicionCerrada(collaborator!.email, {
        clientId,
        recipientName: collaboratorName,
        reportTitle: report.title,
        closedAt: this.emailService.formatDateDDMMYYYY(voucher.uploadedAt),
      }).catch(() => {})
    }
    this.notificationsService.create({
      userId,
      title: 'Comprobante de devolución enviado',
      message: `Tu comprobante de devolución para la rendición "${report.title}" fue enviado correctamente. Contabilidad verificará el depósito.`,
      type: 'success',
      actionUrl: `/mis-rendiciones/${id}/detalle`,
    }).catch(() => {})

    const accountingUsers = await this.userService.findAccountingRecipientsWithIds(clientId)
    for (const u of accountingUsers) {
      this.emailService.sendRendicionDevolucionCargada(u.email, {
        clientId,
        recipientName: u.name,
        collaboratorName,
        reportTitle: report.title,
        amountFormatted,
        depositDate: dto.depositDate,
        bankOrigin: dto.bankOrigin,
        operationNumber: dto.operationNumber,
        platformUrl,
      }).catch(() => {})
      this.notificationsService.create({
        userId: u._id,
        title: 'Comprobante de devolución recibido',
        message: `${collaboratorName} adjuntó el comprobante de devolución de S/ ${amountFormatted} para la rendición "${report.title}". Por favor, verifica el depósito.`,
        type: 'info',
        actionUrl: `/mis-rendiciones/${id}/detalle`,
      }).catch(() => {})
    }

    return this.expenseReportModel.findById(id).exec() as Promise<ExpenseReportDocument>
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
      throw new BadRequestException('Solo se puede solicitar reapertura de rendiciones cerradas')
    }
    if (reason.trim().length < 200) {
      throw new BadRequestException('El motivo de reapertura debe tener al menos 200 caracteres')
    }
    const updatedClosure = {
      ...(report as any).closureRecord,
      reopeningStatus: 'requested' as const,
      reopeningRequestedBy: requestedBy,
      reopeningRequestedAt: new Date(),
      reopeningReason: reason,
    }
    const updated = await this.expenseReportModel
      .findByIdAndUpdate(id, { $set: { closureRecord: updatedClosure } }, { new: true })
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
    if (!report) throw new NotFoundException(`Expense report with ID ${id} not found`)

    if (
      String(report.userId) !== String(userId) &&
      String(report.createdBy) !== String(userId)
    ) {
      throw new ForbiddenException('No tienes permiso para cancelar esta rendición')
    }
    if (report.status !== 'solicited') {
      throw new BadRequestException(
        'Solo se puede cancelar una rendición en estado solicitada.'
      )
    }

    const updated = await this.expenseReportModel
      .findByIdAndUpdate(id, { $set: { status: 'cancelled' } }, { new: true })
      .exec()
    if (!updated) throw new NotFoundException(`Expense report with ID ${id} not found`)

    try {
      const admins = await this.userService.findAdminsByClient(String(report.clientId))
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
      console.error('Error enviando notificaciones de rendición cancelada', error)
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

    const reopenEntry = { reason: trimmedReason, reopenedBy, reopenedAt: new Date(), fromStatus: report.status }
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

    const collaborator = await this.userService.findEmailNameClient(report.userId.toString())
    const platformUrl = this.emailService.buildAppUrl(`/mis-rendiciones/${id}/detalle`)
    const clientIdStr = report.clientId.toString()
    const reportTitle = updated.title

    this.notificationsService.create({
      userId: report.userId.toString(),
      title: 'Rendición reabierta',
      message: `Tu rendición fue reabierta por contabilidad. Motivo: ${trimmedReason.slice(0, 100)}. Ya puedes editar tus comprobantes.`,
      type: 'warning',
      actionUrl: `/mis-rendiciones/${id}/detalle`,
    }).catch(() => {})

    if (collaborator?.email) {
      const collaboratorEmailEnabled =
        await this.userService.isEmailEnabled(report.userId.toString())
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
      const profile = await this.userService.findTransactionalProfile(report.userId.toString())
      const coordinatorId = profile?.coordinatorId?.toString?.()
      if (coordinatorId) {
        this.notificationsService.create({
          userId: coordinatorId,
          title: 'Rendición reabierta por Contabilidad',
          message: `La rendición "${reportTitle}" fue reabierta. Motivo: ${trimmedReason.slice(0, 100)}.`,
          type: 'info',
          actionUrl: `/mis-rendiciones/${id}/detalle`,
        }).catch(() => {})

        try {
          const coordinator = await this.userService.findEmailNameClient(coordinatorId)
          const coordinatorEmailEnabled = await this.userService.isEmailEnabled(coordinatorId)
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
        } catch {}
      }
    } catch {}

    return updated
  }

  /** Guard: lanza ForbiddenException si la rendición está cerrada. */
  async assertNotClosed(id: string): Promise<void> {
    const report = await this.expenseReportModel.findById(id).select('status closureRecord').exec()
    if (!report) throw new NotFoundException(`Rendición ${id} no encontrada`)
    if (report.status === 'closed') {
      throw new ForbiddenException('La rendición está cerrada y no permite modificaciones')
    }
  }
}
