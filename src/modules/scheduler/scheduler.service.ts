import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Advance, AdvanceDocument } from '../advance/entities/advance.entity'
import { Expense, ExpenseDocument } from '../expense/entities/expense.entity'
import { Client, ClientDocument } from '../client/entities/client.entity'
import { UserService } from '../user/user.service'
import { EmailService } from '../email/email.service'
import { NotificationsService } from '../notifications/notifications.service'

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name)

  constructor(
    @InjectModel(Advance.name) private readonly advanceModel: Model<AdvanceDocument>,
    @InjectModel(Expense.name) private readonly expenseModel: Model<ExpenseDocument>,
    @InjectModel(Client.name) private readonly clientModel: Model<ClientDocument>,
    private readonly userService: UserService,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Cron('0 8 * * *')
  async handleDailyNotifications() {
    this.logger.log('[Scheduler] Iniciando cron de notificaciones de viáticos')
    try {
      await this.processNotifications()
    } catch (error) {
      this.logger.error('[Scheduler] Error en cron de notificaciones', error)
    }
  }

  private async processNotifications() {
    const clients = await this.clientModel
      .find({ 'notificationSettings.enabled': true })
      .exec()

    for (const client of clients) {
      const frequency = client.notificationSettings!.frequency
      const isNotificationDay = this.isNotificationDay(frequency)
      const todayStart = this.startOfDay(new Date())

      const advances = await this.advanceModel
        .find({
          clientId: client._id,
          status: { $in: ['approved', 'paid'] },
          startDate: { $exists: true, $ne: null },
          endDate: { $exists: true, $gte: todayStart },
        })
        .exec()

      for (const advance of advances) {
        try {
          await this.processAdvance(advance, frequency, isNotificationDay, todayStart)
        } catch (err) {
          this.logger.error(`[Scheduler] Error procesando advance ${advance._id}`, err)
        }
      }
    }
  }

  private async processAdvance(
    advance: AdvanceDocument,
    frequency: 'semanal' | 'mensual',
    isNotificationDay: boolean,
    todayStart: Date,
  ) {
    const startDate = advance.startDate!
    const endDate = advance.endDate!
    const durationDays = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    )

    if (durationDays > 15) {
      if (!isNotificationDay) return
      await this.processLongAdvance(advance, frequency)
    } else {
      if (this.isSameDay(endDate, todayStart)) {
        await this.sendLastDayReminder(advance)
      }
    }
  }

  private async processLongAdvance(advance: AdvanceDocument, frequency: 'semanal' | 'mensual') {
    if (!advance.expenseReportId) return

    const periodDays = frequency === 'semanal' ? 7 : 30
    const periodStart = new Date()
    periodStart.setDate(periodStart.getDate() - periodDays)

    const collaborator = await this.userService.findEmailNameClient(advance.userId.toString())
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
        (advance.coordinatorId as Types.ObjectId).toString(),
      )
      if (coordinator) {
        await this.notifyCoordinatorSummary(coordinator, collaborator, advance, pendingCount, frequency)
      }
    }
  }

  private async notifyCollaboratorReminder(
    collaborator: { email: string; name: string },
    advance: AdvanceDocument,
    frequency: 'semanal' | 'mensual',
  ) {
    const platformUrl = this.emailService.buildAppUrl('/mis-rendiciones')

    this.notificationsService
      .create({
        userId: advance.userId.toString(),
        title: 'Recordatorio de rendición',
        message: `Tienes viáticos activos sin comprobantes cargados esta ${frequency === 'semanal' ? 'semana' : 'quincena/mes'}. Recuerda rendir tus gastos.`,
        type: 'warning',
        actionUrl: '/mis-rendiciones',
        metadata: { advanceId: advance._id, event: 'recordatorio_rendicion', frequency },
      })
      .catch(err => this.logger.error('Error notif in-app colaborador recordatorio', err))

    const collabEmailEnabled = await this.userService.isEmailEnabled(advance.userId.toString())
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
      .catch(err => this.logger.error('Error email recordatorio colaborador', err))
  }

  private async notifyCoordinatorSummary(
    coordinator: { email: string; name: string },
    collaborator: { email: string; name: string },
    advance: AdvanceDocument,
    pendingCount: number,
    frequency: 'semanal' | 'mensual',
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
      .catch(err => this.logger.error('Error notif in-app coordinador resumen', err))

    const coordinatorEmailEnabled = await this.userService.isEmailEnabled(
      (advance.coordinatorId as Types.ObjectId).toString(),
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
    const collaborator = await this.userService.findEmailNameClient(advance.userId.toString())
    if (!collaborator) return

    const platformUrl = this.emailService.buildAppUrl('/mis-rendiciones')

    this.notificationsService
      .create({
        userId: advance.userId.toString(),
        title: 'Hoy vence tu periodo de viáticos',
        message: 'Hoy es el último día de tu periodo de viáticos. Recuerda cargar todos tus comprobantes.',
        type: 'warning',
        actionUrl: '/mis-rendiciones',
        metadata: { advanceId: advance._id, event: 'recordatorio_ultimo_dia' },
      })
      .catch(err => this.logger.error('Error notif in-app último día', err))

    const emailEnabled = await this.userService.isEmailEnabled(advance.userId.toString())
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

  private isNotificationDay(frequency: 'semanal' | 'mensual'): boolean {
    const today = new Date()
    return frequency === 'semanal' ? today.getDay() === 1 : today.getDate() === 1
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
