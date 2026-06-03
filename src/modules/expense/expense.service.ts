import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { CreateExpenseDto } from './dto/create-expense.dto'
import { UpdateExpenseDto } from './dto/update-expense.dto'
import { ConfigService } from '@nestjs/config'
import { Model, Types } from 'mongoose'
import { Expense } from './entities/expense.entity'
import { InjectModel } from '@nestjs/mongoose'
import { EmailService } from '../email/email.service'
import { PROMPT1 } from './constants/prompt1'
import OpenAI from 'openai'
import { ApprovalDto } from './dto/approval.dto'
import { ProjectService } from '../project/project.service'
import { SunatConfigService } from '../sunat-config/sunat-config.service'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { UserService } from '../user/user.service'
import { UploadService } from '../upload/upload.service'
import { ExpenseReportService } from '../expense-report/expense-report.service'
import { ROLES } from '../auth/enums/roles.enum'
import { NotificationsService } from '../notifications/notifications.service'
import { CategoryService } from '../category/category.service'
import { Client } from '../client/entities/client.entity'
import {
  applyFechaEmisionDisplayToExpense,
  applyFechaEmisionDisplayToExpenses,
  formatFechaEmisionDdMmYyyy,
  normalizeFechaEmisionInDataJson,
  parseFechaEmisionInput,
} from './utils/fecha-emision.util'

/** Usuario autenticado para autorización de gastos (PATCH/DELETE/GET). */
export interface ExpenseActorContext {
  userId: string
  roleName: string
  clientId?: string
}

// Tipos auxiliares
interface ExtractedInvoiceData {
  rucEmisor?: string
  serie?: string
  correlativo?: string
  fechaEmision?: string
  montoTotal?: number
  tipoComprobante?: string
  moneda?: string
  razonSocial?: string
  direccionEmisor?: string
  comentario?: string
  placaVehiculo?: string
  [key: string]: unknown
}

interface SunatValidationMeta {
  status: string
  details: unknown
  message: string
}

