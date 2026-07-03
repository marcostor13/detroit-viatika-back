import {
  Injectable,
  Inject,
  forwardRef,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import {
  Advance,
  AdvanceDocument,
  ADVANCE_THRESHOLDS,
} from './entities/advance.entity'
import {
  CreateAdvanceDto,
  CreateAdvanceLineDto,
} from './dto/create-advance.dto'
import { ApproveAdvanceDto, RejectAdvanceDto } from './dto/approve-advance.dto'
import { PayAdvanceDto } from './dto/pay-advance.dto'
import { ResubmitAdvanceDto } from './dto/resubmit-advance.dto'
import {
  ExpenseReportService,
  SolicitudDeleteActor,
} from '../expense-report/expense-report.service'
import { ROLES } from '../auth/enums/roles.enum'
import { ProjectService } from '../project/project.service'
import { CategoryService } from '../category/category.service'
import { UserService } from '../user/user.service'
import { UserPermissions } from '../user/schemas/user.schema'
import { EmailService } from '../email/email.service'
import { NotificationsService } from '../notifications/notifications.service'
import { SaldoService } from '../saldo/saldo.service'

@Injectable()
export class AdvanceService {
  private readonly logger = new Logger(AdvanceService.name)

  constructor(
    @InjectModel(Advance.name)
    private readonly advanceModel: Model<AdvanceDocument>,
    @Inject(forwardRef(() => ExpenseReportService))
    private readonly expenseReportService: ExpenseReportService,
    private readonly projectService: ProjectService,
    private readonly categoryService: CategoryService,
    private readonly userService: UserService,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
    private readonly saldoService: SaldoService
  ) {}

  async create(dto: CreateAdvanceDto): Promise<Advance> {
    if (!dto.clientId) throw new BadRequestException('clientId es requerido')
    if (!dto.userId) throw new BadRequestException('userId es requerido')

    if (this.isViaticoSolicitudPartial(dto)) {
      throw new BadRequestException(
        'Solicitud de viáticos incompleta: lugar, fecha inicio, fecha fin, centro de costo y al menos una línea de detalle son obligatorios.'
      )
    }

    const advance = this.isViaticoSolicitud(dto)
      ? await this.createViaticoSolicitud(dto)
      : await this.createSimpleAdvance(dto)

    // Solicitud financiada con saldos de la bolsa (mismo centro de costo, consumo completo).
    const saldoIds = Array.isArray(dto.saldoIds) ? dto.saldoIds : []
    if (saldoIds.length > 0) {
      const advId = (advance as any)._id.toString()
      await this.saldoService.consume(saldoIds, {
        userId: dto.userId!,
        clientId: dto.clientId!,
        context: 'viatico',
        projectId: dto.projectId,
        advanceId: advId,
      })
      await this.advanceModel
        .findByIdAndUpdate(advId, {
          saldoIds: saldoIds.map(id => new Types.ObjectId(id)),
        })
        .exec()
    }

    return advance
  }

  /**
   * Total fila (regla cliente):
   * - Si GLP/día > 0: importe × GLP/día × días
   * - Si no: importe × personas × días
   */
  private computeExpectedLineTotal(line: CreateAdvanceLineDto): number {
    const imp = Number(line.importe) || 0
    const glp = Number(line.glpPerDay) || 0
    const d = Number(line.days) || 0
    const p = Number(line.peopleCount) || 0
    const raw = glp > 0 ? imp * glp * d : imp * p * d
    return Math.round(raw * 100) / 100
  }

  private startOfDay(d: Date): Date {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    return x
  }

  /** Valor único línea para correos/tablas texto (Fase 3). */
  private viaticoNotifyField(value?: string): string {
    const t = (value ?? '').trim()
    return t.length > 0 ? t : '—'
  }

  private viaticoCargoDisplay(cargo?: string, employeeCode?: string): string {
    const c = (cargo ?? '').trim()
    if (c.length) return c
    return this.viaticoNotifyField(employeeCode)
  }

  /** Escape para HTML en correos (evita XSS y romper el markup). */
  private escapeHtmlForEmail(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  private viaticoEmailKvRow(label: string, value: string): string {
    const l = this.escapeHtmlForEmail(label)
    const v = this.escapeHtmlForEmail(value)
    return `<tr><td style="padding:6px 14px 6px 0;vertical-align:top;color:#64748b;font-size:13px;width:40%;">${l}</td><td style="padding:6px 0;vertical-align:top;color:#0f172a;font-size:13px;">${v}</td></tr>`
  }

  private viaticoEmailSectionTitle(title: string): string {
    const t = this.escapeHtmlForEmail(title)
    return `<h3 style="margin:22px 0 10px 0;font-size:13px;color:#0f172a;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #22c55e;padding-bottom:6px;">${t}</h3>`
  }

  /** Formato de monto con coma de miles y 2 decimales (p. ej. 2990 → "2,990.00"). */
  private formatViaticoMoney(value: number | string): string {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) return '0.00'
    return n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  private isViaticoSolicitud(dto: CreateAdvanceDto): boolean {
    return !!(
      dto.place?.trim() &&
      dto.startDate &&
      dto.endDate &&
      dto.projectId &&
      dto.lines?.length
    )
  }

  /** Fecha inicio del viaje es hoy o mañana (zona horaria del servidor). */
  private isViaticoTravelStartUrgent(start?: Date): boolean {
    if (!start) return false
    const s = this.startOfDay(new Date(start))
    const t = this.startOfDay(new Date())
    const tomorrow = new Date(t)
    tomorrow.setDate(tomorrow.getDate() + 1)
    return s.getTime() === t.getTime() || s.getTime() === tomorrow.getTime()
  }

  private isValidPaymentReceipt(
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
      return {
        ok: false,
        reason: 'El comprobante excede 10MB.',
      }
    }
    return { ok: true }
  }

  private isViaticoSolicitudPartial(dto: CreateAdvanceDto): boolean {
    const any =
      !!dto.place?.trim() ||
      !!dto.startDate ||
      !!dto.endDate ||
      !!dto.projectId ||
      (dto.lines?.length ?? 0) > 0
    if (!any) return false
    return !this.isViaticoSolicitud(dto)
  }

  private async createSimpleAdvance(dto: CreateAdvanceDto): Promise<Advance> {
    const hasPendingBalance =
      dto.pendingBalanceAmount !== undefined &&
      dto.additionalAmount !== undefined

    const amount = hasPendingBalance
      ? Number(dto.pendingBalanceAmount) + Number(dto.additionalAmount)
      : dto.amount

    const requiredLevels = amount > ADVANCE_THRESHOLDS.L1_MAX ? 2 : 1

    const advance = await this.advanceModel.create({
      userId: new Types.ObjectId(dto.userId),
      clientId: new Types.ObjectId(dto.clientId),
      expenseReportId: dto.expenseReportId
        ? new Types.ObjectId(dto.expenseReportId)
        : undefined,
      amount,
      description: dto.description,
      status: 'pending_l1',
      approvalLevel: 0,
      requiredLevels,
      approvalHistory: [],
      ...(hasPendingBalance && {
        pendingBalanceFromReportId: dto.pendingBalanceFromReportId
          ? new Types.ObjectId(dto.pendingBalanceFromReportId)
          : undefined,
        pendingBalanceAmount: Number(dto.pendingBalanceAmount),
        additionalAmount: Number(dto.additionalAmount),
      }),
    })

    if (dto.expenseReportId) {
      await this.expenseReportService.addAdvanceToReport(
        dto.expenseReportId,
        (advance as any)._id.toString()
      )
    }

    if (hasPendingBalance && dto.pendingBalanceFromReportId) {
      await this.expenseReportService.markPendingBalanceUsed(
        dto.pendingBalanceFromReportId,
        (advance as any)._id.toString()
      )
    }

    return advance
  }

  /** Validación compartida: nueva solicitud y reenvío tras rechazo (Fase 3). */
  private async validateViaticoBusinessRulesAndLines(
    dto: {
      place: string
      startDate: string
      endDate: string
      projectId: string
      lines: CreateAdvanceLineDto[]
      observations?: string
      amount: number
    },
    clientId: string
  ): Promise<{
    lineDocs: {
      categoryId: Types.ObjectId
      detalle?: string
      importe: number
      peopleCount: number
      glpPerDay: number
      days: number
      lineTotal: number
    }[]
    roundedSum: number
    description: string
    requiredLevels: number
  }> {
    const start = this.startOfDay(new Date(dto.startDate))
    const end = this.startOfDay(new Date(dto.endDate))
    if (end < start) {
      throw new BadRequestException(
        'La fecha fin debe ser mayor o igual a la fecha inicio.'
      )
    }

    const today = this.startOfDay(new Date())
    if (start < today) {
      throw new BadRequestException('La fecha de inicio no puede ser anterior a hoy.')
    }

    await this.projectService.findOne(dto.projectId, clientId)

    const lineDocs: {
      categoryId: Types.ObjectId
      detalle?: string
      importe: number
      peopleCount: number
      glpPerDay: number
      days: number
      lineTotal: number
    }[] = []

    let sum = 0
    for (const line of dto.lines) {
      const cat = await this.categoryService.findOne(line.categoryId, clientId)
      if (!cat.isActive) {
        throw new BadRequestException(
          `La categoría "${cat.name}" está inactiva y no puede usarse en la solicitud.`
        )
      }
      const expected = this.computeExpectedLineTotal(line)
      if (Math.abs(line.lineTotal - expected) > 0.02) {
        throw new BadRequestException(
          `Total de línea inconsistente. Esperado S/ ${expected.toFixed(2)}, recibido S/ ${line.lineTotal.toFixed(2)}.`
        )
      }
      sum += line.lineTotal
      const detalleTrim = line.detalle?.trim()
      lineDocs.push({
        categoryId: new Types.ObjectId(line.categoryId),
        detalle:
          detalleTrim && detalleTrim.length > 0 ? detalleTrim : undefined,
        importe: line.importe,
        peopleCount: line.peopleCount,
        glpPerDay: line.glpPerDay,
        days: line.days,
        lineTotal: line.lineTotal,
      })
    }

    const roundedSum = Math.round(sum * 100) / 100
    if (Math.abs(roundedSum - dto.amount) > 0.02) {
      throw new BadRequestException(
        `El monto total (S/ ${dto.amount}) debe coincidir con la suma de líneas (S/ ${roundedSum}).`
      )
    }

    const startFmt = this.emailService.formatDateDDMMYYYY(dto.startDate)
    const endFmt = this.emailService.formatDateDDMMYYYY(dto.endDate)
    const metaDesc = `Viático: ${dto.place.trim()} (${startFmt} → ${endFmt})`
    const description = dto.observations?.trim()
      ? `${metaDesc} | ${dto.observations.trim()}`
      : metaDesc

    const requiredLevels = roundedSum > ADVANCE_THRESHOLDS.L1_MAX ? 2 : 1

    return { lineDocs, roundedSum, description, requiredLevels }
  }

  private async createViaticoSolicitud(
    dto: CreateAdvanceDto
  ): Promise<Advance> {
    const profile = await this.userService.findTransactionalProfile(dto.userId!)
    if (!profile?.signature?.trim()) {
      throw new ForbiddenException(
        'Debe registrar su firma digital en el perfil antes de solicitar viáticos.'
      )
    }

    const pendingAmt = Number(dto.pendingBalanceAmount ?? 0)
    const linesOnlyAmount = Math.round((dto.amount - pendingAmt) * 100) / 100

    const { lineDocs, roundedSum, description, requiredLevels } =
      await this.validateViaticoBusinessRulesAndLines(
        {
          place: dto.place!,
          startDate: dto.startDate!,
          endDate: dto.endDate!,
          projectId: dto.projectId!,
          lines: dto.lines!,
          observations: dto.observations,
          amount: linesOnlyAmount,
        },
        dto.clientId!
      )

    const totalAmount = Math.round((roundedSum + pendingAmt) * 100) / 100
    const totalRequiredLevels = totalAmount > ADVANCE_THRESHOLDS.L1_MAX ? 2 : 1

    const advance = await this.advanceModel.create({
      userId: new Types.ObjectId(dto.userId),
      clientId: new Types.ObjectId(dto.clientId),
      coordinatorId: profile.coordinatorId ?? undefined,
      expenseReportId: dto.expenseReportId
        ? new Types.ObjectId(dto.expenseReportId)
        : undefined,
      projectId: new Types.ObjectId(dto.projectId!),
      place: dto.place!.trim(),
      ...(dto.lat != null && { lat: dto.lat }),
      ...(dto.lng != null && { lng: dto.lng }),
      startDate: new Date(dto.startDate!),
      endDate: new Date(dto.endDate!),
      lines: lineDocs,
      observations: dto.observations?.trim(),
      amount: totalAmount,
      description,
      status: 'pending_l1',
      approvalLevel: 0,
      requiredLevels: totalRequiredLevels,
      approvalHistory: [],
      solicitudVersion: 1,
      budgetCommitmentRecorded: false,
      ...(pendingAmt > 0 &&
        dto.pendingBalanceFromReportId && {
          pendingBalanceFromReportId: new Types.ObjectId(
            dto.pendingBalanceFromReportId
          ),
          pendingBalanceAmount: pendingAmt,
          additionalAmount: roundedSum,
        }),
      ...(dto.bankName?.trim() && { requestBankName: dto.bankName.trim() }),
      ...(dto.accountNumber?.trim() && { requestAccountNumber: dto.accountNumber.trim() }),
      ...(dto.cci?.trim() && { requestCci: dto.cci.trim() }),
    })

    if (dto.expenseReportId) {
      await this.expenseReportService.addAdvanceToReport(
        dto.expenseReportId,
        (advance as any)._id.toString()
      )
    }

    if (pendingAmt > 0 && dto.pendingBalanceFromReportId) {
      await this.expenseReportService.markPendingBalanceUsed(
        dto.pendingBalanceFromReportId,
        (advance as any)._id.toString()
      )
    }

    void this.notifyCoordinatorViatico(
      advance as AdvanceDocument,
      dto.userId!,
      dto.clientId!
    )

    const refreshed = await this.advanceModel
      .findById((advance as any)._id)
      .populate('projectId')
      .populate({
        path: 'lines.categoryId',
        select: 'name key limit isActive',
      })
      .exec()

    return refreshed as Advance
  }

  private async notifyCoordinatorViatico(
    advance: AdvanceDocument,
    collaboratorUserId: string,
    clientId: string
  ): Promise<void> {
    const advanceId = (advance as any)._id?.toString?.() ?? String(advance._id)

    const collaborator =
      await this.userService.findEmailNameClient(collaboratorUserId)

    const profile =
      await this.userService.findTransactionalProfile(collaboratorUserId)
    const coordId = profile?.coordinatorId

    const project = await this.projectService.findOne(
      advance.projectId!.toString(),
      clientId
    )

    const projectLabel = `[${project.code} - ${project.name}]`
    let clientLabel = ''
    const clientPop = project.client as unknown
    if (clientPop && typeof clientPop === 'object' && clientPop !== null) {
      const c = clientPop as { comercialName?: string; businessName?: string }
      clientLabel = String(c.comercialName || c.businessName || '')
    }

    const totalFormatted = this.formatViaticoMoney(advance.amount)
    const startStr =
      advance.startDate instanceof Date
        ? advance.startDate.toISOString().slice(0, 10)
        : String(advance.startDate).slice(0, 10)
    const endStr =
      advance.endDate instanceof Date
        ? advance.endDate.toISOString().slice(0, 10)
        : String(advance.endDate).slice(0, 10)

    const platformUrl = this.emailService.buildAppUrl('/viaticos')
    const manualResendUrl = `/advance/${advanceId}/resend-coordinator-email`

    const setNotif = async (payload: {
      recipientUserId?: Types.ObjectId
      status: 'sent' | 'failed' | 'skipped'
      errorMessage?: string
      manualResendUrl?: string
    }) => {
      await this.advanceModel.updateOne(
        { _id: (advance as any)._id },
        {
          $set: {
            coordinatorNotification: {
              recipientUserId: payload.recipientUserId,
              status: payload.status,
              sentAt: new Date(),
              errorMessage: payload.errorMessage,
              manualResendUrl: payload.manualResendUrl,
            },
          },
        }
      )
    }

    if (!coordId) {
      await setNotif({
        status: 'skipped',
        errorMessage: 'Colaborador sin coordinador asignado',
      })
      return
    }

    const coordinator = await this.userService.findEmailNameClient(
      coordId.toString()
    )

    if (!coordinator || !collaborator) {
      await setNotif({
        recipientUserId: coordId,
        status: 'skipped',
        errorMessage:
          'Coordinador o colaborador no encontrado en la base de datos',
      })
      return
    }

    // Allow coordinators without clientId (Admins/SuperAdmins may have null clientId).
    // When both have clientIds, they must belong to the same company.
    if (
      coordinator.clientId &&
      collaborator.clientId &&
      coordinator.clientId.toString() !== collaborator.clientId.toString()
    ) {
      await setNotif({
        recipientUserId: coordId,
        status: 'skipped',
        errorMessage:
          'Coordinador no pertenece al mismo cliente que el colaborador',
      })
      return
    }

    // In-app notification for coordinator — ensure it is persisted and log explicit failures.
    try {
      await this.notificationsService.create({
        userId: coordId.toString(),
        title: 'Nueva solicitud de viáticos pendiente',
        message: `${collaborator.name} solicitó viáticos para ${projectLabel} — S/ ${totalFormatted}. Ingresa a Tesorería para revisar.`,
        type: 'info',
        actionUrl: '/tesoreria',
        metadata: {
          advanceId,
          collaboratorUserId,
          event: 'viatico_submitted',
        },
      })
    } catch (err: unknown) {
      this.logger.error(
        `In-app notif viático ${advanceId}: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    const coordEmailEnabled = await this.userService.isEmailEnabled(
      coordId.toString()
    )
    if (!coordEmailEnabled) {
      await setNotif({
        recipientUserId: coordId,
        status: 'skipped',
        errorMessage:
          'Notificaciones por correo deshabilitadas para el coordinador',
      })
      return
    }

    try {
      await this.emailService.sendViaticoSolicitudToCoordinator(
        coordinator.email,
        {
          clientId,
          coordinatorName: coordinator.name,
          collaboratorName: collaborator.name,
          place: advance.place ?? '',
          startDate: startStr,
          endDate: endStr,
          totalFormatted,
          projectLabel,
          platformUrl,
        }
      )
      await setNotif({ recipientUserId: coordId, status: 'sent' })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al enviar correo'
      this.logger.error(`Fallo notificación viático ${advanceId}: ${msg}`)
      await setNotif({
        recipientUserId: coordId,
        status: 'failed',
        errorMessage: msg,
        manualResendUrl,
      })
    }
  }

  async resendCoordinatorNotification(
    advanceId: string,
    clientId: string
  ): Promise<Advance> {
    const advance = await this.findOne(advanceId)
    if (!advance.clientId || advance.clientId.toString() !== clientId) {
      throw new ForbiddenException(
        'No tiene permisos para reenviar esta notificación.'
      )
    }

    await this.notifyCoordinatorViatico(
      advance as AdvanceDocument,
      advance.userId.toString(),
      clientId
    )
    return this.findOne(advanceId)
  }

  private async notifyCollaboratorViaticoRejected(
    advance: AdvanceDocument,
    rejectionReason: string
  ): Promise<void> {
    const uid = advance.userId.toString()
    const collab = await this.userService.findEmailNameClient(uid)
    if (!collab?.email) return
    if (!(await this.userService.isEmailEnabled(uid))) return
    const profile =
      await this.userService.findCollaboratorViaticoNotifyProfile(uid)
    let projectLabel = '—'
    if (advance.projectId) {
      try {
        const p = await this.projectService.findOne(
          advance.projectId.toString(),
          advance.clientId.toString()
        )
        projectLabel = `${p.code} - ${p.name}`
      } catch {
        /* ignore */
      }
    }
    const aid = String(advance._id)
    const platformUrl = this.emailService.buildAppUrl(
      `/mis-rendiciones?viaticoAdvanceId=${encodeURIComponent(aid)}`
    )
    await this.emailService.sendViaticoRechazoColaborador(collab.email, {
      clientId: advance.clientId?.toString(),
      collaboratorName: profile?.name ?? collab.name,
      collaboratorDocument: this.viaticoNotifyField(profile?.dni),
      collaboratorArea: this.viaticoNotifyField(profile?.area),
      collaboratorCargo: this.viaticoCargoDisplay(
        profile?.cargo,
        profile?.employeeCode
      ),
      projectLabel,
      rejectionReason,
      platformUrl,
    })
  }

  /**
   * Cuerpo HTML del correo a contabilidad (orden: detalle del viaje → solicitante → aprobador).
   * Formato tabular para clientes que colapsan saltos de línea en texto plano.
   */
  private buildViaticoAccountingDetailBody(
    advance: AdvanceDocument,
    collaboratorMeta: {
      name: string
      dni?: string
      employeeCode?: string
      area?: string
      cargo?: string
    },
    approverMeta: {
      name: string
      dni?: string
      area?: string
      cargo?: string
      employeeCode?: string
    },
    approvedAt: Date,
    bankMeta?: { bankName?: string; accountNumber?: string; cci?: string }
  ): string {
    const project = advance.projectId as unknown
    let cc = '—'
    if (project && typeof project === 'object' && project !== null) {
      const pr = project as { code?: string; name?: string }
      if (pr.code !== undefined || pr.name !== undefined) {
        cc = `${pr.code ?? '—'} - ${pr.name ?? '—'}`
      }
    }
    const start =
      this.emailService.formatDateDDMMYYYY(advance.startDate as any) || '—'
    const end =
      this.emailService.formatDateDDMMYYYY(advance.endDate as any) || '—'
    const lines = advance.lines ?? []
    const categoryTotals = new Map<string, number>()
    for (const row of lines) {
      const cat = (row as { categoryId?: unknown }).categoryId
      const catName =
        cat && typeof cat === 'object' && cat !== null && 'name' in cat
          ? String((cat as { name?: string }).name)
          : 'Categoría'
      categoryTotals.set(
        catName,
        (categoryTotals.get(catName) ?? 0) + Number(row.lineTotal)
      )
    }
    const breakdownItems: string[] = []
    for (const [catName, total] of categoryTotals) {
      const lineText = `${catName}: S/ ${this.formatViaticoMoney(total)}`
      breakdownItems.push(
        `<li style="margin:6px 0;">${this.escapeHtmlForEmail(lineText)}</li>`
      )
    }
    const breakdownHtml =
      breakdownItems.length > 0
        ? `<ul style="margin:8px 0 16px 0;padding-left:22px;color:#0f172a;">${breakdownItems.join('')}</ul>`
        : `<p style="margin:8px 0 16px;color:#64748b;font-size:13px;">${this.escapeHtmlForEmail('(sin líneas)')}</p>`

    const apprDate = `${this.emailService.formatDateDDMMYYYY(approvedAt)} ${String(approvedAt.getHours()).padStart(2, '0')}:${String(approvedAt.getMinutes()).padStart(2, '0')}`
    const amountStr = `S/ ${this.formatViaticoMoney(advance.amount)}`
    const compromiso = `${amountStr} registrados en compromiso del centro de costo (hasta registro de pago en tesorería).`

    const tableOpen =
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">'
    const tableClose = '</table>'

    const detalleRows = [
      this.viaticoEmailKvRow('Proyecto', cc),
      this.viaticoEmailKvRow(
        'Lugar',
        advance.place?.trim() ? advance.place.trim() : '—'
      ),
      this.viaticoEmailKvRow('Fechas del viaje', `${start} al ${end}`),
      this.viaticoEmailKvRow('Monto total aprobado', amountStr),
    ].join('')

    const solicitanteRows = [
      this.viaticoEmailKvRow('Nombre', collaboratorMeta.name),
      this.viaticoEmailKvRow(
        'Documento',
        this.viaticoNotifyField(collaboratorMeta.dni)
      ),
      this.viaticoEmailKvRow(
        'Área',
        this.viaticoNotifyField(collaboratorMeta.area)
      ),
      this.viaticoEmailKvRow(
        'Cargo',
        this.viaticoCargoDisplay(
          collaboratorMeta.cargo,
          collaboratorMeta.employeeCode
        )
      ),
    ].join('')

    const aprobadorRows = [
      this.viaticoEmailKvRow('Nombre', approverMeta.name),
      this.viaticoEmailKvRow(
        'Documento',
        this.viaticoNotifyField(approverMeta.dni)
      ),
      this.viaticoEmailKvRow(
        'Área',
        this.viaticoNotifyField(approverMeta.area)
      ),
      this.viaticoEmailKvRow(
        'Cargo',
        this.viaticoCargoDisplay(approverMeta.cargo, approverMeta.employeeCode)
      ),
      this.viaticoEmailKvRow('Fecha y hora de aprobación', apprDate),
    ].join('')

    const bankRows = bankMeta?.accountNumber
      ? [
          this.viaticoEmailKvRow('Banco', this.viaticoNotifyField(bankMeta.bankName)),
          this.viaticoEmailKvRow('N° Cuenta', bankMeta.accountNumber),
          ...(bankMeta.cci ? [this.viaticoEmailKvRow('CCI', bankMeta.cci)] : []),
        ].join('')
      : ''

    return [
      `<div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;font-size:14px;line-height:1.55;color:#334155;">`,
      `<h2 style="margin:0 0 14px;font-size:16px;color:#0f172a;font-weight:700;">${this.escapeHtmlForEmail('Detalle de la solicitud aprobada')}</h2>`,
      tableOpen,
      detalleRows,
      tableClose,
      `<p style="margin:14px 0 6px;font-weight:600;color:#0f172a;font-size:13px;">${this.escapeHtmlForEmail('Desglose por categoría')}</p>`,
      breakdownHtml,
      `<p style="margin:0;padding:12px 14px;background-color:#ecfdf5;border-radius:6px;border-left:4px solid #22c55e;font-size:13px;color:#166534;"><strong>${this.escapeHtmlForEmail('Compromiso presupuestal')}</strong><br/>${this.escapeHtmlForEmail(compromiso)}</p>`,
      this.viaticoEmailSectionTitle('Solicitante'),
      tableOpen,
      solicitanteRows,
      tableClose,
      ...(bankRows ? [this.viaticoEmailSectionTitle('Cuenta bancaria para depósito'), tableOpen, bankRows, tableClose] : []),
      this.viaticoEmailSectionTitle('Aprobador'),
      tableOpen,
      aprobadorRows,
      tableClose,
      `</div>`,
    ].join('')
  }

  /**
   * Notifica a Contabilidad/Tesorería cuando una solicitud queda en pending_l2,
   * para que procedan con la segunda aprobación.
   */
  private async notifyL2ApproversViaticoAprobadoL1(
    advance: AdvanceDocument
  ): Promise<void> {
    const recipients = await this.userService.findL2ApprovalNotifyRecipients(
      advance.clientId.toString()
    )
    if (!recipients.length) {
      this.logger.warn(
        `Pendiente L2 viático ${advance._id}: sin destinatarios contabilidad/tesorería`
      )
      return
    }

    const populated = await this.advanceModel
      .findById(advance._id)
      .populate('projectId')
      .populate({ path: 'lines.categoryId', select: 'name key' })
      .exec()
    const doc = populated ?? advance

    let projectLabelSubject = '— - —'
    if (
      doc.projectId &&
      typeof doc.projectId === 'object' &&
      doc.projectId !== null
    ) {
      const pr = doc.projectId as { code?: string; name?: string }
      if (pr.code !== undefined || pr.name !== undefined) {
        projectLabelSubject = `${pr.code ?? '—'} - ${pr.name ?? '—'}`
      }
    }

    const collabId = advance.userId.toString()
    const collabProfile =
      await this.userService.findCollaboratorViaticoNotifyProfile(collabId)

    const lastAppr = [...doc.approvalHistory]
      .reverse()
      .find(h => h.action === 'approved')
    let approverName = '—'
    if (lastAppr?.approvedBy) {
      const ap = await this.userService.findEmailNameClient(
        String(lastAppr.approvedBy)
      )
      approverName = ap?.name ?? String(lastAppr.approvedBy)
    }

    const urgent = this.isViaticoTravelStartUrgent(doc.startDate)
    const platformUrl = this.emailService.buildAppUrl('/tesoreria')

    // Prefer bank data from the solicitud; fall back to user profile.
    let bankMetaL2: { bankName?: string; accountNumber?: string; cci?: string } | undefined
    if (doc.requestAccountNumber?.trim()) {
      bankMetaL2 = { bankName: doc.requestBankName, accountNumber: doc.requestAccountNumber, cci: doc.requestCci }
    } else {
      const collabFull = await this.userService.findOne(collabId)
      if (collabFull?.bankAccount?.accountNumber) {
        bankMetaL2 = { bankName: collabFull.bankAccount.bankName, accountNumber: collabFull.bankAccount.accountNumber, cci: collabFull.bankAccount.cci }
      }
    }

    const detailBody = this.buildViaticoL2PendingDetailBody(
      doc,
      {
        name: collabProfile?.name ?? 'Colaborador',
        dni: collabProfile?.dni,
        employeeCode: collabProfile?.employeeCode,
        area: collabProfile?.area,
        cargo: collabProfile?.cargo,
      },
      approverName,
      lastAppr?.date ?? new Date(),
      bankMetaL2
    )

    const emailTitle = urgent
      ? 'Aprobación final requerida — inicio de viaje próximo'
      : 'Solicitud de viáticos pendiente de aprobación final'

    const urgentBanner =
      '🟥 URGENTE: la fecha de inicio del viaje es hoy o mañana. Priorizar aprobación y gestión de desembolso.'

    for (const r of recipients) {
      try {
        await this.emailService.sendViaticoPendienteL2(r.email, {
          clientId: advance.clientId?.toString(),
          recipientName: r.name,
          urgent,
          urgentBanner,
          emailTitle,
          detailBody,
          projectLabel: projectLabelSubject,
          platformUrl,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(`Correo pendiente L2 a ${r.email}: ${msg}`)
      }
    }
  }

  /** Cuerpo HTML del correo de notificación a Contabilidad cuando queda en pending_l2. */
  private buildViaticoL2PendingDetailBody(
    advance: AdvanceDocument,
    collaboratorMeta: {
      name: string
      dni?: string
      employeeCode?: string
      area?: string
      cargo?: string
    },
    approverL1Name: string,
    approvedAt: Date,
    bankMeta?: { bankName?: string; accountNumber?: string; cci?: string }
  ): string {
    const project = advance.projectId as unknown
    let cc = '—'
    if (project && typeof project === 'object' && project !== null) {
      const pr = project as { code?: string; name?: string }
      if (pr.code !== undefined || pr.name !== undefined) {
        cc = `${pr.code ?? '—'} - ${pr.name ?? '—'}`
      }
    }
    const start =
      this.emailService.formatDateDDMMYYYY(advance.startDate as any) || '—'
    const end =
      this.emailService.formatDateDDMMYYYY(advance.endDate as any) || '—'

    const lines = advance.lines ?? []
    const categoryTotals = new Map<string, number>()
    for (const row of lines) {
      const cat = (row as { categoryId?: unknown }).categoryId
      const catName =
        cat && typeof cat === 'object' && cat !== null && 'name' in cat
          ? String((cat as { name?: string }).name)
          : 'Categoría'
      categoryTotals.set(
        catName,
        (categoryTotals.get(catName) ?? 0) + Number(row.lineTotal)
      )
    }
    const breakdownItems: string[] = []
    for (const [catName, total] of categoryTotals) {
      breakdownItems.push(
        `<li style="margin:6px 0;">${this.escapeHtmlForEmail(`${catName}: S/ ${this.formatViaticoMoney(total)}`)}</li>`
      )
    }
    const breakdownHtml =
      breakdownItems.length > 0
        ? `<ul style="margin:8px 0 16px 0;padding-left:22px;color:#0f172a;">${breakdownItems.join('')}</ul>`
        : `<p style="margin:8px 0 16px;color:#64748b;font-size:13px;">${this.escapeHtmlForEmail('(sin líneas)')}</p>`

    const apprDate = `${this.emailService.formatDateDDMMYYYY(approvedAt)} ${String(approvedAt.getHours()).padStart(2, '0')}:${String(approvedAt.getMinutes()).padStart(2, '0')}`
    const amountStr = `S/ ${this.formatViaticoMoney(advance.amount)}`

    const tableOpen =
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">'
    const tableClose = '</table>'

    const detalleRows = [
      this.viaticoEmailKvRow('Proyecto', cc),
      this.viaticoEmailKvRow(
        'Lugar',
        advance.place?.trim() ? advance.place.trim() : '—'
      ),
      this.viaticoEmailKvRow('Fechas del viaje', `${start} al ${end}`),
      this.viaticoEmailKvRow('Monto solicitado', amountStr),
    ].join('')

    const solicitanteRows = [
      this.viaticoEmailKvRow('Nombre', collaboratorMeta.name),
      this.viaticoEmailKvRow(
        'Documento',
        this.viaticoNotifyField(collaboratorMeta.dni)
      ),
      this.viaticoEmailKvRow(
        'Área',
        this.viaticoNotifyField(collaboratorMeta.area)
      ),
      this.viaticoEmailKvRow(
        'Cargo',
        this.viaticoCargoDisplay(
          collaboratorMeta.cargo,
          collaboratorMeta.employeeCode
        )
      ),
    ].join('')

    const aprobadorL1Rows = [
      this.viaticoEmailKvRow('Nombre', approverL1Name),
      this.viaticoEmailKvRow('Fecha y hora', apprDate),
    ].join('')

    const bankRows = bankMeta?.accountNumber
      ? [
          this.viaticoEmailKvRow('Banco', this.viaticoNotifyField(bankMeta.bankName)),
          this.viaticoEmailKvRow('N° Cuenta', bankMeta.accountNumber),
          ...(bankMeta.cci ? [this.viaticoEmailKvRow('CCI', bankMeta.cci)] : []),
        ].join('')
      : ''

    return [
      `<div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;font-size:14px;line-height:1.55;color:#334155;">`,
      `<h2 style="margin:0 0 14px;font-size:16px;color:#0f172a;font-weight:700;">${this.escapeHtmlForEmail('Detalle de la solicitud')}</h2>`,
      tableOpen,
      detalleRows,
      tableClose,
      `<p style="margin:14px 0 6px;font-weight:600;color:#0f172a;font-size:13px;">${this.escapeHtmlForEmail('Desglose por categoría')}</p>`,
      breakdownHtml,
      `<p style="margin:0;padding:12px 14px;background-color:#fffbeb;border-radius:6px;border-left:4px solid #f59e0b;font-size:13px;color:#92400e;"><strong>${this.escapeHtmlForEmail('Acción requerida')}</strong><br/>${this.escapeHtmlForEmail('Esta solicitud requiere tu aprobación (Nivel 2) para ser procesada.')}</p>`,
      this.viaticoEmailSectionTitle('Solicitante'),
      tableOpen,
      solicitanteRows,
      tableClose,
      ...(bankRows ? [this.viaticoEmailSectionTitle('Cuenta bancaria para depósito'), tableOpen, bankRows, tableClose] : []),
      this.viaticoEmailSectionTitle('Aprobador Nivel 1'),
      tableOpen,
      aprobadorL1Rows,
      tableClose,
      `</div>`,
    ].join('')
  }

  private async notifyAccountingViaticoApproved(
    advance: AdvanceDocument
  ): Promise<void> {
    const recipients =
      await this.userService.findViaticoAccountingNotifyRecipients(
        advance.clientId.toString()
      )
    if (!recipients.length) {
      this.logger.warn(
        `Aprobación viático ${advance._id}: sin destinatarios contabilidad/tesorería`
      )
      return
    }

    const populated = await this.advanceModel
      .findById(advance._id)
      .populate('projectId')
      .populate({ path: 'lines.categoryId', select: 'name key' })
      .exec()
    const doc = populated ?? advance

    const collabId = advance.userId.toString()
    let projectLabelSubject = '— - —'
    if (
      doc.projectId &&
      typeof doc.projectId === 'object' &&
      doc.projectId !== null
    ) {
      const pr = doc.projectId as { code?: string; name?: string }
      if (pr.code !== undefined || pr.name !== undefined) {
        projectLabelSubject = `${pr.code ?? '—'} - ${pr.name ?? '—'}`
      }
    }

    const collabProfile =
      await this.userService.findCollaboratorViaticoNotifyProfile(collabId)
    const lastAppr = [...doc.approvalHistory]
      .reverse()
      .find(h => h.action === 'approved')
    let approverMeta = {
      name: '—' as string,
      dni: undefined as string | undefined,
      area: undefined as string | undefined,
      cargo: undefined as string | undefined,
      employeeCode: undefined as string | undefined,
    }
    if (lastAppr?.approvedBy) {
      const apprId = String(lastAppr.approvedBy)
      const ap = await this.userService.findEmailNameClient(apprId)
      const baseName = ap?.name ?? apprId
      const apprProfile =
        await this.userService.findCollaboratorViaticoNotifyProfile(apprId)
      approverMeta = apprProfile
        ? {
            name:
              (apprProfile.name ?? '').trim().length > 0
                ? (apprProfile.name ?? '').trim()
                : baseName,
            dni: apprProfile.dni,
            area: apprProfile.area,
            cargo: apprProfile.cargo,
            employeeCode: apprProfile.employeeCode,
          }
        : {
            name: baseName,
            dni: undefined,
            area: undefined,
            cargo: undefined,
            employeeCode: undefined,
          }
    }

    const urgent = this.isViaticoTravelStartUrgent(doc.startDate)
    const platformUrl = this.emailService.buildAppUrl('/tesoreria')

    // Prefer bank data from the solicitud; fall back to user profile.
    let bankMeta: { bankName?: string; accountNumber?: string; cci?: string } | undefined
    if (doc.requestAccountNumber?.trim()) {
      bankMeta = { bankName: doc.requestBankName, accountNumber: doc.requestAccountNumber, cci: doc.requestCci }
    } else {
      const collabFull = await this.userService.findOne(collabId)
      if (collabFull?.bankAccount?.accountNumber) {
        bankMeta = { bankName: collabFull.bankAccount.bankName, accountNumber: collabFull.bankAccount.accountNumber, cci: collabFull.bankAccount.cci }
      }
    }

    const detailBody = this.buildViaticoAccountingDetailBody(
      doc,
      {
        name: collabProfile?.name ?? 'Colaborador',
        dni: collabProfile?.dni,
        employeeCode: collabProfile?.employeeCode,
        area: collabProfile?.area,
        cargo: collabProfile?.cargo,
      },
      approverMeta,
      lastAppr?.date ?? new Date(),
      bankMeta
    )

    const emailTitle = urgent
      ? 'Solicitud aprobada — inicio de viaje próximo'
      : 'Solicitud de viáticos aprobada'

    const urgentBanner =
      '🟥 URGENTE: la fecha de inicio del viaje es hoy o mañana. Priorizar gestión de desembolso.'

    for (const r of recipients) {
      try {
        await this.emailService.sendViaticoAprobacionContabilidad(r.email, {
          clientId: advance.clientId?.toString(),
          recipientName: r.name,
          urgent,
          urgentBanner,
          emailTitle,
          detailBody,
          projectLabel: projectLabelSubject,
          platformUrl,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(`Correo contabilidad viático a ${r.email}: ${msg}`)
      }
    }
  }

  /** Fase 3: compromiso en centro de costo + correo a contabilidad/tesorería. */
  private async onViaticoAdvanceFullyApproved(
    saved: AdvanceDocument
  ): Promise<void> {
    if (saved.projectId && !saved.budgetCommitmentRecorded) {
      try {
        await this.projectService.adjustCommittedAdvanceTotal(
          saved.projectId.toString(),
          saved.clientId.toString(),
          saved.amount
        )
        await this.advanceModel.updateOne(
          { _id: saved._id },
          { $set: { budgetCommitmentRecorded: true } }
        )
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(
          `Compromiso presupuestal viático ${saved._id}: ${msg}`
        )
      }
    }

    try {
      await this.notifyAccountingViaticoApproved(saved)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(
        `Notificación contabilidad viático ${saved._id}: ${msg}`
      )
    }
  }

  private async notifyViaticoPaymentRegistered(
    advance: AdvanceDocument
  ): Promise<void> {
    const collabId = advance.userId.toString()
    const collab = await this.userService.findEmailNameClient(collabId)
    if (!collab?.email) return

    const collabEmailEnabled = await this.userService.isEmailEnabled(collabId)
    const profile = await this.userService.findTransactionalProfile(collabId)
    const coordinatorId = profile?.coordinatorId?.toString?.()
    const coordinator = coordinatorId
      ? await this.userService.findEmailNameClient(coordinatorId)
      : null
    const coordEmailEnabled = coordinatorId
      ? await this.userService.isEmailEnabled(coordinatorId)
      : false

    let projectLabel = '—'
    if (advance.projectId) {
      try {
        const p = await this.projectService.findOne(
          advance.projectId.toString(),
          advance.clientId.toString()
        )
        projectLabel = `[${p.code} - ${p.name}]`
      } catch {
        /* ignore label fallback */
      }
    }

    const platformUrl = this.emailService.buildAppUrl('/mis-rendiciones')

    const transferDate = advance.paymentInfo?.transferDate
      ? new Date(advance.paymentInfo.transferDate).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)

    const baseData = {
      clientId: advance.clientId?.toString(),
      collaboratorName: collab.name,
      coordinatorName: coordinator?.name,
      projectLabel,
      amountFormatted: this.formatViaticoMoney(advance.amount),
      transferDate,
      reference: advance.paymentInfo?.reference || '—',
      paymentMethod: advance.paymentInfo?.method || 'transferencia_bancaria',
      paymentReceiptUrl: advance.paymentInfo?.paymentReceiptUrl || '',
      paymentReceiptFileName:
        advance.paymentInfo?.paymentReceiptFileName ||
        'comprobante-pago-viaticos.pdf',
      platformUrl,
    }

    if (collabEmailEnabled) {
      await this.emailService.sendViaticoPagoRealizado(collab.email, {
        recipientName: collab.name,
        ...baseData,
      })
    }

    if (coordinator?.email && coordEmailEnabled) {
      await this.emailService.sendViaticoPagoRealizado(coordinator.email, {
        recipientName: coordinator.name,
        ...baseData,
      })
    }
  }

  async findAllByClient(clientId: string) {
    return this.advanceModel
      .find({ clientId: new Types.ObjectId(clientId) })
      .populate('userId', 'name email bankAccount dni')
      .populate('expenseReportId', 'title status')
      .populate('projectId', 'code name isActive clientId')
      .sort({ createdAt: -1 })
      .exec()
  }

  /** Advances sin ExpenseReport vinculado (modelo legado sin fase de gastos iniciada). */
  async findOrphaned(
    clientId: string,
    actor?: { userId: string; role: string }
  ) {
    const filter: Record<string, unknown> = {
      clientId: new Types.ObjectId(clientId),
      expenseReportId: { $exists: false },
    }
    // Un coordinador solo debe ver los anticipos huérfanos de los colaboradores
    // que tiene asignados — mismo criterio que las rendiciones
    // (findAllByCoordinator). Sin esto, veía los de todo el cliente.
    if (actor?.role === ROLES.COORDINADOR) {
      const userIds = await this.userService.findUserIdsByCoordinator(
        actor.userId,
        clientId
      )
      filter.userId = { $in: userIds }
    }
    return this.advanceModel
      .find(filter)
      .populate('userId', 'name email')
      .populate('projectId', 'code name')
      .sort({ createdAt: -1 })
      .exec()
  }

  async findForViaticosPage(opts: {
    requesterId: string
    requesterRole: string
    requesterPermissions?: Partial<UserPermissions>
    clientId: string
    status?: string
    dateFrom?: string
    dateTo?: string
  }) {
    const isAdminRole = [
      ROLES.ADMIN,
      ROLES.SUPER_ADMIN,
      ROLES.CONTABILIDAD,
    ].includes(opts.requesterRole as ROLES)
    // Aprobador/coordinador real: solo quien puede aprobar nivel 1.
    const isApprover =
      !isAdminRole && opts.requesterPermissions?.canApproveL1 === true

    const filter: Record<string, unknown> = {
      clientId: new Types.ObjectId(opts.clientId),
    }

    if (isApprover) {
      // Coordinador: ve las solicitudes que le toca aprobar.
      filter['coordinatorId'] = new Types.ObjectId(opts.requesterId)
    } else if (!isAdminRole) {
      // Colaborador (con módulo «viaticos» pero sin permiso de aprobar):
      // solo ve sus propios viáticos, a modo informativo.
      filter['userId'] = new Types.ObjectId(opts.requesterId)
    }

    if (opts.status && opts.status !== 'all') {
      filter['status'] = opts.status
    }

    if (opts.dateFrom || opts.dateTo) {
      const dateFilter: Record<string, Date> = {}
      if (opts.dateFrom) dateFilter['$gte'] = new Date(opts.dateFrom)
      if (opts.dateTo) {
        const to = new Date(opts.dateTo)
        to.setHours(23, 59, 59, 999)
        dateFilter['$lte'] = to
      }
      filter['createdAt'] = dateFilter
    }

    return this.advanceModel
      .find(filter)
      .populate('userId', 'name email bankAccount dni')
      .populate('projectId', 'code name')
      .sort({ startDate: -1, createdAt: -1 })
      .exec()
  }

  /** Comprobantes de pago de viático para «Mis documentos» (Fase 6). */
  async findPaymentReceiptsForCollaborator(userId: string, clientId: string) {
    return this.advanceModel
      .find({
        userId: new Types.ObjectId(userId),
        clientId: new Types.ObjectId(clientId),
        status: { $in: ['partially_paid', 'paid', 'settled', 'returned'] },
        $or: [
          {
            'paymentInfo.paymentReceiptUrl': {
              $exists: true,
              $nin: [null, ''],
            },
          },
          { 'payments.0': { $exists: true } },
        ],
      })
      .select('payments paymentInfo description expenseReportId createdAt')
      .populate('expenseReportId', 'title')
      .sort({ createdAt: -1 })
      .lean()
      .exec()
  }

  async findMyAdvances(userId: string, clientId: string) {
    return this.advanceModel
      .find({
        userId: new Types.ObjectId(userId),
        clientId: new Types.ObjectId(clientId),
      })
      .populate('expenseReportId', 'title status')
      .populate('projectId', 'code name isActive clientId')
      .sort({ createdAt: -1 })
      .exec()
  }

  async findPending(clientId: string) {
    return this.advanceModel
      .find({
        clientId: new Types.ObjectId(clientId),
        status: { $in: ['pending_l1', 'pending_l2', 'approved'] },
      })
      .populate('userId', 'name email bankAccount dni')
      .populate('expenseReportId', 'title status')
      .populate('projectId', 'code name isActive clientId')
      .sort({ createdAt: -1 })
      .exec()
  }

  async findOne(id: string) {
    const advance = await this.advanceModel
      .findById(id)
      .populate('userId', 'name email bankAccount dni')
      .populate('expenseReportId', 'title status budget')
      .populate('projectId')
      .populate({
        path: 'lines.categoryId',
        select: 'name key limit isActive',
      })
      .exec()
    if (!advance)
      throw new NotFoundException(`Viático con ID ${id} no encontrado`)
    return advance
  }

  async approveL1(
    id: string,
    dto: ApproveAdvanceDto,
    userRole: string,
    userPermissions?: any
  ): Promise<Advance> {
    const advance = await this.advanceModel.findById(id)
    if (!advance) throw new NotFoundException(`Viático ${id} no encontrado`)

    if (advance.status !== 'pending_l1') {
      throw new BadRequestException(
        `El viático no está en estado de aprobación nivel 1 (estado actual: ${advance.status})`
      )
    }

    const canApproveL1 =
      [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(userRole as ROLES) ||
      userPermissions?.canApproveL1 === true
    if (!canApproveL1)
      throw new ForbiddenException('No tienes permiso para aprobar en nivel 1')

    advance.approvalHistory.push({
      level: 1,
      approvedBy: dto.approvedBy || 'sistema',
      action: 'approved',
      notes: dto.notes,
      date: new Date(),
    })
    advance.approvalLevel = 1

    if (advance.requiredLevels === 1) {
      advance.status = 'approved'
    } else {
      advance.status = 'pending_l2'
    }

    const saved = await advance.save()
    if (saved.status === 'approved') {
      await this.onViaticoAdvanceFullyApproved(saved as AdvanceDocument)
      this.notificationsService
        .create({
          userId: saved.userId.toString(),
          title: 'Solicitud de viáticos aprobada',
          message: `Tu solicitud de viáticos por S/ ${this.formatViaticoMoney(saved.amount)} fue aprobada. El pago está siendo procesado.`,
          type: 'success',
          actionUrl: '/mis-rendiciones',
        })
        .catch(() => {})
    } else {
      this.notificationsService
        .create({
          userId: saved.userId.toString(),
          title: 'Solicitud de viáticos en revisión',
          message: `Tu solicitud de viáticos por S/ ${this.formatViaticoMoney(saved.amount)} fue aprobada en el primer nivel y está pendiente de aprobación final.`,
          type: 'info',
          actionUrl: '/mis-rendiciones',
        })
        .catch(() => {})
      this.notifyL2ApproversViaticoAprobadoL1(saved as AdvanceDocument).catch(
        () => {}
      )
    }
    return this.findOne(id)
  }

  async approveL2(
    id: string,
    dto: ApproveAdvanceDto,
    userRole: string,
    userPermissions?: any
  ): Promise<Advance> {
    const advance = await this.advanceModel.findById(id)
    if (!advance) throw new NotFoundException(`Viático ${id} no encontrado`)

    if (advance.status !== 'pending_l2') {
      throw new BadRequestException(
        `El viático no está en estado de aprobación nivel 2 (estado actual: ${advance.status})`
      )
    }

    const canApproveL2 =
      userRole === ROLES.SUPER_ADMIN || userPermissions?.canApproveL2 === true
    if (!canApproveL2)
      throw new ForbiddenException('No tienes permiso para aprobar en nivel 2')

    advance.approvalHistory.push({
      level: 2,
      approvedBy: dto.approvedBy || 'sistema',
      action: 'approved',
      notes: dto.notes,
      date: new Date(),
    })
    advance.approvalLevel = 2
    advance.status = 'approved'

    const saved = await advance.save()
    await this.onViaticoAdvanceFullyApproved(saved as AdvanceDocument)
    this.notificationsService
      .create({
        userId: saved.userId.toString(),
        title: 'Solicitud de viáticos aprobada',
        message: `Tu solicitud de viáticos por S/ ${this.formatViaticoMoney(saved.amount)} fue aprobada completamente. El pago está siendo procesado.`,
        type: 'success',
        actionUrl: '/mis-rendiciones',
      })
      .catch(() => {})
    return this.findOne(id)
  }

  async reject(
    id: string,
    dto: RejectAdvanceDto,
    userRole: string,
    userPermissions?: any
  ): Promise<Advance> {
    const advance = await this.advanceModel.findById(id)
    if (!advance) throw new NotFoundException(`Viático ${id} no encontrado`)

    const rejectableStatuses = ['pending_l1', 'pending_l2']
    if (!rejectableStatuses.includes(advance.status)) {
      throw new BadRequestException(
        `No se puede rechazar un viático en estado "${advance.status}"`
      )
    }

    const canReject =
      [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(userRole as ROLES) ||
      userPermissions?.canApproveL1 === true ||
      userPermissions?.canApproveL2 === true
    if (!canReject)
      throw new ForbiddenException('No tienes permiso para rechazar viáticos')

    advance.approvalHistory.push({
      level: advance.status === 'pending_l2' ? 2 : 1,
      approvedBy: dto.rejectedBy || 'sistema',
      action: 'rejected',
      notes: dto.rejectionReason,
      date: new Date(),
    })
    advance.status = 'rejected'
    advance.rejectedBy = dto.rejectedBy
    advance.rejectionReason = dto.rejectionReason

    // Devolver a la bolsa los saldos que financiaban este viático rechazado.
    try {
      await this.saldoService.restoreByConsumer({ advanceId: id })
    } catch (err: unknown) {
      this.logger.error(
        `Revertir saldos al rechazar advance ${id}: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    const saved = await advance.save()
    this.notifyCollaboratorViaticoRejected(
      saved as AdvanceDocument,
      dto.rejectionReason
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`Correo rechazo viático colaborador: ${msg}`)
    })
    this.notificationsService
      .create({
        userId: saved.userId.toString(),
        title: 'Solicitud de viáticos rechazada',
        message: `Tu solicitud de viáticos por S/ ${this.formatViaticoMoney(saved.amount)} fue rechazada. Motivo: ${dto.rejectionReason}`,
        type: 'error',
        actionUrl: '/mis-rendiciones',
      })
      .catch(() => {})
    return this.findOne(id)
  }

  async registerPayment(
    id: string,
    dto: PayAdvanceDto,
    userRole: string,
    userPermissions?: any
  ): Promise<Advance> {
    const advance = await this.advanceModel.findById(id)
    if (!advance) throw new NotFoundException(`Viático ${id} no encontrado`)

    // Se permite registrar pagos cuando está aprobado/en espera, o seguir
    // sumando pagos parciales (incluso por encima de lo solicitado) mientras no
    // se haya liquidado/devuelto/cancelado.
    if (
      !['approved', 'pending_l2', 'partially_paid', 'paid'].includes(
        advance.status
      )
    ) {
      throw new BadRequestException(
        `Solo se puede registrar pago de viáticos aprobados o en proceso de pago (estado actual: ${advance.status})`
      )
    }

    // Candado: si la rendición vinculada ya fue aprobada/reembolsada/cerrada, no se
    // pueden seguir agregando pagos (evita desincronizar el presupuesto ya liquidado).
    if (advance.expenseReportId) {
      try {
        const linkedReport = await this.expenseReportService.findOne(
          advance.expenseReportId.toString()
        )
        const lockedStates = ['approved', 'reimbursed', 'closed']
        if (
          linkedReport &&
          lockedStates.includes((linkedReport as any).status)
        ) {
          throw new BadRequestException(
            `No se puede registrar el pago: la rendición vinculada ya fue liquidada/cerrada (estado: ${(linkedReport as any).status}).`
          )
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err
        // Si no se pudo cargar la rendición, no bloqueamos el pago.
      }
    }

    const canPay =
      [ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD].includes(userRole as ROLES) ||
      userPermissions?.canApproveL2 === true
    if (!canPay)
      throw new ForbiddenException('No tienes permiso para registrar pagos')

    // El comprobante es obligatorio salvo cuando el pago es en efectivo. Si se
    // adjunta uno (en cualquier método), se valida formato/tamaño.
    if (dto.method !== 'efectivo' && !dto.paymentReceiptUrl) {
      throw new BadRequestException(
        'El comprobante es obligatorio para pagos por transferencia o cheque.'
      )
    }
    if (dto.paymentReceiptUrl) {
      const receiptValidation = this.isValidPaymentReceipt(
        dto.paymentReceiptMimeType,
        dto.paymentReceiptFileName,
        dto.paymentReceiptSizeBytes
      )
      if (!receiptValidation.ok) {
        throw new BadRequestException(receiptValidation.reason)
      }
    }

    const prevPaid = Number(advance.paidAmount ?? 0)
    const isFirstPayment = !advance.payments || advance.payments.length === 0
    const paymentAmount = Number(
      dto.amount ?? Math.max(advance.amount - prevPaid, 0)
    )
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      throw new BadRequestException('El monto del pago debe ser mayor a 0.')
    }

    // Libera el compromiso presupuestal una sola vez (al primer pago).
    if (
      isFirstPayment &&
      advance.budgetCommitmentRecorded &&
      advance.projectId
    ) {
      try {
        await this.projectService.adjustCommittedAdvanceTotal(
          advance.projectId.toString(),
          advance.clientId.toString(),
          -advance.amount
        )
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(`Libera compromiso viático ${advance._id}: ${msg}`)
      }
      advance.budgetCommitmentRecorded = false
    }

    const paymentRecord = {
      amount: paymentAmount,
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
      scannedTitular: dto.scannedTitular,
      operationNumber: dto.operationNumber,
      operationDate: dto.operationDate,
      operationTime: dto.operationTime,
      createdAt: new Date(),
    }
    advance.payments = [...(advance.payments ?? []), paymentRecord]
    advance.paidAmount = prevPaid + paymentAmount

    // Compatibilidad: paymentInfo conserva el primer pago (usado en documentos/correos).
    if (isFirstPayment) {
      advance.paymentInfo = {
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
      }
    }

    // Con el primer pago ya puede rendir; queda 'paid' cuando el acumulado
    // alcanza (o supera) lo solicitado, sino 'partially_paid'.
    advance.status =
      advance.paidAmount >= advance.amount ? 'paid' : 'partially_paid'

    // Auto-crear rendición en el primer pago si el viático no tiene una vinculada
    let reportId: string | null = null
    if (!advance.expenseReportId) {
      try {
        const newReport = await this.expenseReportService.createAutoFromViatico(
          advance as AdvanceDocument
        )
        advance.expenseReportId = newReport._id as Types.ObjectId
        reportId = String(newReport._id)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(
          `Auto-crear rendición para viático ${advance._id}: ${msg}`
        )
      }
    } else {
      reportId = advance.expenseReportId.toString()
    }

    const saved = await advance.save()
    this.notifyViaticoPaymentRegistered(saved as AdvanceDocument).catch(
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(`Correo pago viático ${saved._id}: ${msg}`)
      }
    )
    const actionUrl = reportId
      ? `/mis-rendiciones/${reportId}/detalle`
      : '/mis-rendiciones'
    const fullyPaid = saved.status === 'paid'
    const message = fullyPaid
      ? `Se registró el pago de tu viático por S/ ${this.formatViaticoMoney(paymentAmount)} (total pagado S/ ${this.formatViaticoMoney(saved.paidAmount ?? paymentAmount)}). Ya puedes registrar tus gastos.`
      : `Se registró un pago parcial de tu viático por S/ ${this.formatViaticoMoney(paymentAmount)} (total pagado S/ ${this.formatViaticoMoney(saved.paidAmount ?? paymentAmount)} de S/ ${this.formatViaticoMoney(saved.amount)}). Ya puedes registrar tus gastos.`
    this.notificationsService
      .create({
        userId: saved.userId.toString(),
        title: fullyPaid
          ? 'Pago de viático registrado'
          : 'Pago parcial de viático registrado',
        message,
        type: 'success',
        actionUrl,
      })
      .catch(() => {})
    return saved
  }

  async findByExpenseReportId(
    reportId: string,
    advanceIds: string[] = []
  ): Promise<AdvanceDocument[]> {
    const oid = new Types.ObjectId(reportId)
    const idList = advanceIds.map(x => new Types.ObjectId(x))
    const query =
      idList.length > 0
        ? { $or: [{ _id: { $in: idList } }, { expenseReportId: oid }] }
        : { expenseReportId: oid }
    return this.advanceModel.find(query).exec() as Promise<AdvanceDocument[]>
  }

  /**
   * De una lista de rendiciones, devuelve los IDs de las que tienen al menos un
   * anticipo vinculado ya aprobado/pagado/liquidado. Sirve para que el front
   * sepa que el colaborador ya no puede eliminar esas rendiciones de viáticos.
   */
  async findApprovedExpenseReportIds(reportIds: string[]): Promise<string[]> {
    if (!reportIds.length) return []
    const oids = reportIds
      .filter(id => Types.ObjectId.isValid(id))
      .map(id => new Types.ObjectId(id))
    if (!oids.length) return []
    const rows = await this.advanceModel
      .find({
        expenseReportId: { $in: oids },
        status: { $in: ['approved', 'partially_paid', 'paid', 'settled'] },
      })
      .select('expenseReportId')
      .lean()
      .exec()
    return [...new Set(rows.map(r => String(r.expenseReportId)))]
  }

  /**
   * Fase 6 — Al aprobar la rendición: liquida en bloque los anticipos pagados vinculados,
   * guarda el settlement en la rendición y avisa a contabilidad si corresponde reembolso al colaborador.
   */
  async liquidateExpenseReport(reportId: string, fromClose = false): Promise<void> {
    const report = await this.expenseReportService.findOneWithAdvances(reportId)
    if (!report || report.status !== 'approved') {
      return
    }

    // Rendiciones de tipo viático se liquidan con su propio método (no tienen Advance externo).
    if ((report as any).type === 'viatico') {
      await this.expenseReportService.liquidateViaticoReport(reportId, fromClose)
      return
    }

    const oid = new Types.ObjectId(reportId)
    const rawAdvanceIds = Array.isArray(report.advanceIds)
      ? report.advanceIds
      : []
    const idList = rawAdvanceIds
      .map((x: unknown) => {
        const raw = (x as any)?._id ?? x
        const str = String(raw)
        return Types.ObjectId.isValid(str) ? new Types.ObjectId(str) : null
      })
      .filter((id): id is Types.ObjectId => id !== null)

    const linkedAdvances = await this.advanceModel
      .find({
        clientId: report.clientId,
        $or: [{ _id: { $in: idList } }, { expenseReportId: oid }],
      })
      .exec()

    const byId = new Map<string, AdvanceDocument>()
    for (const a of linkedAdvances) {
      byId.set(String(a._id), a as AdvanceDocument)
    }
    const advances = [...byId.values()]

    // Rendición directa iniciada por Contabilidad: el depósito funciona como anticipo
    // (el saldo no gastado lo devuelve el colaborador/coordinador).
    const depositTotal = Number((report as any).directaDeposit?.amount ?? 0)
    const hasDeposit = depositTotal > 0

    const expenses = (report.expenseIds as any[]) || []
    const expenseTotal = expenses.reduce((sum, e) => {
      // En una rendición directa con depósito todo gasto registrado (no rechazado)
      // cuenta como gastado; en viáticos solo cuentan los gastos aprobados.
      const status = String(e?.status || '').toLowerCase()
      if (hasDeposit) {
        if (status === 'rejected') return sum
      } else if (status !== 'approved') {
        return sum
      }
      return sum + (Number(e.total) || 0)
    }, 0)

    const paidAdvances = advances.filter(a => a.status === 'paid')
    const partiallyPaidAdvances = advances.filter(
      a => a.status === 'partially_paid'
    )
    const settledAdvances = advances.filter(a => a.status === 'settled')
    const approvedAdvances = advances.filter(a => a.status === 'approved')

    if (
      paidAdvances.length === 0 &&
      partiallyPaidAdvances.length === 0 &&
      settledAdvances.length === 0 &&
      approvedAdvances.length === 0 &&
      depositTotal <= 0
    ) {
      return
    }

    // Sumar TODOS los anticipos activos (paid + partially_paid + settled + approved).
    // Tras una reapertura pueden coexistir 'settled' del ciclo anterior y 'paid' del
    // nuevo viático; tomar solo un bucket subestima el advanceTotal. Se usa el monto
    // realmente pagado (paidAmount) para soportar pagos parciales.
    const activeAdvances = [
      ...paidAdvances,
      ...partiallyPaidAdvances,
      ...settledAdvances,
      ...approvedAdvances,
    ]
    // Un anticipo 'approved' (aún sin pago) aporta 0; el resto aporta lo realmente pagado.
    const advanceTotal =
      activeAdvances.reduce(
        (s, a) =>
          s +
          (a.status === 'approved' ? 0 : Number(a.paidAmount ?? a.amount) || 0),
        0
      ) + depositTotal

    const difference = advanceTotal - expenseTotal
    let type: 'reembolso' | 'devolucion' | 'equilibrado'
    if (Math.abs(difference) < 0.01) {
      type = 'equilibrado'
    } else if (difference > 0) {
      type = 'devolucion'
    } else {
      type = 'reembolso'
    }

    const settledAt = new Date()
    const settlementPayload = {
      expenseTotal,
      advanceAmount: advanceTotal,
      difference,
      type,
      settledAt,
    }

    const reportSettlement = {
      advanceTotal,
      expenseTotal,
      difference,
      type,
      settledAt,
    }

    // Liquida los anticipos efectivamente pagados (total o parcialmente). Un
    // 'partially_paid' también pasa a 'settled' para que no quede colgado ni
    // siga aceptando pagos tras la liquidación.
    const toSettle = [...paidAdvances, ...partiallyPaidAdvances]
    for (const adv of toSettle) {
      adv.status = 'settled'
      adv.settlement = settlementPayload
      await adv.save()
    }

    await this.expenseReportService.updateSettlement(reportId, reportSettlement)

    // Remanente positivo (devolución): el saldo no gastado queda disponible para
    // el colaborador en su bolsa de "Saldo" (idempotente por sourceReportId).
    if (type === 'devolucion' && difference > 0.01) {
      try {
        const ownerId = (report.userId as any)?._id ?? report.userId
        await this.saldoService.createFromRemnant({
          userId: ownerId,
          clientId: report.clientId,
          projectId: (report as any).projectId ?? null,
          sourceReportId: reportId,
          amount: difference,
          type: (report as any).isDirecta ? 'rendicion_directa' : 'rendicion',
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(`Crear saldo remanente ${reportId}: ${msg}`)
      }
    }

    const doc = report as any
    const alreadyNotified = !!doc.reimbursementAccountingNotifiedAt
    const alreadyPaidReimbursement = !!doc.reimbursementPaymentInfo

    if (
      type === 'reembolso' &&
      Math.abs(difference) >= 0.01 &&
      !alreadyNotified &&
      !alreadyPaidReimbursement
    ) {
      try {
        await this.notifyAccountingReembolsoPending(
          reportId,
          report,
          Math.abs(difference)
        )
        await this.expenseReportService.markReimbursementAccountingNotified(
          reportId
        )
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(
          `Notificación reembolso contabilidad ${reportId}: ${msg}`
        )
      }
    }
  }

  private async notifyAccountingReembolsoPending(
    reportId: string,
    report: any,
    amountReimburse: number
  ): Promise<void> {
    const clientId = String(report.clientId)
    const recipients =
      await this.userService.findViaticoAccountingNotifyRecipients(clientId)

    const owner = report.userId as { name?: string; email?: string }
    const collaboratorName = owner?.name || 'Colaborador'

    const detailUrl = this.emailService.buildAppUrl(
      `/mis-rendiciones/${reportId}/detalle`
    )

    const amountFormatted = this.formatViaticoMoney(amountReimburse)
    const reportTitle = report.title || 'Rendición'
    const reportLabel = reportTitle

    for (const r of recipients) {
      if (!r.email?.trim()) continue
      await this.emailService.sendRendicionReembolsoContabilidad(r.email, {
        clientId,
        recipientName: r.name || 'Estimado/a',
        reportLabel,
        reportTitle,
        collaboratorName,
        amountFormatted,
        detailUrl,
      })
    }
  }

  async registerReturn(id: string, returnedAmount: number): Promise<Advance> {
    const advance = await this.advanceModel.findById(id)
    if (!advance) throw new NotFoundException(`Viático ${id} no encontrado`)

    if (!['settled', 'paid', 'partially_paid'].includes(advance.status)) {
      throw new BadRequestException(
        `Solo se puede registrar devolución de viáticos pagados o liquidados`
      )
    }

    advance.returnedAmount = returnedAmount
    advance.status = 'returned'

    return advance.save()
  }

  // ─── FASE 7 — Sub-flujo de devolución de saldo ────────────────────────────

  /** Inicia el registro de devolución luego de settle() cuando type='devolucion'. */
  async initiateReturnTracking(id: string): Promise<Advance> {
    const advance = await this.advanceModel.findById(id)
    if (!advance) throw new NotFoundException(`Viático ${id} no encontrado`)
    if (advance.status !== 'settled') {
      throw new BadRequestException(
        'Solo se puede iniciar devolución desde estado liquidado'
      )
    }
    if (!advance.settlement || advance.settlement.type !== 'devolucion') {
      throw new BadRequestException('Este viático no tiene saldo a devolver')
    }
    const dueDate = this.addBusinessDays(new Date(), 10)
    const returnRecord = {
      status: 'pending' as const,
      amountDue: advance.settlement.difference,
      dueDate,
      isOverdue: false,
      remindersSent: 0,
    }
    await this.advanceModel.findByIdAndUpdate(id, { $set: { returnRecord } })
    const collaborator = await this.userService.findEmailNameClient(
      advance.userId.toString()
    )
    if (collaborator?.email) {
      this.emailService
        .sendDevolucionPendiente(collaborator.email, {
          clientId: advance.clientId?.toString(),
          recipientName: collaborator.name,
          amountDue: this.formatViaticoMoney(advance.settlement.difference),
          dueDate: this.emailService.formatDateDDMMYYYY(dueDate),
          advanceId: id,
        })
        .catch(err =>
          this.logger.error(`Email devolución pendiente: ${err?.message}`)
        )
    }
    return (await this.advanceModel.findById(id))!
  }

  /** Colaborador carga el comprobante de depósito (Fase 7.3). */
  async uploadReturnProof(
    id: string,
    proof: {
      depositDate: Date
      amountReturned: number
      bankOrigin: string
      operationNumber: string
      fileUrl: string
      fileKey?: string
      note?: string
      scannedAmount?: number
      operationDate?: string
      operationTime?: string
      titular?: string
    }
  ): Promise<Advance> {
    const advance = await this.advanceModel.findById(id)
    if (!advance) throw new NotFoundException(`Viático ${id} no encontrado`)
    const rr = (advance as any).returnRecord
    if (!rr || rr.status !== 'pending') {
      throw new BadRequestException(
        'El viático no tiene una devolución pendiente de comprobante'
      )
    }
    if (proof.amountReturned < rr.amountDue) {
      throw new BadRequestException(
        `El monto devuelto (${proof.amountReturned}) es menor al monto adeudado (${rr.amountDue})`
      )
    }
    const updatedRr = {
      ...rr,
      status: 'proof_uploaded' as const,
      proof: { ...proof, uploadedAt: new Date() },
    }
    await this.advanceModel.findByIdAndUpdate(id, {
      $set: { returnRecord: updatedRr },
    })
    return (await this.advanceModel.findById(id))!
  }

  /** Contabilidad valida o rechaza el comprobante (Fase 7.4). */
  async validateReturn(
    id: string,
    approved: boolean,
    validatedBy: string,
    rejectionReason?: string
  ): Promise<Advance> {
    const advance = await this.advanceModel.findById(id)
    if (!advance) throw new NotFoundException(`Viático ${id} no encontrado`)
    const rr = (advance as any).returnRecord
    if (!rr || rr.status !== 'proof_uploaded') {
      throw new BadRequestException(
        'No hay comprobante pendiente de validación'
      )
    }
    if (!approved && (!rejectionReason || rejectionReason.trim().length < 50)) {
      throw new BadRequestException(
        'El motivo de rechazo debe tener al menos 50 caracteres'
      )
    }
    const validation = {
      validatedBy,
      validatedAt: new Date(),
      approved,
      rejectionReason,
    }
    const newStatus = approved ? 'validated' : 'rejected'
    const updatedRr = { ...rr, status: newStatus, validation }
    const updates: any = { returnRecord: updatedRr }
    if (approved) {
      updates.status = 'returned'
      updates.returnedAmount = rr.proof?.amountReturned ?? rr.amountDue
    }
    await this.advanceModel.findByIdAndUpdate(id, { $set: updates })
    const collaborator = await this.userService.findEmailNameClient(
      advance.userId.toString()
    )
    const collabReturnEmailEnabled = await this.userService.isEmailEnabled(
      advance.userId.toString()
    )
    if (collaborator?.email && collabReturnEmailEnabled) {
      const sendFn = approved
        ? this.emailService.sendDevolucionValidada.bind(this.emailService)
        : this.emailService.sendDevolucionRechazada.bind(this.emailService)
      sendFn(collaborator.email, {
        clientId: advance.clientId?.toString(),
        recipientName: collaborator.name,
        amountDue: this.formatViaticoMoney(rr.amountDue),
        rejectionReason,
        advanceId: id,
      }).catch((err: any) =>
        this.logger.error(`Email validación devolución: ${err?.message}`)
      )
    }
    return (await this.advanceModel.findById(id))!
  }

  /** Devuelve anticipos con devoluciones pendientes del cliente (para vista de contabilidad). */
  async findPendingReturns(clientId: string): Promise<Advance[]> {
    return this.advanceModel
      .find({
        clientId: new Types.ObjectId(clientId),
        'returnRecord.status': {
          $in: ['pending', 'proof_uploaded', 'rejected'],
        },
      })
      .populate('userId', 'name email bankAccount dni')
      .exec() as Promise<Advance[]>
  }

  /** Marca devoluciones vencidas (llamado desde cron o manualmente). */
  async markOverdueReturns(): Promise<number> {
    const now = new Date()
    const result = await this.advanceModel.updateMany(
      {
        'returnRecord.status': 'pending',
        'returnRecord.dueDate': { $lt: now },
        'returnRecord.isOverdue': false,
      },
      { $set: { 'returnRecord.isOverdue': true } }
    )
    return (result as any).modifiedCount ?? 0
  }

  private addBusinessDays(date: Date, days: number): Date {
    const result = new Date(date)
    let added = 0
    while (added < days) {
      result.setDate(result.getDate() + 1)
      const dow = result.getDay()
      if (dow !== 0 && dow !== 6) added++
    }
    return result
  }

  /**
   * Fase 3 — colaborador corrige y reenvía; conserva historial y aumenta versión.
   */
  async resubmitRejected(
    id: string,
    dto: ResubmitAdvanceDto,
    actingUserId: string,
    clientId: string
  ): Promise<Advance> {
    const advance = await this.advanceModel.findById(id)
    if (!advance) throw new NotFoundException(`Viático ${id} no encontrado`)

    if (advance.status !== 'rejected' && advance.status !== 'pending_l1') {
      throw new BadRequestException(
        'Solo pueden editarse solicitudes en estado rechazado o pendiente de aprobación.'
      )
    }

    if (advance.userId.toString() !== actingUserId) {
      throw new ForbiddenException(
        'Solo el colaborador solicitante puede corregir y reenviar esta solicitud.'
      )
    }

    if (advance.clientId.toString() !== clientId) {
      throw new ForbiddenException(
        'La solicitud no pertenece a su organización.'
      )
    }

    const profile =
      await this.userService.findTransactionalProfile(actingUserId)
    if (!profile?.signature?.trim()) {
      throw new ForbiddenException(
        'Debe registrar su firma digital en el perfil antes de reenviar viáticos.'
      )
    }

    const { lineDocs, roundedSum, description, requiredLevels } =
      await this.validateViaticoBusinessRulesAndLines(
        {
          place: dto.place,
          startDate: dto.startDate,
          endDate: dto.endDate,
          projectId: dto.projectId,
          lines: dto.lines,
          observations: dto.observations,
          amount: dto.amount,
        },
        clientId
      )

    const wasEditing = advance.status === 'pending_l1'
    advance.place = dto.place.trim()
    if (dto.lat != null) advance.lat = dto.lat
    if (dto.lng != null) advance.lng = dto.lng
    advance.startDate = new Date(dto.startDate)
    advance.endDate = new Date(dto.endDate)
    advance.projectId = new Types.ObjectId(dto.projectId)
    advance.lines = lineDocs
    advance.observations = dto.observations?.trim()
    advance.amount = roundedSum
    advance.description = description
    advance.status = 'pending_l1'
    advance.approvalLevel = 0
    advance.requiredLevels = requiredLevels
    advance.rejectedBy = undefined
    advance.rejectionReason = undefined
    advance.budgetCommitmentRecorded = false
    advance.solicitudVersion = (advance.solicitudVersion || 1) + 1

    advance.approvalHistory.push({
      level: 0,
      approvedBy: actingUserId,
      action: 'resubmitted',
      notes: wasEditing
        ? 'Solicitud editada antes de aprobación'
        : 'Solicitud corregida y reenviada tras rechazo',
      date: new Date(),
    })

    await advance.save()

    await this.notifyCoordinatorViatico(
      advance as AdvanceDocument,
      actingUserId,
      clientId
    )

    const refreshed = await this.advanceModel
      .findById(advance._id)
      .populate('projectId')
      .populate({
        path: 'lines.categoryId',
        select: 'name key limit isActive',
      })
      .exec()

    return refreshed as Advance
  }

  // ─── Cancel / Delete por colaborador ────────────────────────────────────────

  async cancelByCollaborator(id: string, userId: string): Promise<Advance> {
    const advance = await this.advanceModel.findById(id)
    if (!advance) throw new NotFoundException(`Viático ${id} no encontrado`)
    if (advance.userId.toString() !== userId) {
      throw new ForbiddenException(
        'Solo el colaborador solicitante puede cancelar esta solicitud.'
      )
    }
    if (advance.status !== 'pending_l1') {
      throw new BadRequestException(
        'Solo se puede cancelar una solicitud en estado pendiente de aprobación.'
      )
    }
    advance.status = 'cancelled'
    await advance.save()

    this.notifyCoordinatorViaticoCancelled(
      advance as AdvanceDocument,
      userId
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`Correo cancelación viático coordinador: ${msg}`)
    })

    return advance
  }

  /**
   * Elimina una solicitud de viáticos (anticipo) completa. La autorización depende
   * del estado de aprobación:
   *  - Sin ninguna aprobación L1/L2: el colaborador propietario, Contabilidad,
   *    Administrador o Superadmin.
   *  - Con al menos una aprobación: solo Contabilidad o Superadmin.
   * Si el anticipo ya tiene una rendición vinculada, ésta se elimina en cascada.
   */
  async remove(id: string, actor: SolicitudDeleteActor): Promise<Advance> {
    const advance = await this.advanceModel.findById(id).exec()
    if (!advance) throw new NotFoundException(`Viático ${id} no encontrado`)

    const role = actor?.role ?? ''
    const isSuperAdmin = role === ROLES.SUPER_ADMIN
    const isContabilidad = role === ROLES.CONTABILIDAD
    const isColaborador = role === ROLES.COLABORADOR

    const hasApproval =
      (advance.approvalHistory ?? []).some(e => e.action === 'approved') ||
      ['approved', 'partially_paid', 'paid', 'settled'].includes(advance.status)

    // El viático ya fue pagado y generó una rendición (representa dinero ya
    // desembolsado): no puede eliminarse por la app —ni colaborador ni
    // Contabilidad—. Solo Superadmin (escape técnico). Evita además orfanar la
    // rendición vía la cascada.
    if (advance.expenseReportId && !isSuperAdmin) {
      throw new ForbiddenException(
        'Este viático ya fue pagado y tiene una rendición asociada; no puede eliminarse.'
      )
    }

    if (hasApproval) {
      if (!isContabilidad && !isSuperAdmin) {
        throw new ForbiddenException(
          'Este viático ya tiene una aprobación; solo Contabilidad puede eliminarlo.'
        )
      }
    } else if (
      isColaborador &&
      advance.userId.toString() !== String(actor.userId)
    ) {
      throw new ForbiddenException(
        'Solo puedes eliminar tus propias solicitudes.'
      )
    }

    // Cascada: si hay rendición vinculada, eliminarla también (incluye sus comprobantes).
    if (advance.expenseReportId) {
      try {
        await this.expenseReportService.remove(
          advance.expenseReportId.toString(),
          actor
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(
          `Error eliminando rendición vinculada al viático ${id}: ${msg}`
        )
      }
    }

    // Devolver a la bolsa los saldos que este viático había consumido (si los hubo).
    try {
      await this.saldoService.restoreByConsumer({ advanceId: id })
    } catch (err: unknown) {
      this.logger.error(
        `Revertir saldos al eliminar advance ${id}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    await this.advanceModel.findByIdAndDelete(id).exec()
    return advance
  }

  private async notifyCoordinatorViaticoCancelled(
    advance: AdvanceDocument,
    collaboratorUserId: string
  ): Promise<void> {
    if (!advance.projectId) return

    const collaborator =
      await this.userService.findEmailNameClient(collaboratorUserId)
    const profile =
      await this.userService.findTransactionalProfile(collaboratorUserId)
    const coordId = profile?.coordinatorId
    if (!coordId) return

    const coordinator = await this.userService.findEmailNameClient(
      coordId.toString()
    )
    if (!coordinator?.email || !collaborator) return
    if (
      coordinator.clientId &&
      collaborator.clientId &&
      coordinator.clientId.toString() !== collaborator.clientId.toString()
    )
      return
    const coordEmailEnabled = await this.userService.isEmailEnabled(
      coordId.toString()
    )

    let projectLabel = '—'
    try {
      const p = await this.projectService.findOne(
        advance.projectId.toString(),
        advance.clientId.toString()
      )
      projectLabel = `[${p.code} - ${p.name}]`
    } catch {
      /* use fallback */
    }

    const totalFormatted = this.formatViaticoMoney(advance.amount)
    const startStr = this.emailService.formatDateDDMMYYYY(
      advance.startDate as any
    )
    const endStr = this.emailService.formatDateDDMMYYYY(advance.endDate as any)

    const plainSummary = [
      `Colaborador: ${collaborator.name}`,
      `Lugar: ${advance.place ?? '—'}`,
      `Fechas: ${startStr} al ${endStr}`,
      `Proyecto: ${projectLabel}`,
      `Monto total: S/ ${totalFormatted}`,
    ].join('\n')

    const platformUrl = this.emailService.buildAppUrl('/tesoreria')

    this.notificationsService
      .create({
        userId: coordId.toString(),
        title: 'Solicitud de viáticos cancelada',
        message: `${collaborator.name} canceló su solicitud de viáticos para ${projectLabel} — S/ ${totalFormatted}.`,
        type: 'warning',
        actionUrl: '/viaticos',
      })
      .catch((err: unknown) => {
        this.logger.error(
          `In-app notif cancelación viático: ${err instanceof Error ? err.message : String(err)}`
        )
      })

    if (coordEmailEnabled) {
      await this.emailService.sendViaticoCancelacion(coordinator.email, {
        clientId: advance.clientId?.toString(),
        coordinatorName: coordinator.name,
        collaboratorName: collaborator.name,
        place: advance.place ?? '—',
        startDate: startStr,
        endDate: endStr,
        totalFormatted,
        projectLabel,
        plainSummary,
        platformUrl,
      })
    }
  }

  async getStats(clientId: string) {
    const [pending_l1, pending_l2, approved, paid, settled] = await Promise.all(
      [
        this.advanceModel.countDocuments({
          clientId: new Types.ObjectId(clientId),
          status: 'pending_l1',
        }),
        this.advanceModel.countDocuments({
          clientId: new Types.ObjectId(clientId),
          status: 'pending_l2',
        }),
        this.advanceModel.countDocuments({
          clientId: new Types.ObjectId(clientId),
          status: 'approved',
        }),
        this.advanceModel.countDocuments({
          clientId: new Types.ObjectId(clientId),
          status: 'paid',
        }),
        this.advanceModel.countDocuments({
          clientId: new Types.ObjectId(clientId),
          status: 'settled',
        }),
      ]
    )

    const totalAmountResult = await this.advanceModel.aggregate([
      {
        $match: {
          clientId: new Types.ObjectId(clientId),
          status: { $in: ['approved', 'partially_paid', 'paid', 'settled'] },
        },
      },
      // Desembolsado real: usa el acumulado pagado (paidAmount) cuando existe.
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ['$paidAmount', '$amount'] } },
        },
      },
    ])

    return {
      pending_l1,
      pending_l2,
      approved,
      paid,
      settled,
      totalApprovedAmount: totalAmountResult[0]?.total || 0,
    }
  }
}
