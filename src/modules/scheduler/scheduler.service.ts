import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Advance, AdvanceDocument } from '../advance/entities/advance.entity'
import { Expense, ExpenseDocument } from '../expense/entities/expense.entity'
import {
  ExpenseReport,
  ExpenseReportDocument,
} from '../expense-report/entities/expense-report.entity'
import { Client, ClientDocument } from '../client/entities/client.entity'
import { UserService } from '../user/user.service'
import { EmailService } from '../email/email.service'
import { NotificationsService } from '../notifications/notifications.service'

interface ReportEntry {
  _id: Types.ObjectId
  userId: Types.ObjectId
  title: string
  endDate?: Date
  viaticoEndDate?: Date
  startDate?: Date
  viaticoStartDate?: Date
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name)

  constructor(
    @InjectModel(Advance.name)
    private readonly advanceModel: Model<AdvanceDocument>,
    @InjectModel(Expense.name)
    private readonly expenseModel: Model<ExpenseDocument>,
    @InjectModel(ExpenseReport.name)
    private readonly expenseReportModel: Model<ExpenseReportDocument>,
    @InjectModel(Client.name)
    private readonly clientModel: Model<ClientDocument>,
    private readonly userService: UserService,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService
  ) {}

  @Cron('0 8 * * *')
  async handleDailyNotifications() {
    this.logger.log('[Scheduler] Iniciando cron de notificaciones diarias')
    try {
      await this.processNotifications()
    } catch (error) {
      this.logger.error('[Scheduler] Error en cron de notificaciones', error)
    }
  }

  /**
   * Envía los tres tipos de email de prueba a una dirección fija.
   * Solo disponible cuando EMAILS_ENABLED !== 'false' y existe SCHEDULER_TEST_KEY en el entorno.
   */
  async sendTestEmails(targetEmail: string): Promise<string[]> {
    const sent: string[] = []

    const sampleDate = this.formatDate(new Date())
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const sampleDateTomorrow = this.formatDate(tomorrow)

    // 1. Colaborador — recordatorio último día de viático
    await this.emailService.sendViaticoRecordatorioUltimoDia(targetEmail, {
      collaboratorName: 'Juan Colaborador (prueba)',
      place: 'Lima - Arequipa',
      endDate: sampleDate,
      platformUrl: this.emailService.buildAppUrl('/mis-rendiciones'),
    })
    sent.push('colaborador_ultimo_dia')

    // 2. Coordinador — recordatorio de rendiciones pendientes de revisión
    await this.emailService.sendRendicionRecordatorioCoordinador(targetEmail, {
      coordinatorName: 'María Coordinadora (prueba)',
      pendingCount: 2,
      reports: [
        { collaboratorName: 'Juan Pérez', title: 'Viaje a Arequipa - mayo', endDateFormatted: sampleDate },
        { collaboratorName: 'Ana García', title: 'Gastos de representación', endDateFormatted: sampleDateTomorrow },
      ],
      platformUrl: this.emailService.buildAppUrl('/invoice-approval'),
    })
    sent.push('coordinador_rendiciones')

    // 3. Contabilidad — recordatorio de rendiciones pendientes de aprobación contable
    await this.emailService.sendRendicionRecordatorioContabilidad(targetEmail, {
      recipientName: 'Carlos Contabilidad (prueba)',
      pendingCount: 3,
      reports: [
        { collaboratorName: 'Juan Pérez', title: 'Viaje a Arequipa - mayo', endDateFormatted: sampleDate },
        { collaboratorName: 'Ana García', title: 'Gastos de representación', endDateFormatted: sampleDateTomorrow },
        { collaboratorName: 'Luis Torres', title: 'Reunión con clientes - junio' },
      ],
      platformUrl: this.emailService.buildAppUrl('/tesoreria'),
    })
    sent.push('contabilidad_rendiciones')

    return sent
  }

  private async processNotifications() {
    const clients = await this.clientModel
      .find({ 'notificationSettings.enabled': true })
      .exec()

    const todayStart = this.startOfDay(new Date())

    for (const client of clients) {
      const frequency = client.notificationSettings!.frequency
      const notificationDay = client.notificationSettings!.notificationDay ?? 1
      const isWeeklyDay = this.isNotificationDay(frequency, notificationDay)

      await this.processViaticoAdvanceNotifications(
        client,
        frequency,
        isWeeklyDay,
        todayStart
      )
      await this.processCoordinatorRendicionReminders(
        client,
        isWeeklyDay,
        todayStart
      )
      await this.processContabilidadRendicionReminders(
        client,
        isWeeklyDay,
        todayStart
      )
    }
  }

  // ─── Viáticos (anticipo clásico) ─────────────────────────────────────────────

  private async processViaticoAdvanceNotifications(
    client: ClientDocument,
    frequency: 'semanal' | 'mensual',
    isNotificationDay: boolean,
    todayStart: Date
  ) {
    const advances = await this.advanceModel
      .find({
        clientId: client._id,
        status: { $in: ['approved', 'partially_paid', 'paid'] },
        startDate: { $exists: true, $ne: null },
        endDate: { $exists: true, $gte: todayStart },
      })
      .exec()

    for (const advance of advances) {
      try {
        await this.processAdvance(advance, frequency, isNotificationDay, todayStart)
      } catch (err) {
        this.logger.error(
          `[Scheduler] Error procesando advance ${advance._id}`,
          err
        )
      }
    }
  }

  private async processAdvance(
    advance: AdvanceDocument,
    frequency: 'semanal' | 'mensual',
    isNotificationDay: boolean,
    todayStart: Date
  ) {
    const startDate = advance.startDate!
    const endDate = advance.endDate!

    // Último día: se notifica siempre, independientemente de la duración
    if (this.isSameDay(endDate, todayStart)) {
      await this.sendLastDayReminder(advance)
    }

    const durationDays = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    )

    if (durationDays > 15 && isNotificationDay) {
      await this.processLongAdvance(advance, frequency)
    }
  }

  private async processLongAdvance(
    advance: AdvanceDocument,
    frequency: 'semanal' | 'mensual'
  ) {
    if (!advance.expenseReportId) return

    const periodDays = frequency === 'semanal' ? 7 : 30
    const periodStart = new Date()
    periodStart.setDate(periodStart.getDate() - periodDays)

    const collaborator = await this.userService.findEmailNameClient(
      advance.userId.toString()
    )
    if (!collaborator) return

    const recentExpenses = await this.expenseModel
      .countDocuments({
        expenseReportId: advance.expenseReportId,
        createdAt: { $gte: periodStart },
      })
      .exec()

    if (recentExpenses === 0) {
      await this.notifyCollaboratorReminder(collaborator, advance, frequency)
    }

    if (!advance.coordinatorId) return

    const pendingCount = await this.expenseModel
      .countDocuments({
        expenseReportId: advance.expenseReportId,
        status: 'pending',
      })
      .exec()

    if (pendingCount > 0) {
      const coordinator = await this.userService.findEmailNameClient(
        advance.coordinatorId.toString()
      )
      if (coordinator) {
        await this.notifyCoordinatorSummary(
          coordinator,
          collaborator,
          advance,
          pendingCount,
          frequency
        )
      }
    }
  }

  private async notifyCollaboratorReminder(
    collaborator: { email: string; name: string },
    advance: AdvanceDocument,
    frequency: 'semanal' | 'mensual'
  ) {
    const platformUrl = this.emailService.buildAppUrl('/mis-rendiciones')

    this.notificationsService
      .create({
        userId: advance.userId.toString(),
        title: 'Recordatorio de rendición',
        message: `Tienes viáticos activos sin comprobantes cargados esta ${frequency === 'semanal' ? 'semana' : 'quincena/mes'}. Recuerda rendir tus gastos.`,
        type: 'warning',
        actionUrl: '/mis-rendiciones',
        metadata: {
          advanceId: advance._id,
          event: 'recordatorio_rendicion',
          frequency,
        },
      })
      .catch(err =>
        this.logger.error('Error notif in-app colaborador recordatorio', err)
      )

    const collabEmailEnabled = await this.userService.isEmailEnabled(
      advance.userId.toString()
    )
    if (!collabEmailEnabled) return

    this.emailService
      .sendViaticoRecordatorioColaborador(collaborator.email, {
        clientId: advance.clientId?.toString(),
        collaboratorName: collaborator.name,
        place: advance.place || '',
        startDate: this.formatDate(advance.startDate!),
        endDate: this.formatDate(advance.endDate!),
        frequency,
        platformUrl,
      })
      .catch(err =>
        this.logger.error('Error email recordatorio colaborador', err)
      )
  }

  private async notifyCoordinatorSummary(
    coordinator: { email: string; name: string },
    collaborator: { email: string; name: string },
    advance: AdvanceDocument,
    pendingCount: number,
    frequency: 'semanal' | 'mensual'
  ) {
    const platformUrl = this.emailService.buildAppUrl('/invoice-approval')

    this.notificationsService
      .create({
        userId: (advance.coordinatorId as Types.ObjectId).toString(),
        title: 'Gastos pendientes de revisión',
        message: `${collaborator.name} tiene ${pendingCount} comprobante(s) pendiente(s) de aprobación en viáticos activos.`,
        type: 'info',
        actionUrl: '/invoice-approval',
        metadata: {
          advanceId: advance._id,
          collaboratorId: advance.userId,
          event: 'resumen_coordinador',
          frequency,
        },
      })
      .catch(err =>
        this.logger.error('Error notif in-app coordinador resumen', err)
      )

    const coordinatorEmailEnabled = await this.userService.isEmailEnabled(
      (advance.coordinatorId as Types.ObjectId).toString()
    )
    if (!coordinatorEmailEnabled) return

    this.emailService
      .sendViaticoResumenCoordinador(coordinator.email, {
        clientId: advance.clientId?.toString(),
        coordinatorName: coordinator.name,
        collaboratorName: collaborator.name,
        place: advance.place || '',
        startDate: this.formatDate(advance.startDate!),
        endDate: this.formatDate(advance.endDate!),
        pendingCount,
        frequency,
        platformUrl,
      })
      .catch(err => this.logger.error('Error email resumen coordinador', err))
  }

  private async sendLastDayReminder(advance: AdvanceDocument) {
    const collaborator = await this.userService.findEmailNameClient(
      advance.userId.toString()
    )
    if (!collaborator) return

    const platformUrl = this.emailService.buildAppUrl('/mis-rendiciones')

    this.notificationsService
      .create({
        userId: advance.userId.toString(),
        title: 'Hoy vence tu periodo de viáticos',
        message:
          'Hoy es el último día de tu periodo de viáticos. Recuerda cargar todos tus comprobantes.',
        type: 'warning',
        actionUrl: '/mis-rendiciones',
        metadata: { advanceId: advance._id, event: 'recordatorio_ultimo_dia' },
      })
      .catch(err => this.logger.error('Error notif in-app último día', err))

    const emailEnabled = await this.userService.isEmailEnabled(
      advance.userId.toString()
    )
    if (!emailEnabled) return

    this.emailService
      .sendViaticoRecordatorioUltimoDia(collaborator.email, {
        clientId: advance.clientId?.toString(),
        collaboratorName: collaborator.name,
        place: advance.place || '',
        endDate: this.formatDate(advance.endDate!),
        platformUrl,
      })
      .catch(err => this.logger.error('Error email último día', err))
  }

  // ─── Recordatorios semanales de rendiciones para coordinadores ───────────────

  private async processCoordinatorRendicionReminders(
    client: ClientDocument,
    isWeeklyDay: boolean,
    todayStart: Date
  ) {
    const submitted = await this.expenseReportModel
      .find({ clientId: client._id, status: 'submitted' })
      .select('_id userId title endDate viaticoEndDate startDate viaticoStartDate')
      .lean<ReportEntry[]>()
      .exec()

    if (submitted.length === 0) return

    // Agrupa las rendiciones por coordinador
    const coordinatorMap = new Map<
      string,
      {
        name: string
        email: string
        userId: string
        reports: { collaboratorName: string; title: string; endDateFormatted?: string }[]
      }
    >()

    for (const report of submitted) {
      const isUrgent = this.isUrgentReport(report, todayStart)
      if (!isWeeklyDay && !isUrgent) continue

      const coordId = await this.userService.findUserCoordinatorId(
        report.userId.toString()
      )
      if (!coordId) continue

      const coordKey = coordId.toString()
      if (!coordinatorMap.has(coordKey)) {
        const coord = await this.userService.findEmailNameClient(coordKey)
        if (!coord) continue
        coordinatorMap.set(coordKey, {
          name: coord.name,
          email: coord.email,
          userId: coordKey,
          reports: [],
        })
      }

      const collab = await this.userService.findEmailNameClient(
        report.userId.toString()
      )
      const deadline = report.viaticoEndDate || report.endDate
      coordinatorMap.get(coordKey)!.reports.push({
        collaboratorName: collab?.name ?? 'Colaborador',
        title: report.title || 'Sin título',
        endDateFormatted: deadline ? this.formatDate(deadline) : undefined,
      })
    }

    const platformUrl = this.emailService.buildAppUrl('/invoice-approval')

    for (const [coordId, { name, email, reports }] of coordinatorMap) {
      if (reports.length === 0) continue

      this.notificationsService
        .create({
          userId: coordId,
          title: 'Rendiciones pendientes de revisión',
          message: `Tienes ${reports.length} rendicion(es) enviadas por tus colaboradores esperando tu aprobacion.`,
          type: 'warning',
          actionUrl: '/invoice-approval',
          metadata: { event: 'recordatorio_rendicion_coordinador', count: reports.length },
        })
        .catch(err => this.logger.error('Error notif in-app coordinador rendicion', err))

      const emailEnabled = await this.userService.isEmailEnabled(coordId)
      if (!emailEnabled) continue

      this.emailService
        .sendRendicionRecordatorioCoordinador(email, {
          clientId: client._id?.toString(),
          coordinatorName: name,
          pendingCount: reports.length,
          reports,
          platformUrl,
        })
        .catch(err => this.logger.error('Error email recordatorio coordinador rendicion', err))
    }
  }

  // ─── Recordatorios semanales de rendiciones para contabilidad ─────────────────

  private async processContabilidadRendicionReminders(
    client: ClientDocument,
    isWeeklyDay: boolean,
    todayStart: Date
  ) {
    const pendingAccounting = await this.expenseReportModel
      .find({ clientId: client._id, status: 'pending_accounting' })
      .select('_id userId title endDate viaticoEndDate startDate viaticoStartDate')
      .lean<ReportEntry[]>()
      .exec()

    if (pendingAccounting.length === 0) return

    // Filtra solo los que aplican hoy (semanal o urgente)
    const reportsToNotify: {
      collaboratorName: string
      title: string
      endDateFormatted?: string
    }[] = []

    for (const report of pendingAccounting) {
      const isUrgent = this.isUrgentReport(report, todayStart)
      if (!isWeeklyDay && !isUrgent) continue

      const collab = await this.userService.findEmailNameClient(
        report.userId.toString()
      )
      const deadline = report.viaticoEndDate || report.endDate
      reportsToNotify.push({
        collaboratorName: collab?.name ?? 'Colaborador',
        title: report.title || 'Sin título',
        endDateFormatted: deadline ? this.formatDate(deadline) : undefined,
      })
    }

    if (reportsToNotify.length === 0) return

    const recipients = await this.userService.findRendicionApprovalUsers(
      (client._id as Types.ObjectId).toString()
    )
    if (recipients.length === 0) return

    const platformUrl = this.emailService.buildAppUrl('/tesoreria')

    for (const recipient of recipients) {
      // In-app: siempre, sin importar preferencia de correo
      this.notificationsService
        .create({
          userId: recipient._id,
          title: 'Rendiciones pendientes de aprobación contable',
          message: `Hay ${reportsToNotify.length} rendicion(es) aprobadas por coordinacion esperando tu aprobacion final.`,
          type: 'info',
          actionUrl: '/tesoreria',
          metadata: {
            event: 'recordatorio_rendicion_contabilidad',
            count: reportsToNotify.length,
          },
        })
        .catch(err => this.logger.error('Error notif in-app contabilidad rendicion', err))

      // Email: solo si el usuario tiene notificaciones por correo habilitadas
      if (!recipient.emailNotificationsEnabled) continue

      this.emailService
        .sendRendicionRecordatorioContabilidad(recipient.email, {
          clientId: client._id?.toString(),
          recipientName: recipient.name,
          pendingCount: reportsToNotify.length,
          reports: reportsToNotify,
          platformUrl,
        })
        .catch(err => this.logger.error('Error email recordatorio contabilidad rendicion', err))
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Una rendición es "urgente" si su plazo (endDate o viaticoEndDate) cae mañana
   * y la duración total del periodo es menor a 7 días.
   * Esto dispara la notificación un día antes, sin esperar el día semanal configurado.
   */
  private isUrgentReport(
    report: Pick<
      ReportEntry,
      'endDate' | 'viaticoEndDate' | 'startDate' | 'viaticoStartDate'
    >,
    todayStart: Date
  ): boolean {
    const endDate = report.viaticoEndDate || report.endDate
    const startDate = report.viaticoStartDate || report.startDate
    if (!endDate || !startDate) return false

    const durationDays = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    )
    if (durationDays >= 7) return false

    const tomorrow = new Date(todayStart)
    tomorrow.setDate(tomorrow.getDate() + 1)
    return this.isSameDay(endDate, tomorrow)
  }

  private isNotificationDay(
    frequency: 'semanal' | 'mensual',
    notificationDay: number
  ): boolean {
    const today = new Date()
    if (frequency === 'semanal') {
      return today.getDay() === notificationDay
    }
    return today.getDate() === 1
  }

  private isSameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    )
  }

  private startOfDay(date: Date): Date {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    return d
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('es-PE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }
}