@Injectable()
export class ExpenseService {
  private readonly logger = new Logger(ExpenseService.name)
  private readonly openai: OpenAI
  private readonly visionModel = 'gpt-5.1'

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(Expense.name)
    private expenseRepository: Model<Expense>,
    @InjectModel(Client.name)
    private clientModel: Model<Client>,
    private readonly emailService: EmailService,
    private readonly projectService: ProjectService,
    private readonly userService: UserService,
    private readonly sunatConfigService: SunatConfigService,
    private readonly httpService: HttpService,
    private readonly uploadService: UploadService,
    private readonly expenseReportService: ExpenseReportService,
    private readonly notificationsService: NotificationsService,
    private readonly categoryService: CategoryService
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')
    if (!apiKey) {
      throw new Error('OpenAI API key is not configured.')
    }
    this.openai = new OpenAI({ apiKey })
  }

  private normalizeClientId(raw: unknown): string {
    if (raw == null) return ''
    if (typeof raw === 'object' && raw !== null && '_id' in raw) {
      return String((raw as { _id: unknown })._id)
    }
    return String(raw)
  }

  private expenseReportIdString(expense: Expense): string | null {
    const raw = (
      expense as unknown as {
        expenseReportId?: Types.ObjectId | { _id: Types.ObjectId } | null
      }
    ).expenseReportId
    if (!raw) return null
    if (typeof raw === 'object' && '_id' in raw) {
      return String((raw as { _id: Types.ObjectId })._id)
    }
    return String(raw)
  }

  private assertCompanyAccess(
    expense: Expense,
    actor: ExpenseActorContext
  ): void {
    if (actor.roleName === ROLES.SUPER_ADMIN || actor.roleName === ROLES.CONTABILIDAD) return
    const expClient = this.normalizeClientId(
      (expense as unknown as { clientId: unknown }).clientId
    )
    const userClient = this.normalizeClientId(actor.clientId)
    if (!userClient || expClient !== userClient) {
      throw new ForbiddenException('No autorizado para acceder a este gasto')
    }
  }

  private assertCanReadExpense(
    expense: Expense,
    actor: ExpenseActorContext
  ): void {
    this.assertCompanyAccess(expense, actor)
    if (actor.roleName === ROLES.COLABORADOR) {
      const ownerId = String(expense.createdBy || '').trim()
      if (!ownerId || ownerId !== actor.userId) {
        throw new ForbiddenException('Solo puedes ver tus propios comprobantes')
      }
    }
  }

  private async assertCanMutateExpense(
    expense: Expense,
    actor: ExpenseActorContext
  ): Promise<void> {
    this.assertCanReadExpense(expense, actor)
    if (actor.roleName !== ROLES.COLABORADOR) return
    const status = expense.status || 'pending'
    if (status === 'approved' || status === 'rejected') {
      throw new ForbiddenException(
        'No puedes modificar un comprobante ya aprobado o rechazado.'
      )
    }
    const reportId = this.expenseReportIdString(expense)
    if (reportId) {
      const report = await this.expenseReportService.findOne(reportId)
      if (report.status !== 'open' && report.status !== 'rejected') {
        throw new ForbiddenException(
          'Solo puedes editar o eliminar gastos en rendiciones abiertas o rechazadas.'
        )
      }
    }
  }

  private async loadExpenseOrThrow(id: string): Promise<Expense> {
    const expense = await this.findOne(id)
    if (!expense) {
      throw new NotFoundException(`Gasto con ID ${id} no encontrado`)
    }
    return expense
  }

  // Construcción del mensaje para Vision
  private buildVisionMessages(prompt: string, imageUrl: string) {
    return [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: prompt },
          { type: 'image_url' as const, image_url: { url: imageUrl } },
        ],
      },
    ]
  }

  // Parseo robusto del contenido JSON devuelto por OpenAI
  private parseOpenAiJsonContent(
    content?: string | null
  ): ExtractedInvoiceData {
    const safe = (content || '')
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()
    try {
      return JSON.parse(safe)
    } catch (error) {
      this.logger.error('No se pudo parsear la respuesta de OpenAI', error)
      throw new HttpException(
        'Respuesta inválida del analizador de imagen.',
        HttpStatus.BAD_GATEWAY
      )
    }
  }

  private determineCodComp(tipo?: string): string {
    if (tipo === 'Factura') return '01'
    if (tipo === 'Boleta') return '03'
    return '01'
  }

  private formatDateForSunat(dateStr?: string): string | undefined {
    if (!dateStr) return undefined
    return dateStr.replace(/-/g, '/')
  }

  private parseExpenseDate(raw?: string | Date | null): Date | null {
    return parseFechaEmisionInput(raw ?? undefined)
  }

  private normalizeFechaEmisionValue(
    raw?: string | Date | null
  ): string | undefined {
    return formatFechaEmisionDdMmYyyy(raw ?? undefined)
  }

  private sanitizeFechaEmisionOnWrite(
    dto: Partial<CreateExpenseDto | UpdateExpenseDto>
  ): void {
    if (dto.fechaEmision != null && dto.fechaEmision !== '') {
      const normalized = this.normalizeFechaEmisionValue(
        dto.fechaEmision as string | Date
      )
      if (normalized) dto.fechaEmision = normalized
    }
    if (dto.data != null && typeof dto.data === 'string') {
      dto.data = normalizeFechaEmisionInDataJson(dto.data) ?? dto.data
    }
  }

  /** Mantiene comentario/placa en raíz del gasto alineados con el JSON `data`. */
  private syncComentarioPlacaFromData(
    dto: Partial<CreateExpenseDto | UpdateExpenseDto>
  ): void {
    if (dto.data == null || typeof dto.data !== 'string') return
    try {
      const parsed = JSON.parse(dto.data) as Record<string, unknown>
      if (dto.comentario === undefined && typeof parsed.comentario === 'string') {
        const c = parsed.comentario.trim()
        if (c) dto.comentario = c
      }
      if (
        dto.placaVehiculo === undefined &&
        typeof parsed.placaVehiculo === 'string'
      ) {
        const p = parsed.placaVehiculo.trim()
        if (p) dto.placaVehiculo = p
      }
    } catch {
      /* mantener dto original */
    }
  }

  private evaluateDeadline(fechaEmisionRaw?: string | null): {
    observado: boolean
    observacionPlazo?: string
    diasRetraso?: number
  } {
    void fechaEmisionRaw
    return { observado: false }
  }

  private async evaluateCategoryLimit(
    body: CreateExpenseDto,
    amount: number
  ): Promise<{ percent?: number; warning?: string }> {
    if (!body.expenseReportId || !body.categoryId || !body.clientId || amount <= 0) {
      return {}
    }

    const category = await this.categoryService.findOne(body.categoryId, body.clientId)
    const limit = Number(category?.limit ?? 0)
    if (!limit || Number.isNaN(limit) || limit <= 0) return {}

    const aggregation = await this.expenseRepository.aggregate([
      {
        $match: {
          expenseReportId: new Types.ObjectId(body.expenseReportId),
          categoryId: new Types.ObjectId(body.categoryId),
          status: { $ne: 'rejected' },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ['$total', 0] } },
        },
      },
    ])

    const current = Number(aggregation?.[0]?.total ?? 0)
    const projected = current + amount
    const percent = Number(((projected / limit) * 100).toFixed(2))

    if (percent >= 100) {
      throw new BadRequestException(
        `Límite de categoría alcanzado. No se permiten más gastos en esta categoría. Solicite ampliación de presupuesto.`
      )
    }

    if (percent >= 90) {
      return {
        percent,
        warning:
          'Ha utilizado el 90% del presupuesto de esta categoría. Si requiere más fondos, solicite una ampliación de presupuesto antes de continuar.',
      }
    }

    return { percent }
  }

  private buildUserInitials(name?: string | null): string {
    const raw = String(name || '').trim()
    if (!raw) return 'USR'

    // Formato esperado en BD: "APELLIDO1 APELLIDO2, NOMBRE [NOMBRE2 ...]"
    // Resultado deseado: inicial(NOMBRE) + inicial(APELLIDO1) + inicial(APELLIDO2)
    // Ej: "SALAZAR PEREZ, CHRISTIAN" -> "CSP"
    //     "CARRASCO PERALTA, CHRISTIAN WILMER" -> "CCP"
    if (raw.includes(',')) {
      const [apellidosPart = '', nombresPart = ''] = raw.split(',', 2)
      const apellidos = apellidosPart.trim().split(/\s+/).filter(Boolean)
      const nombres = nombresPart.trim().split(/\s+/).filter(Boolean)
      const nombreInicial = nombres[0]?.charAt(0).toUpperCase() ?? ''
      const apellido1Inicial = apellidos[0]?.charAt(0).toUpperCase() ?? ''
      const apellido2Inicial = apellidos[1]?.charAt(0).toUpperCase() ?? ''
      const initials = `${nombreInicial}${apellido1Inicial}${apellido2Inicial}`
      if (initials) return initials.padEnd(3, 'X').slice(0, 3)
    }

    // Fallback (sin coma): asumir orden "NOMBRE APELLIDO1 APELLIDO2".
    const words = raw.split(/\s+/).filter(Boolean)
    const initials = words
      .slice(0, 3)
      .map(w => w.charAt(0).toUpperCase())
      .join('')
    return initials.padEnd(3, 'X').slice(0, 3)
  }

  private async resolveOwnerUserId(
    fallbackUserId: string | undefined,
    expenseReportId: string | undefined
  ): Promise<string | undefined> {
    if (expenseReportId) {
      try {
        const report = await this.expenseReportService.findOne(expenseReportId)
        const reportUserId = (report as any)?.userId
        if (reportUserId) {
          if (typeof reportUserId === 'object' && '_id' in reportUserId) {
            return String((reportUserId as { _id: unknown })._id)
          }
          return String(reportUserId)
        }
      } catch {
        // Si la rendición no se puede resolver, caemos al userId del creador.
      }
    }
    return fallbackUserId
  }

  private async generateInternalCode(
    userId: string | undefined,
    expenseType: 'planilla_movilidad' | 'comprobante_caja',
    expenseReportId?: string
  ): Promise<string> {
    const ownerUserId = await this.resolveOwnerUserId(userId, expenseReportId)
    if (!ownerUserId) return `USR001`
    const user = await this.userService.findOne(ownerUserId)
    const initials = this.buildUserInitials(user?.name)
    const count = await this.expenseRepository.countDocuments({
      createdBy: ownerUserId,
      expenseType,
    })
    const correlativo = String(count + 1).padStart(3, '0')
    return `${initials}${correlativo}`
  }

  private async validateDuplicateInvoiceIfAny(
    data: ExtractedInvoiceData,
    clientId: string
  ): Promise<void> {
    if (data.serie && data.correlativo && data.rucEmisor) {
      const existingInvoice = await this.findBySeriAndCorrelativo(
        data.serie,
        data.correlativo,
        clientId,
        data.rucEmisor
      )
      if (existingInvoice) {
        throw new HttpException(
          `Ya existe una factura/boleta del emisor con RUC ${data.rucEmisor} y número ${data.serie}-${data.correlativo}`,
          HttpStatus.CONFLICT
        )
      }
    }
  }

  private async validateWithSunatIfPossible(
    data: ExtractedInvoiceData,
    clientId: string,
    companyRuc: string | undefined
  ): Promise<{ validation: SunatValidationMeta; expenseStatus: string }> {
    let validation: SunatValidationMeta = {
      status: 'PENDING',
      details: null,
      message: 'Validación pendiente',
    }
    let expenseStatus = 'pending'

    if (data.rucEmisor && data.serie && data.correlativo && companyRuc) {
      try {
        const sunatApiUrl = `https://api.sunat.gob.pe/v1/contribuyente/contribuyentes/${companyRuc}/validarcomprobante`
        this.logger.log(`Usando RUC empresa para consulta SUNAT: ${companyRuc}`)

        const sunatToken = await this.generateTokenSunat(clientId)
        if (sunatToken?.access_token) {
          const fechaEmision = this.formatDateForSunat(data.fechaEmision)

          const params = {
            numRuc: data.rucEmisor,
            codComp: this.determineCodComp(data.tipoComprobante),
            numeroSerie: data.serie,
            numero: data.correlativo,
            fechaEmision: fechaEmision,
            monto:
              typeof data.montoTotal === 'number' && data.montoTotal > 0
                ? data.montoTotal.toFixed(2)
                : undefined,
          }

          const headers = {
            Authorization: `Bearer ${sunatToken.access_token}`,
            'Content-Type': 'application/json',
          }

          try {
            const response = await firstValueFrom(
              this.httpService.post(sunatApiUrl, params, { headers })
            )
            console.log('[SUNAT] Raw response:', JSON.stringify(response.data, null, 2))
            validation = this.interpretSunatResponse(response.data)
            expenseStatus = validation.status
          } catch (error) {
            expenseStatus = 'sunat_error'
            validation = {
              status: 'ERROR_SUNAT',
              details: (error as Error).message,
              message: 'Error en la comunicación con SUNAT.',
            }
          }
        } else {
          expenseStatus = 'sunat_error'
        }
      } catch {
        expenseStatus = 'sunat_error'
      }
    }

    return { validation, expenseStatus }
  }

  private async createExpenseDocument(
    body: CreateExpenseDto,
    data: ExtractedInvoiceData,
    validation: SunatValidationMeta,
    status: string
  ) {
    if (!body.clientId) {
      throw new HttpException('clientId es requerido', HttpStatus.BAD_REQUEST)
    }

    const categoryObject = Types.ObjectId.createFromHexString(body.categoryId)
    const projectObject = Types.ObjectId.createFromHexString(body.proyectId)

    const normalizedFechaEmision = this.normalizeFechaEmisionValue(
      data.fechaEmision
    )
    const dataPayload = {
      ...data,
      fechaEmision: normalizedFechaEmision ?? data.fechaEmision,
      sunatValidation: validation,
    }

    const deadlineMeta = this.evaluateDeadline(dataPayload.fechaEmision)
    const amount = Number(data.montoTotal ?? 0)
    const categoryMeta = await this.evaluateCategoryLimit(body, amount)

    return this.expenseRepository.create({
      categoryId: categoryObject,
      proyectId: projectObject,
      clientId: body.clientId,
      expenseReportId: body.expenseReportId
        ? new Types.ObjectId(body.expenseReportId)
        : undefined,
      total: data.montoTotal,
      data: JSON.stringify(dataPayload),
      file: body.imageUrl,
      status: status,
      createdBy: body.userId || 'system',
      fechaEmision: dataPayload.fechaEmision,
      observado: deadlineMeta.observado,
      observacionPlazo: deadlineMeta.observacionPlazo,
      diasRetraso: deadlineMeta.diasRetraso,
      categoryLimitPercent: categoryMeta.percent,
      categoryLimitWarning: categoryMeta.warning,
      comentario: data.comentario || undefined,
      placaVehiculo: data.placaVehiculo || undefined,
    })
  }

  private async getCreatorName(userId?: string | null): Promise<string> {
    if (!userId) return 'Usuario del sistema'
    try {
      const creator = await this.userService.findOne(userId)
      return creator?.name || 'Usuario del sistema'
    } catch {
      this.logger.warn('No se pudo obtener información del usuario creador')
      return 'Usuario del sistema'
    }
  }

  private buildNotificationPayload(
    data: ExtractedInvoiceData,
    body: CreateExpenseDto,
    projectName: string,
    creatorName: string,
    categoryName: string
  ) {
    return {
      clientId: body.clientId,
      providerName: creatorName,
      invoiceNumber: `${data.serie || ''}-${data.correlativo || ''}`,
      date: data.fechaEmision || new Date().toISOString().split('T')[0],
      type: data.tipoComprobante || 'Factura',
      status: 'PENDIENTE',
      montoTotal: data.montoTotal || 0,
      moneda: data.moneda || 'PEN',
      createdBy: creatorName,
      category: categoryName || 'No especificada',
      projectName: projectName || 'No especificado',
      razonSocial: data.razonSocial || 'No especificada',
      direccionEmisor: data.direccionEmisor,
    }
  }

  private async notifyStakeholders(
    body: CreateExpenseDto,
    data: ExtractedInvoiceData,
    projectName: string
  ) {
    const creatorName = await this.getCreatorName(body.userId)
    let categoryName = 'No especificada'

    if (body.categoryId && body.clientId) {
      try {
        const category = await this.categoryService.findOne(
          body.categoryId,
          body.clientId
        )
        categoryName = category?.name || categoryName
      } catch (error) {
        this.logger.warn(
          `No se pudo obtener el nombre de la categoría ${body.categoryId}:`,
          error
        )
      }
    }

    const notificationPayload = this.buildNotificationPayload(
      data,
      body,
      projectName,
      creatorName,
      categoryName
    )

    // Destinatarios: solo los involucrados — dueño de la rendición, su
    // coordinador y Contabilidad. Sin broadcast a todos los usuarios del cliente.
    const seen = new Set<string>()
    const sendTo = async (email?: string | null, userId?: string | null) => {
      const e = email?.trim()
      if (!e) return
      const key = e.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      try {
        if (userId) {
          const enabled = await this.userService.isEmailEnabled(userId)
          if (!enabled) return
        }
        await this.emailService.sendInvoiceUploadedExpenseNotification(
          e,
          notificationPayload
        )
      } catch (err) {
        this.logger.warn(`Error notificando subida de gasto a ${e}:`, err)
      }
    }

    // Resolver dueño de la rendición vinculada (si existe).
    let reportOwnerId: string | undefined
    if (body.expenseReportId) {
      try {
        const report = await this.expenseReportService.findOne(body.expenseReportId)
        const ownerRef = (report as any)?.userId
        reportOwnerId = ownerRef?._id
          ? String(ownerRef._id)
          : ownerRef
            ? String(ownerRef)
            : undefined
      } catch (err) {
        this.logger.warn(
          `No se pudo obtener la rendición ${body.expenseReportId}:`,
          err
        )
      }
    }

    // 1) Dueño de la rendición (o creador si no hay rendición).
    const ownerCandidate = reportOwnerId || body.userId || undefined
    if (ownerCandidate) {
      try {
        const owner = await this.userService.findOne(ownerCandidate)
        await sendTo(owner?.email, ownerCandidate)
      } catch (err) {
        this.logger.warn('No se pudo notificar al dueño del gasto/rendición:', err)
      }
    }

    // 2) Coordinador del dueño.
    if (ownerCandidate) {
      try {
        const profile = await this.userService.findTransactionalProfile(ownerCandidate)
        const coordinatorId = profile?.coordinatorId?.toString?.()
        if (coordinatorId) {
          const coordinator = await this.userService.findEmailNameClient(coordinatorId)
          await sendTo(coordinator?.email, coordinatorId)
        }
      } catch (err) {
        this.logger.warn('No se pudo notificar al coordinador:', err)
      }
    }

    // 3) Contabilidad/Tesorería (solo por rol Contabilidad, ya filtrado en el helper).
    if (body.clientId) {
      try {
        const contabilidad =
          await this.userService.findContabilidadRecipients(body.clientId)
        for (const u of contabilidad) {
          await sendTo(u.email)
        }
      } catch (err) {
        this.logger.warn('No se pudo notificar a contabilidad:', err)
      }
    }
  }

  async generateTokenSunat(clientId: string) {
    try {
      const credentials = await this.sunatConfigService.getCredentials(clientId)

      const client_id = credentials.clientId
      const client_secret = credentials.clientSecret
      const ruc = credentials.ruc

      if (!client_id || !client_secret) {
        throw new HttpException(
          'Credenciales SUNAT incompletas: falta clientId o clientSecret',
          HttpStatus.BAD_REQUEST,
        )
      }

      const api = `https://api-seguridad.sunat.gob.pe/v1/clientesextranet/${client_id}/oauth2/token/`
      const scope = 'https://api.sunat.gob.pe/v1/contribuyente/contribuyentes'

      // Formato oficial SUNAT: credenciales en body, sin Basic Auth header
      const body = new URLSearchParams()
      body.set('grant_type', 'client_credentials')
      body.set('scope', scope)
      body.set('client_id', client_id)
      body.set('client_secret', client_secret)

      this.logger.log(`[SUNAT Token] clientId interno: ${clientId}`)
      this.logger.log(`[SUNAT Token] client_id SUNAT: ${client_id}`)
      this.logger.log(`[SUNAT Token] RUC: ${ruc}`)
      this.logger.log(`[SUNAT Token] URL: ${api}`)

      const response = await firstValueFrom(
        this.httpService.post(api, body.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      )

      this.logger.log(`[SUNAT Token] Token obtenido exitosamente para client_id: ${client_id}`)

      await this.sunatConfigService.update(credentials._id, { isActive: true })

      return response.data
    } catch (error) {
      const sunatError = error?.response?.data
      const status = error?.response?.status

      this.logger.error(
        `[SUNAT Token] Error al generar token — HTTP ${status ?? 'N/A'}: ${JSON.stringify(sunatError ?? error?.message)}`
      )

      if (sunatError?.error) {
        throw new HttpException(
          {
            message: 'Error de autenticación SUNAT',
            sunat_error: sunatError.error,
            sunat_description: sunatError.error_description,
          },
          HttpStatus.BAD_GATEWAY,
        )
      }

      throw new HttpException(
        error?.message || 'Error al generar token de SUNAT',
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }

  async getRucInfo(ruc: string, clientId: string): Promise<{ razonSocial: string | null; fuente: string }> {
    // Option A: SUNAT API oficial con el mismo token OAuth2
    try {
      const token = await this.generateTokenSunat(clientId)
      if (token?.access_token) {
        const url = `https://api.sunat.gob.pe/v1/contribuyente/contribuyentes/${ruc}`
        const response = await firstValueFrom(
          this.httpService.get(url, {
            headers: { Authorization: `Bearer ${token.access_token}` },
          })
        )
        console.log(`[RUC Info] SUNAT respuesta para ${ruc}:`, JSON.stringify(response.data))
        const data = response.data
        const razonSocial = data?.ddp_nombre ?? data?.razonSocial ?? data?.nombre ?? null
        if (razonSocial) {
          this.logger.log(`[RUC Info] ${ruc} via SUNAT oficial: ${razonSocial}`)
          return { razonSocial, fuente: 'sunat' }
        }
      }
    } catch (err: any) {
      console.log(`[RUC Info] SUNAT error para ${ruc}:`, err?.response?.status, JSON.stringify(err?.response?.data ?? err?.message))
    }

    // Option B-1: api.apis.net.pe v2 (requiere token si lo hay en env)
    try {
      const headers: any = { 'Accept': 'application/json' }
      const apisToken = process.env.APIS_NET_PE_TOKEN
      if (apisToken) headers['Authorization'] = `Bearer ${apisToken}`

      const url = `https://api.apis.net.pe/v2/sunat/ruc?numero=${ruc}`
      const response = await firstValueFrom(
        this.httpService.get(url, { headers, timeout: 6000 } as any)
      )
      console.log(`[RUC Info] api.apis.net.pe v2 respuesta para ${ruc}:`, JSON.stringify(response.data))
      const data = response.data
      const razonSocial = data?.razonSocial ?? data?.nombre ?? null
      if (razonSocial) {
        this.logger.log(`[RUC Info] ${ruc} via api.apis.net.pe v2: ${razonSocial}`)
        return { razonSocial, fuente: 'tercero' }
      }
    } catch (err: any) {
      console.log(`[RUC Info] api.apis.net.pe v2 error para ${ruc}:`, err?.response?.status, JSON.stringify(err?.response?.data ?? err?.message))
    }

    // Option B-2: api.apis.net.pe v1 (puede funcionar sin token)
    try {
      const url = `https://api.apis.net.pe/v1/ruc?numero=${ruc}`
      const response = await firstValueFrom(
        this.httpService.get(url, { timeout: 6000 } as any)
      )
      console.log(`[RUC Info] api.apis.net.pe v1 respuesta para ${ruc}:`, JSON.stringify(response.data))
      const data = response.data
      const razonSocial = data?.razonSocial ?? data?.nombre ?? null
      if (razonSocial) {
        this.logger.log(`[RUC Info] ${ruc} via api.apis.net.pe v1: ${razonSocial}`)
        return { razonSocial, fuente: 'tercero' }
      }
    } catch (err: any) {
      console.log(`[RUC Info] api.apis.net.pe v1 error para ${ruc}:`, err?.response?.status, JSON.stringify(err?.response?.data ?? err?.message))
    }

    return { razonSocial: null, fuente: 'not_found' }
  }

  private interpretSunatResponse(sunatData: any): {
    status: string
    details: any
    message: string
  } {
    if (sunatData.success === true && sunatData.data?.estadoCp === '1') {
      return {
        status: 'VALIDO_ACEPTADO',
        details: sunatData.data,
        message: 'El comprobante es válido y fue facturado a esta empresa.',
      }
    } else if (sunatData.success === true && sunatData.data?.estadoCp === '0') {
      return {
        status: 'VALIDO_NO_PERTENECE',
        details: sunatData.data,
        message:
          'El comprobante es válido, pero no fue facturado a esta empresa.',
      }
    } else if (sunatData.cod === '98') {
      return {
        status: 'NO_ENCONTRADO',
        details: sunatData.msg || 'El comprobante no existe en SUNAT.',
        message: 'El comprobante no existe en SUNAT.',
      }
    } else {
      return {
        status: 'ERROR_SUNAT',
        details: sunatData,
        message: 'Error al validar el comprobante.',
      }
    }
  }

  async analyzeImageWithUrl(body: CreateExpenseDto): Promise<Expense> {
    const configSunat = await this.sunatConfigService.findOne(body.clientId)
    const prompt = PROMPT1
    try {
      const completion = await this.openai.chat.completions.create({
        model: this.visionModel,
        messages: this.buildVisionMessages(prompt, body.imageUrl!),
        temperature: 0,
        max_completion_tokens: 8192,
      })

      const extraction = this.parseOpenAiJsonContent(
        completion.choices[0]?.message?.content
      )

      await this.validateDuplicateInvoiceIfAny(extraction, body.clientId)

      const { validation, expenseStatus } =
        await this.validateWithSunatIfPossible(
          extraction,
          body.clientId,
          configSunat?.ruc
        )

      const expense = await this.createExpenseDocument(
        body,
        extraction,
        validation,
        expenseStatus
      )

      if (body.expenseReportId) {
        await this.expenseReportService.addExpenseToReport(
          body.expenseReportId,
          expense._id.toString()
        )
      }

      const project = await this.projectService.findOne(
        body.proyectId,
        body.clientId
      )

      try {
        await this.notifyStakeholders(
          body,
          extraction,
          project?.name || 'No especificado'
        )
      } catch (error) {
        this.logger.error('Error al enviar notificaciones de correo:', error)
      }

      return expense
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }

      this.logger.error('OpenAI API Error Response:', error)
      throw new HttpException(
        'Error al analizar la imagen desde la URL con OpenAI.',
        HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  async analyzePdf(
    body: CreateExpenseDto,
    file: Express.Multer.File
  ): Promise<Expense> {
    if (!file || !file.buffer) {
      throw new HttpException('Archivo PDF no provisto', HttpStatus.BAD_REQUEST)
    }

    try {
      const pdfModule = await import('pdf-parse')
      const pdfParse: (data: Buffer) => Promise<{ text: string }> =
        pdfModule.default ?? pdfModule
      const parsed = await pdfParse(file.buffer)
      const textFromPdf = parsed.text || ''

      console.log('textFromPdf', textFromPdf)

      const prompt = PROMPT1
      const completion = await this.openai.chat.completions.create({
        model: this.visionModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'text', text: textFromPdf.substring(0, 15000) },
            ],
          },
        ],
        temperature: 0,
        max_completion_tokens: 8192,
      })

      const extraction = this.parseOpenAiJsonContent(
        completion.choices[0]?.message?.content
      )

      await this.validateDuplicateInvoiceIfAny(extraction, body.clientId)

      // Subir el PDF y setear la URL como file/imageUrl del gasto
      const uploadedUrl = await this.uploadExpensePdfAndGetUrl(
        file,
        body.clientId
      )
      body.imageUrl = uploadedUrl

      const configSunat = await this.sunatConfigService.findOne(body.clientId)
      const { validation, expenseStatus } =
        await this.validateWithSunatIfPossible(
          extraction,
          body.clientId,
          configSunat?.ruc
        )

      const expense = await this.createExpenseDocument(
        body,
        extraction,
        validation,
        expenseStatus
      )

      if (body.expenseReportId) {
        await this.expenseReportService.addExpenseToReport(
          body.expenseReportId,
          expense._id.toString()
        )
      }

      const project = await this.projectService.findOne(
        body.proyectId,
        body.clientId
      )

      try {
        await this.notifyStakeholders(
          body,
          extraction,
          project?.name || 'No especificado'
        )
      } catch (error) {
        this.logger.error('Error al enviar notificaciones de correo:', error)
      }

      return expense
    } catch (error) {
      if (error instanceof HttpException) throw error
      this.logger.error('Error al analizar PDF:', error)
      throw new HttpException(
        'Error al analizar el PDF.',
        HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  async createMobilitySheet(body: CreateExpenseDto): Promise<Expense> {
    if (!body.clientId) {
      throw new HttpException('clientId es requerido', HttpStatus.BAD_REQUEST)
    }
    if (!body.mobilityRows || body.mobilityRows.length === 0) {
      throw new HttpException(
        'Se requiere al menos una fila en la planilla',
        HttpStatus.BAD_REQUEST
      )
    }

    const client = await this.clientModel.findById(body.clientId).lean().exec()
    const dailyLimit = client?.limits?.movilidadDiario ?? null
    if (dailyLimit !== null) {
      const dailyTotals = new Map<string, number>()
      for (const row of body.mobilityRows) {
        const date = row.fecha || ''
        dailyTotals.set(date, (dailyTotals.get(date) ?? 0) + (row.total || 0))
      }
      for (const [date, dayTotal] of dailyTotals) {
        if (dayTotal > dailyLimit) {
          throw new BadRequestException(
            `El total del día ${date} (S/ ${dayTotal.toFixed(2)}) supera el límite diario de S/ ${dailyLimit.toFixed(2)}`
          )
        }
      }
    }

    const total = body.mobilityRows.reduce(
      (sum, row) => sum + (row.total || 0),
      0
    )
    const earliestDate = body.mobilityRows
      .map(r => this.parseExpenseDate(r.fecha))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0]
    const deadlineMeta = this.evaluateDeadline(
      earliestDate ? earliestDate.toISOString().slice(0, 10) : undefined
    )

    const categoryMeta = await this.evaluateCategoryLimit(body, total)
    const internalCode = await this.generateInternalCode(
      body.userId,
      'planilla_movilidad',
      body.expenseReportId
    )
    const expense = await this.expenseRepository.create({
      categoryId: new Types.ObjectId(body.categoryId),
      proyectId: new Types.ObjectId(body.proyectId),
      clientId: body.clientId,
      expenseReportId: body.expenseReportId
        ? new Types.ObjectId(body.expenseReportId)
        : undefined,
      total,
      expenseType: 'planilla_movilidad',
      mobilityRows: body.mobilityRows,
      file: body.imageUrl,
      status: 'pending',
      createdBy: body.userId || 'system',
      observado: deadlineMeta.observado,
      observacionPlazo: deadlineMeta.observacionPlazo,
      diasRetraso: deadlineMeta.diasRetraso,
      categoryLimitPercent: categoryMeta.percent,
      categoryLimitWarning: categoryMeta.warning,
      internalCode,
      data: JSON.stringify({
        type: 'planilla_movilidad',
        rows: body.mobilityRows,
      }),
    })

    if (body.expenseReportId) {
      await this.expenseReportService.addExpenseToReport(
        body.expenseReportId,
        (expense as any)._id.toString()
      )
    }

    return expense
  }

  async createOtherExpense(body: CreateExpenseDto): Promise<Expense> {
    if (!body.clientId) {
      throw new HttpException('clientId es requerido', HttpStatus.BAD_REQUEST)
    }
    if (!body.total || body.total <= 0) {
      throw new HttpException(
        'Se requiere un monto válido',
        HttpStatus.BAD_REQUEST
      )
    }

    const subTipo = body.subTipo || 'OT'
    const isDJ = subTipo === 'DJ'

    // Solo la DJ requiere firma y aceptación del checkbox
    if (isDJ) {
      if (!body.declaracionJurada) {
        throw new HttpException(
          'Se requiere firmar la declaración jurada',
          HttpStatus.BAD_REQUEST
        )
      }
      if (body.userId) {
        const profile = await this.userService.findTransactionalProfile(body.userId)
        if (!profile?.signature) {
          throw new HttpException(
            'Debes registrar tu firma digital antes de enviar una Declaración Jurada. Ve a tu perfil para añadirla.',
            HttpStatus.UNPROCESSABLE_ENTITY
          )
        }
      }
    }

    const normalizedFecha = this.normalizeFechaEmisionValue(body.fechaEmision)
    const deadlineMeta = this.evaluateDeadline(normalizedFecha ?? body.fechaEmision)
    const categoryMeta = await this.evaluateCategoryLimit(body, body.total)
    const expense = await this.expenseRepository.create({
      categoryId: new Types.ObjectId(body.categoryId),
      proyectId: new Types.ObjectId(body.proyectId),
      clientId: body.clientId,
      expenseReportId: body.expenseReportId
        ? new Types.ObjectId(body.expenseReportId)
        : undefined,
      total: body.total,
      description: body.data,
      expenseType: 'otros_gastos',
      subTipo,
      declaracionJurada: isDJ ? true : false,
      declaracionJuradaFirmante: isDJ ? body.declaracionJuradaFirmante : undefined,
      file: body.imageUrl || undefined,
      status: 'pending',
      createdBy: body.userId || 'system',
      fechaEmision: normalizedFecha ?? body.fechaEmision,
      observado: deadlineMeta.observado,
      observacionPlazo: deadlineMeta.observacionPlazo,
      diasRetraso: deadlineMeta.diasRetraso,
      categoryLimitPercent: categoryMeta.percent,
      categoryLimitWarning: categoryMeta.warning,
      data: JSON.stringify({
        type: 'otros_gastos',
        subTipo,
        declaracionJurada: isDJ,
        firmante: isDJ ? body.declaracionJuradaFirmante : undefined,
        description: body.data,
        serie: body.serie || undefined,
        correlativo: body.correlativo || undefined,
        rucEmisor: body.rucEmisor || undefined,
      }),
    })

    if (body.expenseReportId) {
      await this.expenseReportService.addExpenseToReport(
        body.expenseReportId,
        (expense as any)._id.toString()
      )
    }

    return expense
  }

  async createCashReceiptExpense(body: CreateExpenseDto): Promise<Expense> {
    if (!body.clientId) {
      throw new HttpException('clientId es requerido', HttpStatus.BAD_REQUEST)
    }
    if (!body.imageUrl) {
      throw new HttpException(
        'Debe adjuntar la foto/archivo del recibo de caja',
        HttpStatus.BAD_REQUEST
      )
    }
    if (!body.total || body.total <= 0) {
      throw new HttpException(
        'Se requiere un monto válido',
        HttpStatus.BAD_REQUEST
      )
    }
    if (!body.fechaEmision) {
      throw new HttpException(
        'La fecha del comprobante es obligatoria',
        HttpStatus.BAD_REQUEST
      )
    }

    const receiptDate = this.parseExpenseDate(body.fechaEmision)
    if (!receiptDate) {
      throw new HttpException(
        'La fecha del comprobante es inválida',
        HttpStatus.BAD_REQUEST
      )
    }
    const today = new Date()
    const todayUtc = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    )
    if (receiptDate.getTime() > todayUtc.getTime()) {
      throw new HttpException(
        'La fecha del comprobante no puede ser futura',
        HttpStatus.BAD_REQUEST
      )
    }

    const normalizedFecha = this.normalizeFechaEmisionValue(body.fechaEmision)
    const deadlineMeta = this.evaluateDeadline(normalizedFecha ?? body.fechaEmision)
    const categoryMeta = await this.evaluateCategoryLimit(body, body.total)
    const expense = await this.expenseRepository.create({
      categoryId: new Types.ObjectId(body.categoryId),
      proyectId: new Types.ObjectId(body.proyectId),
      clientId: body.clientId,
      expenseReportId: body.expenseReportId
        ? new Types.ObjectId(body.expenseReportId)
        : undefined,
      total: body.total,
      description: body.data,
      expenseType: 'recibo_caja',
      file: body.imageUrl,
      status: 'pending',
      createdBy: body.userId || 'system',
      fechaEmision: normalizedFecha ?? body.fechaEmision,
      observado: deadlineMeta.observado,
      observacionPlazo: deadlineMeta.observacionPlazo,
      diasRetraso: deadlineMeta.diasRetraso,
      categoryLimitPercent: categoryMeta.percent,
      categoryLimitWarning: categoryMeta.warning,
      data: JSON.stringify({
        type: 'recibo_caja',
        payload: body.data || '',
      }),
    })

    if (body.expenseReportId) {
      await this.expenseReportService.addExpenseToReport(
        body.expenseReportId,
        (expense as any)._id.toString()
      )
    }

    return expense
  }

  async createCashVoucherExpense(body: CreateExpenseDto): Promise<Expense> {
    if (!body.clientId) {
      throw new HttpException('clientId es requerido', HttpStatus.BAD_REQUEST)
    }
    if (!body.total || body.total <= 0) {
      throw new HttpException(
        'Se requiere un monto válido',
        HttpStatus.BAD_REQUEST
      )
    }
    const description = (body.data || '').trim()
    if (!description) {
      throw new HttpException(
        'El concepto del comprobante es obligatorio',
        HttpStatus.BAD_REQUEST
      )
    }

    const normalizedFecha = this.normalizeFechaEmisionValue(body.fechaEmision)
    const deadlineMeta = this.evaluateDeadline(normalizedFecha ?? body.fechaEmision)
    const categoryMeta = await this.evaluateCategoryLimit(body, body.total)
    const internalCode = await this.generateInternalCode(
      body.userId,
      'comprobante_caja',
      body.expenseReportId
    )

    const expense = await this.expenseRepository.create({
      categoryId: new Types.ObjectId(body.categoryId),
      proyectId: new Types.ObjectId(body.proyectId),
      clientId: body.clientId,
      expenseReportId: body.expenseReportId
        ? new Types.ObjectId(body.expenseReportId)
        : undefined,
      total: body.total,
      description,
      expenseType: 'comprobante_caja',
      status: 'pending',
      createdBy: body.userId || 'system',
      fechaEmision: normalizedFecha ?? body.fechaEmision,
      observado: deadlineMeta.observado,
      observacionPlazo: deadlineMeta.observacionPlazo,
      diasRetraso: deadlineMeta.diasRetraso,
      categoryLimitPercent: categoryMeta.percent,
      categoryLimitWarning: categoryMeta.warning,
      internalCode,
      data: JSON.stringify({
        type: 'comprobante_caja',
        payload: body.data || '',
      }),
    })

    if (body.expenseReportId) {
      await this.expenseReportService.addExpenseToReport(
        body.expenseReportId,
        (expense as any)._id.toString()
      )
    }

    return expense
  }

  async create(createExpenseDto: CreateExpenseDto): Promise<Expense> {
    const dto = { ...createExpenseDto }
    this.sanitizeFechaEmisionOnWrite(dto)
    this.syncComentarioPlacaFromData(dto)

    if (!dto.fechaEmision && dto.data) {
      try {
        const dataObj =
          typeof dto.data === 'string' ? JSON.parse(dto.data) : dto.data
        const fromData = this.normalizeFechaEmisionValue(dataObj?.fechaEmision)
        if (fromData) dto.fechaEmision = fromData
      } catch {
        /* ignore */
      }
    }

    const createdExpense = new this.expenseRepository({
      ...dto,
      clientId: new Types.ObjectId(createExpenseDto.clientId),
      createdBy: createExpenseDto.userId,
    })
    const expense = await createdExpense.save()

    if (createExpenseDto.expenseReportId) {
      await this.expenseReportService.addExpenseToReport(
        createExpenseDto.expenseReportId,
        expense._id.toString()
      )
    }

    return expense
  }

  async findAll(clientId: string, filters: any = {}): Promise<{ data: Expense[]; total: number; page: number; pages: number; limit: number }> {
    const query: any = { clientId }
    const page = filters.page ? Math.max(1, parseInt(String(filters.page), 10)) : 1
    const limit = filters.limit ? Math.min(200, parseInt(String(filters.limit), 10)) : 20
    const skip = (page - 1) * limit

    const isValidObjectId = (id: string): boolean => {
      return /^[0-9a-fA-F]{24}$/.test(id)
    }

    if (filters.createdBy) {
      if (isValidObjectId(filters.createdBy)) {
        query.createdBy = filters.createdBy
      }
    }

    if (filters.projectId) {
      if (isValidObjectId(filters.projectId)) {
        query.$or = [
          { proyectId: filters.projectId },
          { proyectId: Types.ObjectId.createFromHexString(filters.projectId) },
        ]
      }
    }

    if (filters.proyectId) {
      if (isValidObjectId(filters.proyectId)) {
        query.$or = [
          { proyectId: filters.proyectId },
          { proyectId: Types.ObjectId.createFromHexString(filters.proyectId) },
        ]
      }
    }

    if (filters.categoryId) {
      if (isValidObjectId(filters.categoryId)) {
        if (query.$or) {
          const projectConditions = query.$or
          delete query.$or
          query.$and = [
            { $or: projectConditions },
            {
              $or: [
                { categoryId: filters.categoryId },
                {
                  categoryId: Types.ObjectId.createFromHexString(
                    filters.categoryId
                  ),
                },
              ],
            },
          ]
        } else {
          query.$or = [
            { categoryId: filters.categoryId },
            {
              categoryId: Types.ObjectId.createFromHexString(
                filters.categoryId
              ),
            },
          ]
        }
      }
    }

    if (filters.status) query.status = filters.status

    if (filters.amountMin || filters.amountMax) {
      query.total = {}
      if (filters.amountMin) query.total.$gte = Number(filters.amountMin)
      if (filters.amountMax) query.total.$lte = Number(filters.amountMax)
    }

    if (filters.serie && filters.correlativo) {
      const expense = await this.findBySeriAndCorrelativo(
        filters.serie,
        filters.correlativo,
        clientId
      )
      const data = expense ? [expense] : []
      return { data, total: data.length, page: 1, pages: 1, limit }
    }

    // Si hay filtros de fecha, usar agregación para comparar fechas correctamente
    if (filters.dateFrom || filters.dateTo) {
      // Usar agregación para convertir strings de fecha a fechas reales y comparar
      const pipeline: any[] = []

      // Match por clientId y otros filtros básicos
      const matchStage: any = { clientId: new Types.ObjectId(clientId) }

      // Aplicar otros filtros básicos
      if (filters.createdBy && /^[0-9a-fA-F]{24}$/.test(filters.createdBy)) {
        matchStage.createdBy = filters.createdBy
      }

      if (filters.status) {
        matchStage.status = filters.status
      }

      if (filters.amountMin || filters.amountMax) {
        matchStage.total = {}
        if (filters.amountMin) matchStage.total.$gte = Number(filters.amountMin)
        if (filters.amountMax) matchStage.total.$lte = Number(filters.amountMax)
      }

      pipeline.push({ $match: matchStage })

      // Agregar filtros de proyecto y categoría si existen
      if (filters.projectId || filters.proyectId) {
        const projectId = filters.projectId || filters.proyectId
        if (/^[0-9a-fA-F]{24}$/.test(projectId)) {
          pipeline.push({
            $match: {
              $or: [
                { proyectId: new Types.ObjectId(projectId) },
                { proyectId: projectId },
              ],
            },
          })
        }
      }

      if (filters.categoryId && /^[0-9a-fA-F]{24}$/.test(filters.categoryId)) {
        pipeline.push({
          $match: {
            $or: [
              { categoryId: new Types.ObjectId(filters.categoryId) },
              { categoryId: filters.categoryId },
            ],
          },
        })
      }

      // Agregar stage para convertir fechaEmision a fecha real y filtrar
      // Handles both dd-mm-yyyy and yyyy-mm-dd storage formats
      pipeline.push({
        $addFields: {
          fechaEmisionDate: {
            $dateFromString: {
              dateString: {
                $let: {
                  vars: { parts: { $split: ['$fechaEmision', '-'] } },
                  in: {
                    $cond: {
                      if: { $eq: [{ $strLenCP: { $ifNull: [{ $arrayElemAt: ['$$parts', 0] }, ''] } }, 4] },
                      then: '$fechaEmision',
                      else: {
                        $concat: [
                          { $arrayElemAt: ['$$parts', 2] },
                          '-',
                          { $arrayElemAt: ['$$parts', 1] },
                          '-',
                          { $arrayElemAt: ['$$parts', 0] },
                        ],
                      },
                    },
                  },
                },
              },
              timezone: 'UTC',
              onError: null,
              onNull: null,
            },
          },
        },
      })

      // Filtrar por fechas
      const dateFilter: any = {}
      if (filters.dateFrom) {
        const [yearFrom, monthFrom, dayFrom] = filters.dateFrom
          .split('-')
          .map(Number)
        // Usar UTC para evitar problemas de zona horaria
        const fromDate = new Date(
          Date.UTC(yearFrom, monthFrom - 1, dayFrom, 0, 0, 0, 0)
        )
        dateFilter.fechaEmisionDate = { $gte: fromDate }
      }

      if (filters.dateTo) {
        const [yearTo, monthTo, dayTo] = filters.dateTo.split('-').map(Number)
        // Usar UTC para evitar problemas de zona horaria, incluir todo el día
        const toDate = new Date(
          Date.UTC(yearTo, monthTo - 1, dayTo, 23, 59, 59, 999)
        )
        if (dateFilter.fechaEmisionDate) {
          dateFilter.fechaEmisionDate.$lte = toDate
        } else {
          dateFilter.fechaEmisionDate = { $lte: toDate }
        }
      }

      if (Object.keys(dateFilter).length > 0) {
        pipeline.push({ $match: dateFilter })
      }

      // Sort by parsed date for correct ordering, then paginate
      const sortBy = filters.sortBy || 'fechaEmision'
      const sortOrder = filters.sortOrder || 'desc'
      const sortField = sortBy === 'fechaEmision' ? 'fechaEmisionDate' : sortBy
      pipeline.push({ $sort: { [sortField]: sortOrder === 'desc' ? -1 : 1 } })

      const [facetResult] = await this.expenseRepository.aggregate([
        ...pipeline,
        {
          $facet: {
            data: [{ $skip: skip }, { $limit: limit }, { $project: { fechaEmisionDate: 0 } }],
            count: [{ $count: 'total' }],
          },
        },
      ])
      const rawData = facetResult?.data ?? []
      const total = facetResult?.count?.[0]?.total ?? 0
      const populatedResult = await this.expenseRepository.populate(rawData, [
        { path: 'proyectId' },
        { path: 'categoryId' },
      ]) as unknown as Expense[]
      return {
        data: applyFechaEmisionDisplayToExpenses(populatedResult),
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      }
    }

    const sortBy = filters.sortBy || 'fechaEmision'
    const sortOrder = filters.sortOrder || 'desc'
    const sortOptions: any = {}
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1

    const [result, total] = await Promise.all([
      this.expenseRepository.find(query).populate('proyectId').populate('categoryId').sort(sortOptions).skip(skip).limit(limit).exec(),
      this.expenseRepository.countDocuments(query),
    ])

    let data: Expense[] = result
    if (sortBy === 'fechaEmision') {
      data = result.sort((a, b) => {
        const dateA = this.parseExpenseDate(a.fechaEmision as string)
        const dateB = this.parseExpenseDate(b.fechaEmision as string)
        if (!dateA || !dateB) return 0
        return sortOrder === 'desc'
          ? dateB.getTime() - dateA.getTime()
          : dateA.getTime() - dateB.getTime()
      })
    }

    return {
      data: applyFechaEmisionDisplayToExpenses(data),
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    }
  }

  async getStatusCounts(clientId: string): Promise<{ pending: number; approved: number; rejected: number; total: number }> {
    const match = { clientId: new Types.ObjectId(clientId) }
    const [total, approved, rejected] = await Promise.all([
      this.expenseRepository.countDocuments(match),
      this.expenseRepository.countDocuments({ ...match, status: { $in: ['approved', 'APPROVED'] } }),
      this.expenseRepository.countDocuments({ ...match, status: { $in: ['rejected', 'REJECTED'] } }),
    ])
    return { total, approved, rejected, pending: total - approved - rejected }
  }

  async findOne(id: string): Promise<Expense | null> {
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      throw new Error(`ID de expense inválido: ${id}`)
    }

    const expenseIdObject = Types.ObjectId.createFromHexString(id)

    const expense = await this.expenseRepository
      .findOne({ _id: expenseIdObject })
      .populate('proyectId')
      .populate('categoryId')
      .exec()

    return expense ? applyFechaEmisionDisplayToExpense(expense) : null
  }

  async getSunatValidationInfo(id: string): Promise<any> {
    const expense = await this.findOne(id)

    if (!expense) {
      throw new NotFoundException(`Expense with ID ${id} not found`)
    }

    return this.buildSunatValidationInfoPayload(expense)
  }

  async getSunatValidationInfoForActor(
    id: string,
    actor: ExpenseActorContext
  ): Promise<Record<string, unknown>> {
    const expense = await this.loadExpenseOrThrow(id)
    this.assertCanReadExpense(expense, actor)
    return this.buildSunatValidationInfoPayload(expense)
  }

  private buildSunatValidationInfoPayload(
    expense: Expense
  ): Record<string, unknown> {
    try {
      const data = JSON.parse(expense.data)
      const sunatValidation = data.sunatValidation

      return {
        expenseId: String((expense as { _id?: Types.ObjectId })._id),
        status: expense.status,
        sunatValidation: sunatValidation || null,
        hasValidation: !!sunatValidation,
        message:
          sunatValidation?.message ||
          'No hay información de validación SUNAT disponible',
        extractedData: {
          rucEmisor: data.rucEmisor,
          serie: data.serie,
          correlativo: data.correlativo,
          fechaEmision: data.fechaEmision,
          montoTotal: data.montoTotal,
        },
      }
    } catch (error) {
      const err = error as Error
      this.logger.error(`Error parsing expense data: ${err.message}`)
      return {
        expenseId: String((expense as { _id?: Types.ObjectId })._id),
        status: expense.status,
        sunatValidation: null,
        hasValidation: false,
        message: 'Error al procesar la información de validación SUNAT',
      }
    }
  }

  async findOneForActor(
    id: string,
    actor: ExpenseActorContext
  ): Promise<Expense> {
    const expense = await this.loadExpenseOrThrow(id)
    this.assertCanReadExpense(expense, actor)
    return applyFechaEmisionDisplayToExpense(expense)
  }

  async update(
    id: string,
    updateExpenseDto: UpdateExpenseDto,
    actor: ExpenseActorContext
  ): Promise<Expense | null> {
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      throw new Error(`ID de expense inválido: ${id}`)
    }

    const expenseIdObject = Types.ObjectId.createFromHexString(id)
    const existing = await this.loadExpenseOrThrow(id)
    await this.assertCanMutateExpense(existing, actor)

    const dto = { ...updateExpenseDto }
    this.sanitizeFechaEmisionOnWrite(dto)
    this.syncComentarioPlacaFromData(dto)

    if (dto.mobilityRows && dto.mobilityRows.length > 0) {
      const client = await this.clientModel
        .findById(existing.clientId)
        .lean()
        .exec()
      const dailyLimit = client?.limits?.movilidadDiario ?? null
      if (dailyLimit !== null) {
        const dailyTotals = new Map<string, number>()
        for (const row of dto.mobilityRows) {
          const date = row.fecha || ''
          dailyTotals.set(date, (dailyTotals.get(date) ?? 0) + (row.total || 0))
        }
        for (const [date, dayTotal] of dailyTotals) {
          if (dayTotal > dailyLimit) {
            throw new BadRequestException(
              `El total del día ${date} (S/ ${dayTotal.toFixed(2)}) supera el límite diario de S/ ${dailyLimit.toFixed(2)}`
            )
          }
        }
      }
      dto.total = dto.mobilityRows.reduce(
        (sum, row) => sum + (row.total || 0),
        0
      )
      dto.data = JSON.stringify({
        type: 'planilla_movilidad',
        rows: dto.mobilityRows,
      })
    }

    const updated = await this.expenseRepository
      .findOneAndUpdate({ _id: expenseIdObject }, dto, {
        new: true,
      })
      .populate('clientId')
      .populate('categoryId')
      .exec()

    return updated ? applyFechaEmisionDisplayToExpense(updated) : null
  }

  async approveInvoice(id: string, approvalDto: ApprovalDto) {
    const expense = await this.findOne(id)
    if (!expense) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`)
    }

    if (expense.status === 'approved') {
      throw new HttpException(
        'La factura ya ha sido aprobada',
        HttpStatus.BAD_REQUEST
      )
    }

    const validUserId = null
    const userEmail = null
    const userName = null
    const userLastName = null
    const reviewerId = approvalDto.userId || undefined

    const updatedExpense = await this.expenseRepository
      .findByIdAndUpdate(
        id,
        {
          status: 'approved',
          statusDate: new Date(),
          approvedBy: validUserId,
          $push: {
            reviewHistory: {
              action: 'approved',
              reviewerId,
              reviewedAt: new Date(),
            },
          },
        },
        { new: true }
      )
      .exec()

    if (updatedExpense && updatedExpense.createdBy) {
      const invoiceData = updatedExpense.data
        ? JSON.parse(updatedExpense.data)
        : {}
      const nombreComprobante = `${invoiceData.serie || ''}-${invoiceData.correlativo || ''}`

      this.notificationsService
        .create({
          userId: updatedExpense.createdBy as unknown as string,
          title: 'Comprobante Aprobado',
          message: `Tu comprobante ${nombreComprobante} ha sido aprobado.`,
          type: 'success',
          actionUrl: `/mis-rendiciones/${this.expenseReportIdString(updatedExpense)}/detalle`,
        })
        .catch(err => this.logger.error('Error creando notificación', err))
    }

    this.logger.log(`Factura ${id} aprobada exitosamente`)
    return updatedExpense
  }

  private async sendApprovalEmails(
    expense: any,
    validUserId: string | null,
    userName?: string | null,
    userLastName?: string | null
  ) {
    try {
      let approverName = 'Administrador del Sistema'

      if (userName && userLastName) {
        approverName = `${userName} ${userLastName}`
        this.logger.debug(
          `Usando información de aprobador encontrada previamente: ${approverName}`
        )
      } else if (validUserId) {
        try {
          const approver = await this.userService.findOne(validUserId)
          if (approver) {
            approverName = approver.name

            this.logger.debug(
              `Información de aprobador obtenida de la BD: ${approverName}`
            )
          }
        } catch (error) {
          this.logger.warn('No se pudo obtener información del aprobador')
        }
      } else {
        this.logger.warn(
          'Usando valor predeterminado para el aprobador: Administrador del Sistema'
        )
      }

      const invoiceData = expense.data ? JSON.parse(expense.data) : {}

      if (expense.createdBy) {
        try {
          if (!/^[0-9a-fA-F]{24}$/.test(expense.createdBy)) {
            this.logger.warn(`ID del creador inválido: ${expense.createdBy}`)
            return
          }

          const creator = await this.userService.findOne(expense.createdBy)

          if (creator && creator.email) {
            const creatorFullName = creator.name

            this.logger.debug(
              `Enviando notificación de aprobación a ${creator.email}, rol: ${creator.role}`
            )
          } else {
            this.logger.warn(
              'No se encontró email para el creador de la factura'
            )
          }
        } catch (error) {
          this.logger.warn(
            'No se pudo encontrar al creador de la factura:',
            error
          )
        }
      } else {
        this.logger.warn(
          'La factura no tiene un creador asignado (createdBy es null)'
        )
      }

      try {
        const colaboradores = await this.userService.findAll(
          new Types.ObjectId(expense.clientId)
        )

        if (colaboradores && colaboradores.length > 0) {
          this.logger.debug(
            `Notificando a ${colaboradores.length} colaboradores sobre factura aprobada`
          )

          const creadorId = expense.createdBy || ''

          for (const colaborador of colaboradores) {
            if (colaborador.email && colaborador._id.toString() !== creadorId) {
              try {
                const emailEnabled = await this.userService.isEmailEnabled(colaborador._id.toString())
                if (!emailEnabled) continue
                await this.emailService.sendInvoiceApprovedToColaborador(
                  colaborador.email,
                  {
                    clientId: expense.clientId?.toString?.() ?? String(expense.clientId),
                    providerName: colaborador.name,
                    invoiceNumber: `${invoiceData.serie || ''}-${
                      invoiceData.correlativo || ''
                    }`,
                    date:
                      invoiceData.fechaEmision ||
                      new Date().toISOString().split('T')[0],
                    type: invoiceData.tipoComprobante || 'Factura',
                    approvedBy: approverName,
                  }
                )
                this.logger.debug(
                  `Notificación de aprobación enviada a colaborador ${colaborador.email}`
                )
              } catch (error) {
                this.logger.warn(
                  `Error al enviar notificación de aprobación al colaborador ${colaborador.email}:`,
                  error
                )
              }
            }
          }
        } else {
          this.logger.debug(
            'No hay colaboradores activos para notificar sobre la factura aprobada'
          )
        }
      } catch (error) {
        this.logger.error(
          'Error al notificar a colaboradores sobre factura aprobada:',
          error
        )
      }
    } catch (error) {
      this.logger.error('Error al enviar notificación de aprobación:', error)
    }
  }

  async rejectInvoice(id: string, approvalDto: ApprovalDto) {
    const expense = await this.findOne(id)
    if (!expense) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`)
    }

    if (expense.status === 'approved') {
      throw new HttpException(
        'La factura ya ha sido aprobada',
        HttpStatus.BAD_REQUEST
      )
    }

    if (expense.status === 'rejected') {
      throw new HttpException(
        'La factura ya ha sido rechazada',
        HttpStatus.BAD_REQUEST
      )
    }

    if (!approvalDto.reason) {
      throw new HttpException(
        'Se requiere un motivo para rechazar la factura',
        HttpStatus.BAD_REQUEST
      )
    }

    const validUserId = null
    const userName = null
    const userLastName = null
    const reviewerId = approvalDto.userId || undefined

    const updatedExpense = await this.expenseRepository
      .findByIdAndUpdate(
        id,
        {
          status: 'rejected',
          statusDate: new Date(),
          rejectedBy: validUserId,
          rejectionReason: approvalDto.reason,
          $push: {
            reviewHistory: {
              action: 'rejected',
              reviewerId,
              reviewedAt: new Date(),
              reason: approvalDto.reason,
            },
          },
        },
        { new: true }
      )
      .exec()

    if (updatedExpense && updatedExpense.createdBy) {
      const invoiceData = updatedExpense.data
        ? JSON.parse(updatedExpense.data)
        : {}
      const nombreComprobante = `${invoiceData.serie || ''}-${invoiceData.correlativo || ''}`

      this.notificationsService
        .create({
          userId: updatedExpense.createdBy as unknown as string,
          title: 'Comprobante Rechazado',
          message: `Tu comprobante ${nombreComprobante} ha sido rechazado. Motivo: ${approvalDto.reason}`,
          type: 'error',
          actionUrl: `/mis-rendiciones/${this.expenseReportIdString(updatedExpense)}/detalle`,
        })
        .catch(err =>
          this.logger.error('Error creando notificación de rechazo', err)
        )
    }

    this.logger.log(`Factura ${id} rechazada exitosamente`)
    return updatedExpense
  }

  private async sendRejectionEmails(
    expense: any,
    validUserId: string | null,
    userName?: string | null,
    userLastName?: string | null,
    rejectionReason?: string
  ) {
    try {
      let rejectorName = 'Administrador del Sistema'

      if (userName && userLastName) {
        rejectorName = `${userName} ${userLastName}`
        this.logger.debug(
          `Usando información de rechazador encontrada previamente: ${rejectorName}`
        )
      } else if (validUserId) {
        try {
          const rejector = await this.userService.findOne(validUserId)
          if (rejector) {
            rejectorName = rejector.name

            this.logger.debug(
              `Información de rechazador obtenida de la BD: ${rejectorName}`
            )
          }
        } catch (error) {
          this.logger.warn(
            'No se pudo obtener información del administrador que rechazó'
          )
        }
      } else {
        this.logger.warn(
          'Usando valor predeterminado para el rechazador: Administrador del Sistema'
        )
      }

      const invoiceData = expense.data ? JSON.parse(expense.data) : {}

      if (expense.createdBy) {
        try {
          if (!/^[0-9a-fA-F]{24}$/.test(expense.createdBy)) {
            this.logger.warn(`ID del creador inválido: ${expense.createdBy}`)
            return
          }

          const creator = await this.userService.findOne(expense.createdBy)

          if (creator && creator.email) {
            const creatorFullName = creator.name

            this.logger.debug(
              `Enviando notificación de rechazo a ${creator.email}, rol: ${creator.role}`
            )
          } else {
            this.logger.warn(
              'No se encontró email para el creador de la factura'
            )
          }
        } catch (error) {
          this.logger.warn(
            'No se pudo encontrar al creador de la factura:',
            error
          )
        }
      } else {
        this.logger.warn(
          'La factura no tiene un creador asignado (createdBy es null)'
        )
      }
    } catch (error) {
      this.logger.error('Error al enviar notificación de rechazo:', error)
    }
  }

  async remove(id: string, actor: ExpenseActorContext): Promise<void> {
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      throw new Error(`ID de expense inválido: ${id}`)
    }

    const existing = await this.loadExpenseOrThrow(id)
    await this.assertCanMutateExpense(existing, actor)

    const reportId = this.expenseReportIdString(existing)
    if (reportId) {
      await this.expenseReportService.removeExpenseFromReport(reportId, id)
    }

    const expenseIdObject = Types.ObjectId.createFromHexString(id)
    await this.expenseRepository
      .findOneAndDelete({ _id: expenseIdObject })
      .exec()
  }

  async findBySeriAndCorrelativo(
    serie: string,
    correlativo: string,
    clientId?: string,
    rucEmisor?: string
  ): Promise<Expense | null> {
    try {
      this.logger.debug(
        `Buscando duplicados - Serie: ${serie}, Correlativo: ${correlativo}, clientId: ${clientId}, rucEmisor: ${rucEmisor}`
      )

      const query: any = {}

      if (clientId) {
        query.clientId = clientId
      }

      this.logger.debug(`Query de búsqueda: ${JSON.stringify(query)}`)

      const expenses = await this.expenseRepository.find(query).exec()

      this.logger.debug(`Encontradas ${expenses.length} facturas para revisar`)

      for (const expense of expenses) {
        if (expense.data) {
          try {
            let dataObj: any = expense.data
            if (typeof dataObj === 'string') {
              dataObj = JSON.parse(dataObj)
            }

            this.logger.debug(
              `Revisando factura ${expense._id}: Serie: ${dataObj?.serie}, Correlativo: ${dataObj?.correlativo}, RUC: ${dataObj?.rucEmisor}`
            )

            if (
              dataObj &&
              dataObj.serie === serie &&
              dataObj.correlativo === correlativo &&
              (!rucEmisor || dataObj.rucEmisor === rucEmisor)
            ) {
              this.logger.debug(`DUPLICADO ENCONTRADO: Factura ${expense._id}`)
              return expense
            }
          } catch (error) {
            this.logger.warn(
              `Error parseando data de factura ${expense._id}:`,
              error
            )
            continue
          }
        }
      }

      this.logger.debug(`No se encontraron duplicados`)
      return null
    } catch (error) {
      this.logger.error(
        'Error al buscar factura por serie y correlativo:',
        error
      )
      throw new HttpException(
        'Error al validar duplicados',
        HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  private async uploadExpensePdfAndGetUrl(
    file: Express.Multer.File,
    clientId: string
  ): Promise<string> {
    const fileNameSafe = `expenses/${clientId}/${Date.now()}-${(file.originalname || 'document.pdf').replace(/\s+/g, '-')}`
    return this.uploadService.uploadImage(file, fileNameSafe)
  }

  async validateWithSunatData(
    id: string,
    data: {
      rucEmisor: string
      serie: string
      correlativo: string
      fechaEmision: string
      montoTotal?: number
      tipoComprobante?: string
    },
    clientId: string,
    actor: ExpenseActorContext
  ) {
    const expense = await this.loadExpenseOrThrow(id)
    await this.assertCanMutateExpense(expense, actor)

    try {
      // Paso 1: obtener razón social fresca para el RUC emisor
      let updatedData: string | undefined
      if (data.rucEmisor) {
        const { razonSocial } = await this.getRucInfo(data.rucEmisor, clientId)
        if (razonSocial) {
          let parsed: any = {}
          try {
            parsed = typeof expense.data === 'string' ? JSON.parse(expense.data) : (expense.data ?? {})
          } catch {}
          updatedData = JSON.stringify({ ...parsed, razonSocial })
          this.logger.log(`[validateWithSunatData] razonSocial actualizada para RUC ${data.rucEmisor}: ${razonSocial}`)
        }
      }

      // Paso 2: validar comprobante con SUNAT
      const configSunat = await this.sunatConfigService.findOne(clientId)
      const { validation, expenseStatus } =
        await this.validateWithSunatIfPossible(data, clientId, configSunat?.ruc)

      // Paso 3: guardar razón social + resultado de validación en un solo update
      const updateDoc: any = { sunatValidation: validation, status: expenseStatus }
      if (updatedData !== undefined) updateDoc.data = updatedData

      const updatedExpense = await this.expenseRepository
        .findByIdAndUpdate(id, updateDoc, { new: true })
        .exec()

      return {
        message: 'Validación SUNAT completada',
        status: validation.status,
        details: validation.details,
        expense: updatedExpense,
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        return {
          message: 'No se encontró configuración SUNAT para esta empresa',
          status: 'SUNAT_CONFIG_NOT_FOUND',
          details: 'La empresa no tiene configuración SUNAT configurada',
          expense: expense,
        }
      }
      throw error
    }
  }

  // ─── Aprobación dual: Coordinador / Contabilidad ─────────────────────────────

  private computeCombinedStatus(
    coordStatus: string | undefined,
    contStatus: string | undefined
  ): 'pending' | 'approved' | 'rejected' {
    if (coordStatus === 'rejected' || contStatus === 'rejected') return 'rejected'
    if (coordStatus === 'approved' && contStatus === 'approved') return 'approved'
    return 'pending'
  }

  async approveByCoord(
    id: string,
    actor: ExpenseActorContext
  ): Promise<Expense> {
    const expense = await this.loadExpenseOrThrow(id)
    this.assertCompanyAccess(expense, actor)
    const existing = expense as any
    const contStatus = existing.approvalCont?.status ?? 'pending'
    const newCombined = this.computeCombinedStatus('approved', contStatus)
    const updated = await this.expenseRepository
      .findByIdAndUpdate(
        id,
        {
          $set: {
            approvalCoord: { status: 'approved', userId: actor.userId, userName: actor.roleName, date: new Date() },
            status: newCombined,
          },
        },
        { new: true }
      )
      .exec()
    if (!updated) throw new NotFoundException(`Expense ${id} no encontrado`)
    this.notificationsService
      .create({
        userId: String(expense.createdBy),
        title: 'Comprobante revisado por Coordinador',
        message: `Tu comprobante fue aprobado por el coordinador.`,
        type: 'info',
        actionUrl: `/mis-rendiciones/${this.expenseReportIdString(expense)}/detalle`,
      })
      .catch(() => {})
    return updated
  }

  async rejectByCoord(
    id: string,
    actor: ExpenseActorContext,
    reason: string
  ): Promise<Expense> {
    if (!reason?.trim()) throw new BadRequestException('El motivo de rechazo es obligatorio.')
    const expense = await this.loadExpenseOrThrow(id)
    this.assertCompanyAccess(expense, actor)
    const updated = await this.expenseRepository
      .findByIdAndUpdate(
        id,
        {
          $set: {
            approvalCoord: { status: 'rejected', userId: actor.userId, userName: actor.roleName, date: new Date(), reason },
            status: 'rejected',
            rejectionReason: reason,
          },
        },
        { new: true }
      )
      .exec()
    if (!updated) throw new NotFoundException(`Expense ${id} no encontrado`)
    this.notificationsService
      .create({
        userId: String(expense.createdBy),
        title: 'Comprobante observado por Coordinador',
        message: `Tu comprobante fue rechazado por el coordinador: ${reason.slice(0, 80)}`,
        type: 'error',
        actionUrl: `/mis-rendiciones/${this.expenseReportIdString(expense)}/detalle`,
      })
      .catch(() => {})
    return updated
  }

  async approveByContabilidad(
    id: string,
    actor: ExpenseActorContext
  ): Promise<Expense> {
    const expense = await this.loadExpenseOrThrow(id)
    this.assertCompanyAccess(expense, actor)
    const existing = expense as any
    const coordStatus = existing.approvalCoord?.status ?? 'pending'
    const newCombined = this.computeCombinedStatus(coordStatus, 'approved')
    const updated = await this.expenseRepository
      .findByIdAndUpdate(
        id,
        {
          $set: {
            approvalCont: { status: 'approved', userId: actor.userId, userName: actor.roleName, date: new Date() },
            status: newCombined,
          },
        },
        { new: true }
      )
      .exec()
    if (!updated) throw new NotFoundException(`Expense ${id} no encontrado`)
    this.notificationsService
      .create({
        userId: String(expense.createdBy),
        title: 'Comprobante revisado por Contabilidad',
        message: `Tu comprobante fue aprobado por contabilidad.`,
        type: 'info',
        actionUrl: `/mis-rendiciones/${this.expenseReportIdString(expense)}/detalle`,
      })
      .catch(() => {})
    return updated
  }

  async rejectByContabilidad(
    id: string,
    actor: ExpenseActorContext,
    reason: string
  ): Promise<Expense> {
    if (!reason?.trim()) throw new BadRequestException('El motivo de rechazo es obligatorio.')
    const expense = await this.loadExpenseOrThrow(id)
    this.assertCompanyAccess(expense, actor)
    const updated = await this.expenseRepository
      .findByIdAndUpdate(
        id,
        {
          $set: {
            approvalCont: { status: 'rejected', userId: actor.userId, userName: actor.roleName, date: new Date(), reason },
            status: 'rejected',
            rejectionReason: reason,
          },
        },
        { new: true }
      )
      .exec()
    if (!updated) throw new NotFoundException(`Expense ${id} no encontrado`)
    this.notificationsService
      .create({
        userId: String(expense.createdBy),
        title: 'Comprobante observado por Contabilidad',
        message: `Tu comprobante fue rechazado por contabilidad: ${reason.slice(0, 80)}`,
        type: 'error',
        actionUrl: `/mis-rendiciones/${this.expenseReportIdString(expense)}/detalle`,
      })
      .catch(() => {})
    return updated
  }

  async batchApproveByCollaborator(
    reportId: string,
    actor: ExpenseActorContext
  ): Promise<{ approved: number }> {
    const report = await (this.expenseReportService as any).expenseReportModel
      ?.findById(reportId)
      .select('expenseIds clientId userId')
      .lean()
      .exec()
    if (!report) throw new NotFoundException(`Rendición ${reportId} no encontrada`)

    const clientId = this.normalizeClientId(report.clientId)
    if (actor.roleName !== ROLES.SUPER_ADMIN && actor.clientId && clientId !== actor.clientId) {
      throw new ForbiddenException('No autorizado')
    }

    const ids = (report.expenseIds ?? []).map((id: any) => new Types.ObjectId(String(id)))
    if (ids.length === 0) return { approved: 0 }

    const expenses = await this.expenseRepository
      .find({ _id: { $in: ids } })
      .select('approvalCont status')
      .lean()
      .exec()

    let count = 0
    for (const expense of expenses) {
      const e = expense as any
      const contStatus = e.approvalCont?.status ?? 'pending'
      if (contStatus === 'approved' && e.status !== 'approved') {
        await this.expenseRepository.findByIdAndUpdate(String(e._id), {
          $set: { status: 'approved' },
        }).exec()
        count++
      }
    }
    return { approved: count }
  }

  async batchApproveByCoord(
    reportId: string,
    actor: ExpenseActorContext
  ): Promise<{ approved: number }> {
    const { Model: ExpenseModel } = { Model: this.expenseRepository }
    const report = await (this.expenseReportService as any).expenseReportModel
      ?.findById(reportId)
      .select('expenseIds clientId')
      .lean()
      .exec()
    if (!report) throw new NotFoundException(`Rendición ${reportId} no encontrada`)

    const clientId = this.normalizeClientId(report.clientId)
    if (actor.roleName !== ROLES.SUPER_ADMIN && actor.clientId && clientId !== actor.clientId) {
      throw new ForbiddenException('No autorizado')
    }

    const ids = (report.expenseIds ?? []).map((id: any) => new Types.ObjectId(String(id)))
    if (ids.length === 0) return { approved: 0 }

    const expenses = await this.expenseRepository
      .find({ _id: { $in: ids } })
      .select('approvalCoord approvalCont status createdBy expenseReportId')
      .lean()
      .exec()

    let count = 0
    for (const expense of expenses) {
      const e = expense as any
      const contStatus = e.approvalCont?.status ?? 'pending'
      const coordStatus = e.approvalCoord?.status ?? 'pending'
      if (contStatus === 'approved' && coordStatus !== 'approved') {
        const newCombined = this.computeCombinedStatus('approved', 'approved')
        await this.expenseRepository.findByIdAndUpdate(String(e._id), {
          $set: {
            approvalCoord: { status: 'approved', userId: actor.userId, userName: actor.roleName, date: new Date() },
            status: newCombined,
          },
        }).exec()
        count++
      }
    }
    return { approved: count }
  }

  /**
   * Gastos directos del colaborador: expenses sin rendición (loose) + expenses de rendiciones isDirecta.
   */
  async findMyDirectExpenses(
    userId: string,
    clientId: string,
    filters: { tipo?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number } = {}
  ) {
    const page = Math.max(1, filters.page ?? 1)
    const limit = Math.min(100, filters.limit ?? 50)
    const skip = (page - 1) * limit

    // Obtener IDs de rendiciones directas del usuario
    const ExpenseReport = this.expenseReportService['expenseReportModel'] as any
    const directReportDocs = await ExpenseReport.find({
      userId: new Types.ObjectId(userId),
      clientId: new Types.ObjectId(clientId),
      isDirecta: true,
    }).select('_id status').lean().exec()
    const directReportIds = directReportDocs.map((r: any) => r._id)
    const directReportStatusMap = new Map<string, string>(
      directReportDocs.map((r: any) => [String(r._id), r.status])
    )

    // Buscar expenses: loose (sin rendición) O en rendición directa, del mismo usuario/cliente
    const match: any = {
      clientId: new Types.ObjectId(clientId),
      createdBy: userId,
      $or: [
        { expenseReportId: { $exists: false } },
        { expenseReportId: null },
        ...(directReportIds.length > 0 ? [{ expenseReportId: { $in: directReportIds } }] : []),
      ],
    }

    if (filters.tipo && filters.tipo !== 'all') {
      match.expenseType = filters.tipo
    }

    const pipeline: any[] = [{ $match: match }]

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
      if (filters.dateTo) { const to = new Date(filters.dateTo); to.setHours(23, 59, 59, 999); dateMatch.$lte = to }
      pipeline.push({ $match: { _parsedDate: dateMatch } })
    }

    pipeline.push(
      { $lookup: { from: 'categories', localField: 'categoryId', foreignField: '_id', as: '_cat' } },
      { $lookup: { from: 'projects', localField: 'proyectId', foreignField: '_id', as: '_proj' } },
    )

    const countPipeline = [...pipeline, { $count: 'total' }]
    const countResult = await this.expenseRepository.aggregate(countPipeline).exec()
    const total = countResult[0]?.total ?? 0

    pipeline.push({ $sort: { createdAt: -1 } }, { $skip: skip }, { $limit: limit })

    const expenses = await this.expenseRepository.aggregate(pipeline).exec()

    const data = expenses.map((e: any) => ({
      ...e,
      _categoryDoc: e._cat?.[0] ?? null,
      _projectDoc: e._proj?.[0] ?? null,
      _reportStatus: e.expenseReportId ? (directReportStatusMap.get(String(e.expenseReportId)) ?? null) : null,
    }))

    return { data, total, page, limit, pages: Math.ceil(total / limit) }
  }

  /**
   * Agrupa los expenses loose del usuario en una rendición directa y la envía a contabilidad.
   */
  async submitMyDirectExpenses(
    userId: string,
    clientId: string,
    motivo?: string
  ) {
    // Buscar expenses loose (sin rendición) del usuario
    const looseExpenses = await this.expenseRepository.find({
      clientId: new Types.ObjectId(clientId),
      createdBy: userId,
      $or: [{ expenseReportId: { $exists: false } }, { expenseReportId: null }],
    }).select('_id total').lean().exec()

    if (looseExpenses.length === 0) {
      throw new BadRequestException('No tienes gastos pendientes de enviar.')
    }

    const today = new Date()
    const label = today.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const report = await this.expenseReportService.create(
      {
        motivo: motivo?.trim() || `Gastos del ${label}`,
        isDirecta: true,
        userId,
        clientId,
      } as any,
      userId,
      true
    )

    const reportId = (report as any)._id.toString()

    // Vincular expenses a la rendición
    await this.expenseRepository.updateMany(
      { _id: { $in: looseExpenses.map((e: any) => e._id) } },
      { $set: { expenseReportId: new Types.ObjectId(reportId) } }
    ).exec()

    // Registrar en la rendición
    await this.expenseReportService['expenseReportModel'].findByIdAndUpdate(
      reportId,
      { $set: { expenseIds: looseExpenses.map((e: any) => e._id) } }
    ).exec()

    // Enviar a pending_accounting (isDirecta auto-transiciona desde submitted)
    const updatedReport = await this.expenseReportService.update(reportId, { status: 'submitted' } as any)

    return { reportId, expensesSubmitted: looseExpenses.length, report: updatedReport }
  }
}
