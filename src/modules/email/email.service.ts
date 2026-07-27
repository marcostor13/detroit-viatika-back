import { Injectable, Logger } from '@nestjs/common'
import { MailerService } from '@nestjs-modules/mailer'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Client, ClientDocument } from '../client/entities/client.entity'
import {
  getRequestOrigin,
  toOrigin,
} from '../../common/request-origin.context'

/**
 * URL del front que se usa cuando la petición no trae un origen utilizable
 * (tareas programadas, seeds) y no hay `APP_PUBLIC_URL` configurada.
 * Es el front de Detroit; el caso normal es que el origen salga de la propia
 * petición — ver `getPublicAppBaseUrl()`.
 */
const DEFAULT_APP_URL = 'https://detroit-viatika.netlify.app'
const CLIENT_LOGO_CACHE_TTL_MS = 60_000

/**
 * Orígenes de front aceptados para construir los enlaces de los correos cuando
 * no hay `APP_ALLOWED_ORIGINS` en el entorno. Al pasar a producción basta
 * añadir el dominio nuevo a esa variable (lista separada por comas) sin tocar
 * código.
 */
const BUILT_IN_ALLOWED_ORIGINS = ['https://detroit-viatika.netlify.app']

/** `localhost`/`127.0.0.1` en cualquier puerto: solo fuera de producción. */
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i

/**
 * Logo por defecto de los correos cuando la empresa NO tiene `client.logo`
 * configurado (VD-81). Es el logo de Detroit (`logo_header.png`), servido por
 * el frontend de Detroit — NO el `/logo.svg` genérico (que renderiza el logo de
 * "tema"). Se puede sobrescribir por entorno con `APP_LOGO_URL`.
 */
const DEFAULT_EMAIL_LOGO_URL =
  'https://detroit-viatika.netlify.app/logo_header.png'

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name)
  private readonly clientLogoCache = new Map<
    string,
    { url: string; expiresAt: number }
  >()

  constructor(
    private readonly mailerService: MailerService,
    @InjectModel(Client.name)
    private readonly clientModel: Model<ClientDocument>
  ) {}

  private async send(
    options: Parameters<MailerService['sendMail']>[0]
  ): Promise<void> {
    if (process.env.EMAILS_ENABLED === 'false') {
      this.logger.debug(
        `[EMAILS DISABLED] Omitiendo envío a ${options.to} — ${options.subject}`
      )
      return
    }
    // Pase final: normaliza cualquier `yyyy-mm-dd` que aún pueda haberse colado
    // en el subject o en cualquier string del context. Idempotente con dd/mm/aaaa.
    if (options.subject && typeof options.subject === 'string') {
      options.subject = this.normalizeIsoDatesInText(options.subject)
    }
    if (options.context && typeof options.context === 'object') {
      const ctx = options.context as Record<string, unknown>
      for (const [k, v] of Object.entries(ctx)) {
        if (typeof v === 'string') {
          ctx[k] = this.normalizeIsoDatesInText(v)
        }
      }
      // Defaults para el header/footer compartido (VD-81): garantiza que
      // `logoUrl` exista siempre, para no romper el modo strict de Handlebars
      // aunque un método olvide pasarlo. `year` ya no lo pinta ninguna
      // plantilla (el pie dejó de llevar el «© año Viatika»), pero se sigue
      // rellenando por si alguna vuelve a necesitarlo.
      if (ctx.logoUrl === undefined || ctx.logoUrl === null || ctx.logoUrl === '') {
        ctx.logoUrl = this.getLogoUrl()
      }
      if (ctx.year === undefined || ctx.year === null) {
        ctx.year = new Date().getFullYear()
      }
      // `platformUrl` y `currencySymbol` también se garantizan: el formato
      // estándar de correo (badge → título → saludo → «Detalles rápidos» →
      // botón) los usa en TODAS las plantillas, y en modo strict un
      // `{{platformUrl}}` ausente aborta el render del correo entero.
      if (
        ctx.platformUrl === undefined ||
        ctx.platformUrl === null ||
        ctx.platformUrl === ''
      ) {
        ctx.platformUrl = this.getPublicAppBaseUrl()
      }
      if (
        ctx.currencySymbol === undefined ||
        ctx.currencySymbol === null ||
        ctx.currencySymbol === ''
      ) {
        ctx.currencySymbol = 'S/'
      }
    }
    await this.mailerService.sendMail(options)
  }

  /** URL configurada por entorno, sin la barra final. */
  private configuredAppBaseUrl(): string {
    const raw = (
      process.env.APP_PUBLIC_URL ||
      process.env.FRONTEND_URL ||
      ''
    ).trim()
    return raw.replace(/\/+$/, '')
  }

  /**
   * Orígenes de front a los que se permite enlazar desde un correo.
   *
   * `APP_ALLOWED_ORIGINS` (lista separada por comas) manda; si no está, se usan
   * los conocidos de Detroit más lo que haya en `APP_PUBLIC_URL`/`FRONTEND_URL`.
   */
  private allowedFrontOrigins(): string[] {
    const fromEnv = (process.env.APP_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map(o => toOrigin(o))
      .filter(Boolean)
    if (fromEnv.length > 0) return fromEnv

    const configured = toOrigin(this.configuredAppBaseUrl())
    return [
      ...BUILT_IN_ALLOWED_ORIGINS,
      ...(configured ? [configured] : []),
    ]
  }

  /**
   * Decide si el origen de la petición en curso puede escribirse en un correo.
   *
   * Importa porque `Origin`/`Referer` los pone el cliente: sin este filtro,
   * quien pudiera disparar un envío marcaría el origen que quisiera y el
   * destinatario —un aprobador, Contabilidad— recibiría un correo con la
   * imagen de Detroit y un botón hacia un sitio ajeno.
   */
  private isAllowedFrontOrigin(origin: string): boolean {
    if (!origin) return false
    if (
      process.env.NODE_ENV !== 'production' &&
      LOCALHOST_ORIGIN.test(origin)
    ) {
      return true
    }
    return this.allowedFrontOrigins().some(
      allowed => allowed.toLowerCase() === origin.toLowerCase()
    )
  }

  /**
   * URL pública del front para los enlaces de los correos, en este orden:
   *
   *  1. El origen de la petición HTTP en curso, si está permitido. Así un mismo
   *     backend sirve a `localhost`, al front de desarrollo y al de producción,
   *     y cada correo enlaza al front desde el que se hizo la acción.
   *  2. `APP_PUBLIC_URL` / `FRONTEND_URL` del entorno.
   *  3. `DEFAULT_APP_URL`, para lo que no nace de una petición (recordatorios
   *     programados, scripts).
   */
  getPublicAppBaseUrl(): string {
    const requestOrigin = getRequestOrigin()
    if (requestOrigin) {
      if (this.isAllowedFrontOrigin(requestOrigin)) return requestOrigin
      this.logger.warn(
        `Origen no permitido para enlaces de correo: ${requestOrigin}. ` +
          'Se usa la URL configurada. Añádelo a APP_ALLOWED_ORIGINS si es legítimo.'
      )
    }
    return this.configuredAppBaseUrl() || DEFAULT_APP_URL
  }

  /** Ruta absoluta en el front, p. ej. `/tesoreria` → `https://…/tesoreria` */
  buildAppUrl(path?: string): string {
    const base = this.getPublicAppBaseUrl()
    if (!path?.trim()) return base
    const p = path.trim()
    if (/^https?:\/\//i.test(p)) {
      return p.replace(/\/+$/, '')
    }
    const suffix = p.startsWith('/') ? p : `/${p}`
    return `${base}${suffix}`
  }

  getLogoUrl(): string {
    const logo = process.env.APP_LOGO_URL?.trim()
    if (logo) return logo
    // Fallback de marca: logo de Detroit (VD-81). Antes usaba `/logo.svg`, que
    // en el dominio compartido sirve el logo de "tema".
    return DEFAULT_EMAIL_LOGO_URL
  }

  /** Extrae `clientId` de un objeto `data` arbitrario sin forzar todas las firmas a tiparlo. */
  private extractClientId(data: unknown): string | null | undefined {
    if (!data || typeof data !== 'object') return undefined
    const v = (data as { clientId?: unknown }).clientId
    if (v === null || v === undefined) return undefined
    if (typeof v === 'string') return v
    if (v instanceof Types.ObjectId) return v.toString()
    return String(v)
  }

  /**
   * Resuelve el logo a mostrar en correos:
   *  - Si `clientId` es válido y la empresa tiene logo configurado, lo usa.
   *  - Si no, recurre al logo global (`APP_LOGO_URL` / `/logo.svg`).
   * Cache en memoria por 60s para no golpear la BD por cada correo.
   */
  async resolveLogoUrl(
    clientId?: string | Types.ObjectId | null
  ): Promise<string> {
    if (!clientId) return this.getLogoUrl()
    const key = String(clientId)
    if (!Types.ObjectId.isValid(key)) return this.getLogoUrl()

    const cached = this.clientLogoCache.get(key)
    const now = Date.now()
    if (cached && cached.expiresAt > now) {
      return cached.url || this.getLogoUrl()
    }

    let resolved = ''
    try {
      const client = await this.clientModel
        .findById(key)
        .select('logo')
        .lean<{ logo?: string }>()
        .exec()
      const raw = client?.logo?.trim()
      if (raw) {
        resolved = /^https?:\/\//i.test(raw) ? raw : this.buildAppUrl(raw)
      }
    } catch (err) {
      this.logger.warn(
        `No se pudo cargar logo de cliente ${key}: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    this.clientLogoCache.set(key, {
      url: resolved,
      expiresAt: now + CLIENT_LOGO_CACHE_TTL_MS,
    })
    return resolved || this.getLogoUrl()
  }

  private normalizeCurrencySymbol(currency?: string | null): string {
    const value = currency?.trim()
    if (!value) return ''

    switch (value.toUpperCase()) {
      case 'PEN':
      case 'S/':
      case 'SOL':
      case 'SOLES':
        return 'S/'
      case 'USD':
      case '$':
      case 'US$':
      case 'DOLAR':
      case 'DOLARES':
      case 'DÓLAR':
      case 'DÓLARES':
        return '$'
      default:
        return value
    }
  }

  /**
   * Reemplaza cualquier ocurrencia de fecha en formato `yyyy-mm-dd` dentro de
   * un texto por `dd/mm/aaaa`. Útil para títulos heredados que se construyeron
   * con el formato ISO antes de la normalización.
   */
  normalizeIsoDatesInText(text?: string | null): string {
    if (!text) return ''
    return String(text).replace(
      /\b(\d{4})-(\d{2})-(\d{2})\b/g,
      (_, y, m, d) => `${d}/${m}/${y}`
    )
  }

  /** Normaliza fechas a `dd/mm/aaaa` para todas las plantillas de correo. */
  formatDateDDMMYYYY(value?: Date | string | number | null): string {
    if (value === null || value === undefined || value === '') return ''

    if (typeof value === 'string') {
      const trimmed = value.trim()
      // ISO yyyy-mm-dd (con o sin hora).
      const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)
      if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`
      // Variantes d/m/yyyy, dd/m/yyyy, d/mm/yyyy y dd/mm/yyyy: normaliza zero-pad.
      const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed)
      if (slashMatch) {
        const dd = slashMatch[1].padStart(2, '0')
        const mm = slashMatch[2].padStart(2, '0')
        return `${dd}/${mm}/${slashMatch[3]}`
      }
    }

    const d = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(d.getTime())) return String(value)

    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    return `${dd}/${mm}/${yyyy}`
  }

  private formatCurrencyAmount(
    amount?: number | string | null,
    currency?: string | null
  ): string {
    if (amount === undefined || amount === null || amount === '') return ''

    const numericAmount =
      typeof amount === 'number' ? amount : Number.parseFloat(String(amount))
    const amountText = Number.isFinite(numericAmount)
      ? Number.isInteger(numericAmount)
        ? String(numericAmount)
        : numericAmount.toFixed(2)
      : String(amount).trim()

    const symbol = this.normalizeCurrencySymbol(currency)
    return symbol ? `${symbol} ${amountText}` : amountText
  }

  /** `platformUrl` en plantillas: absoluta del caller o base + ruta relativa. */
  resolvePlatformHref(url?: string | null): string {
    const s = url?.trim()
    if (!s) return this.getPublicAppBaseUrl()
    if (/^https?:\/\//i.test(s)) {
      return s.replace(/\/+$/, '')
    }
    return this.buildAppUrl(s)
  }

  /**
   * Asunto estándar: `Base — referencia`, con guion largo y sin dejar el
   * separador colgando cuando la referencia viene vacía (antes producía
   * asuntos como «Solicitud aprobada - »).
   */
  private withSubjectRef(base: string, ref?: string | null): string {
    const s = ref?.trim()
    return s ? `${base} — ${s}` : base
  }

  getCode() {
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    return code
  }

  async sendCodeConfirmation(email: string, clientId?: string) {
    try {
      this.logger.debug(`Enviando código de confirmación a ${email}`)
      await this.send({
        to: email,
        subject: 'Verifique su correo',
        // La plantilla se llama `send-code.hbs`; `./confirmation` no existe y
        // hacía fallar el envío del código de verificación.
        template: './send-code',
        context: {
          logoUrl: await this.resolveLogoUrl(clientId),
          verificationCode: this.getCode(),
          year: new Date().getFullYear(),
        },
      })
      this.logger.debug(
        `Código de confirmación enviado exitosamente a ${email}`
      )
    } catch (error) {
      this.logger.error(
        `Error al enviar código de confirmación a ${email}:`,
        error
      )
      throw error
    }
  }

  async sendInvoiceNotification(
    email: string,
    data: {
      clientId?: string
      providerName: string
      invoiceNumber: string
      date: string
      type: string
    }
  ) {
    try {
      this.logger.debug(`Enviando notificación de factura a ${email}`, data)
      await this.send({
        to: email,
        subject: 'Nueva factura subida',
        template: './invoice-notification',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          providerName: data.providerName,
          invoiceNumber: data.invoiceNumber,
          date: this.formatDateDDMMYYYY(data.date),
          type: data.type,
          year: new Date().getFullYear(),
        },
      })
      this.logger.debug(
        `Notificación de factura enviada exitosamente a ${email}`
      )
    } catch (error) {
      this.logger.error(
        `Error al enviar notificación de factura a ${email}:`,
        error
      )
      throw error
    }
  }

  async sendPaymentScheduledNotification(
    email: string,
    invoiceNumber: string,
    paymentDate: string,
    clientId?: string
  ) {
    await this.send({
      to: email,
      subject: 'Pago programado',
      template: './payment-scheduled',
      context: {
        logoUrl: await this.resolveLogoUrl(clientId),
        invoiceNumber,
        paymentDate: this.formatDateDDMMYYYY(paymentDate),
        year: new Date().getFullYear(),
      },
    })
  }

  async sendAccountingDecisionNotification(
    email: string,
    invoiceNumber: string,
    decision: 'approved' | 'rejected',
    reason?: string,
    clientId?: string
  ) {
    await this.send({
      to: email,
      subject: `Factura ${decision === 'approved' ? 'aprobada' : 'rechazada'}`,
      template: './accounting-decision',
      context: {
        logoUrl: await this.resolveLogoUrl(clientId),
        invoiceNumber,
        decisionText: decision === 'approved' ? 'Aprobada' : 'Rechazada',
        reason,
        year: new Date().getFullYear(),
      },
    })
  }

  async sendActaNotification(
    email: string,
    data: {
      clientId?: string
      providerName: string
      invoiceNumber: string
      date: string
    }
  ) {
    try {
      this.logger.debug(`Enviando notificación de acta a ${email}`)
      await this.send({
        to: email,
        subject: 'Acta de aceptación subida',
        template: './acta-notification',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          providerName: data.providerName,
          invoiceNumber: data.invoiceNumber,
          date: this.formatDateDDMMYYYY(data.date),
          year: new Date().getFullYear(),
        },
      })
      this.logger.debug(`Notificación de acta enviada exitosamente a ${email}`)
    } catch (error) {
      this.logger.error(
        `Error al enviar notificación de acta a ${email}:`,
        error
      )
      throw error
    }
  }

  async sendInvoiceUploadedNotification(
    email: string,
    data: {
      clientId?: string
      providerName: string
      invoiceNumber: string
      date: Date
      type: string
      createdBy?: string
      razonSocial?: string
      montoTotal?: number
      moneda?: string
      status?: string
      showAdditionalInfo?: boolean
      category?: string
      projectName?: string
      direccionEmisor?: string
    }
  ) {
    try {
      this.logger.debug(`Enviando notificación de factura subida a ${email}`)
      await this.send({
        to: email,
        subject:
          'Nueva factura subida — ' + (data.createdBy || data.providerName),
        template: './invoice-notification',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          providerName: data.providerName,
          invoiceNumber: data.invoiceNumber,
          date: this.formatDateDDMMYYYY(data.date),
          type: data.type,
          createdBy: data.createdBy || data.providerName,
          year: new Date().getFullYear(),
          razonSocial: data.razonSocial,
          montoTotalFormatted: this.formatCurrencyAmount(
            data.montoTotal,
            data.moneda
          ),
          status: data.status,
          showAdditionalInfo: data.showAdditionalInfo,
          category: data.category,
          projectName: data.projectName,
          direccionEmisor: data.direccionEmisor,
        },
      })
      this.logger.debug(
        `Notificación de factura enviada exitosamente a ${email}`
      )
    } catch (error) {
      this.logger.error(`Error al enviar notificación a ${email}:`, error)
      // No lanzamos el error para no interrumpir el flujo
    }
  }

  async sendActaUploadedNotification(
    email: string,
    data: {
      clientId?: string
      providerName: string
      invoiceNumber: string
      date: Date
      type: string
      createdBy?: string
      razonSocial?: string
      montoTotal?: number
      moneda?: string
      status?: string
      showAdditionalInfo?: boolean
      category?: string
      projectName?: string
      direccionEmisor?: string
    }
  ) {
    try {
      this.logger.debug(`Enviando notificación de acta subida a ${email}`)
      await this.send({
        to: email,
        subject:
          'Acta de aprobación subida — ' +
          (data.createdBy || data.providerName),
        template: './acta-notification',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          providerName: data.providerName,
          invoiceNumber: data.invoiceNumber,
          date: this.formatDateDDMMYYYY(data.date),
          type: data.type,
          createdBy: data.createdBy || data.providerName,
          year: new Date().getFullYear(),
          razonSocial: data.razonSocial,
          montoTotalFormatted: this.formatCurrencyAmount(
            data.montoTotal,
            data.moneda
          ),
          status: data.status,
          showAdditionalInfo: data.showAdditionalInfo,
          category: data.category,
          projectName: data.projectName,
          direccionEmisor: data.direccionEmisor,
        },
      })
      this.logger.debug(`Notificación de acta enviada exitosamente a ${email}`)
    } catch (error) {
      this.logger.error(`Error al enviar notificación a ${email}:`, error)
      // No lanzamos el error para no interrumpir el flujo
    }
  }

  async sendInvoiceUploadedExpenseNotification(
    email: string,
    data: {
      clientId?: string
      providerName: string
      invoiceNumber: string
      date: string
      type: string
      status: string
      montoTotal: number
      moneda: string
      createdBy?: string
      category?: string
      projectName?: string
      razonSocial?: string
      direccionEmisor?: string
    }
  ) {
    try {
      this.logger.debug(`Enviando notificación de factura de gastos a ${email}`)
      await this.send({
        to: email,
        subject:
          'Nueva factura de gastos subida — ' +
          (data.createdBy || data.providerName),
        template: './invoice-notification',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          providerName: data.providerName,
          invoiceNumber: data.invoiceNumber,
          date: this.formatDateDDMMYYYY(data.date),
          type: data.type,
          status: data.status,
          montoTotalFormatted: this.formatCurrencyAmount(
            data.montoTotal,
            data.moneda
          ),
          createdBy: data.createdBy || data.providerName,
          year: new Date().getFullYear(),
          category: data.category || 'No especificada',
          projectName: data.projectName || 'No especificado',
          razonSocial: data.razonSocial || 'No especificada',
          direccionEmisor: data.direccionEmisor,
          showAdditionalInfo: true,
        },
      })
      this.logger.debug(
        `Notificación de factura enviada exitosamente a ${email}`
      )
    } catch (error) {
      this.logger.error(`Error al enviar notificación a ${email}:`, error)
      // No lanzamos el error para no interrumpir el flujo
    }
  }

  async sendInvoiceApprovedNotification(
    email: string,
    data: {
      clientId?: string
      providerName: string
      invoiceNumber: string
      date: string
      type: string
      approvedBy?: string
    }
  ) {
    try {
      await this.send({
        to: email,
        subject: 'Factura aprobada',
        template: 'invoice-approved',
        context: {
          providerName: data.providerName,
          invoiceNumber: data.invoiceNumber,
          date: this.formatDateDDMMYYYY(data.date),
          type: data.type,
          approvedBy: data.approvedBy || 'Administrador del sistema',
        },
      })
    } catch (error) {
      this.logger.error(
        `Error al enviar notificación de factura aprobada: ${error.message}`
      )
      throw error
    }
  }

  async sendInvoiceRejectedNotification(
    email: string,
    data: {
      clientId?: string
      providerName: string
      invoiceNumber: string
      date: string
      type: string
      rejectionReason: string
      rejectedBy?: string
    }
  ) {
    try {
      await this.send({
        to: email,
        subject: 'Factura rechazada',
        template: 'invoice-rejected',
        context: {
          providerName: data.providerName,
          invoiceNumber: data.invoiceNumber,
          date: this.formatDateDDMMYYYY(data.date),
          type: data.type,
          rejectionReason: data.rejectionReason,
          rejectedBy: data.rejectedBy || 'Administrador del sistema',
        },
      })
    } catch (error) {
      this.logger.error(
        `Error al enviar notificación de factura rechazada: ${error.message}`
      )
      throw error
    }
  }

  async sendInvoiceDecisionNotification(
    email: string,
    data: {
      clientId?: string
      providerName: string
      invoiceNumber: string
      date: string
      type: string
      status: 'APPROVED' | 'REJECTED'
      rejectionReason?: string
    }
  ) {
    try {
      this.logger.debug(
        `[DEBUG] Enviando notificación de decisión de factura a ${email}`,
        data
      )

      await this.send({
        to: email,
        subject: `Factura ${data.status === 'APPROVED' ? 'aprobada para pago' : 'rechazada para pago'}`,
        template: 'invoice-decision',
        context: {
          providerName: data.providerName,
          invoiceNumber: data.invoiceNumber,
          date: this.formatDateDDMMYYYY(data.date),
          type: data.type,
          status: data.status,
          rejectionReason: data.rejectionReason,
          // Agregar helper para comparación de strings en el template
          eq: (a: string, b: string) => a === b,
        },
      })

      this.logger.debug(
        `[DEBUG] Notificación de decisión enviada exitosamente a ${email}`
      )
    } catch (error) {
      this.logger.error(
        `[DEBUG] Error al enviar notificación de decisión a ${email}: ${error.message}`,
        error.stack
      )
      throw error
    }
  }

  async sendProviderWelcomeEmail(
    email: string,
    data: {
      clientId?: string
      firstName: string
      lastName: string
      password: string
      loginUrl: string
    }
  ) {
    try {
      this.logger.debug(`Enviando correo de bienvenida a proveedor: ${email}`)
      await this.send({
        to: email,
        subject: 'Bienvenido a la plataforma',
        template: './provider-welcome',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          firstName: data.firstName,
          lastName: data.lastName,
          email: email,
          password: data.password,
          loginUrl: data.loginUrl,
          year: new Date().getFullYear(),
        },
      })
      this.logger.debug(`Correo de bienvenida enviado exitosamente a ${email}`)
    } catch (error) {
      this.logger.error(
        `Error al enviar correo de bienvenida a ${email}:`,
        error
      )
      throw error
    }
  }

  // Métodos específicos para la notificación a roles ADMIN2 y COLABORADOR
  async sendInvoiceCreatedToAdmin2(
    email: string,
    data: {
      clientId?: string
      providerName: string
      invoiceNumber: string
      date: string
      type: string
      status: string
      montoTotal: number
      moneda: string
      createdBy?: string
    }
  ) {
    try {
      this.logger.debug(
        `Enviando notificación de factura creada a admin2 ${email}`
      )
      await this.sendInvoiceUploadedExpenseNotification(email, data)
      this.logger.debug(
        `Notificación de factura creada enviada exitosamente a admin2 ${email}`
      )
    } catch (error) {
      this.logger.error(
        `Error al enviar notificación a admin2 ${email}:`,
        error
      )
      // No lanzamos el error para no interrumpir el flujo
    }
  }

  async sendInvoiceApprovedToColaborador(
    email: string,
    data: {
      clientId?: string
      providerName: string
      invoiceNumber: string
      date: string
      type: string
      approvedBy?: string
    }
  ) {
    try {
      this.logger.debug(
        `Enviando notificación de factura aprobada a colaborador ${email}`
      )
      await this.sendInvoiceApprovedNotification(email, data)
      this.logger.debug(
        `Notificación de factura aprobada enviada exitosamente a colaborador ${email}`
      )
    } catch (error) {
      this.logger.error(
        `Error al enviar notificación de aprobación a colaborador ${email}:`,
        error
      )
      // No lanzamos el error para no interrumpir el flujo
    }
  }

  async sendInvoiceRejectedToColaborador(
    email: string,
    data: {
      clientId?: string
      providerName: string
      invoiceNumber: string
      date: string
      type: string
      rejectionReason: string
      rejectedBy?: string
    }
  ) {
    try {
      this.logger.debug(
        `Enviando notificación de factura rechazada a colaborador ${email}`
      )
      await this.sendInvoiceRejectedNotification(email, data)
      this.logger.debug(
        `Notificación de factura rechazada enviada exitosamente a colaborador ${email}`
      )
    } catch (error) {
      this.logger.error(
        `Error al enviar notificación de rechazo a colaborador ${email}:`,
        error
      )
      // No lanzamos el error para no interrumpir el flujo
    }
  }

  async sendRendicionFullyApprovedEmail(
    email: string,
    data: {
      clientId?: string
      userName: string
      title: string
      budget: number
      platformUrl?: string
    }
  ) {
    try {
      this.logger.debug(`Enviando correo de rendición aprobada a ${email}`)
      await this.send({
        to: email,
        subject: this.withSubjectRef('Rendición aprobada', data.title),
        template: './rendicion-approved',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          userName: data.userName,
          title: this.normalizeIsoDatesInText(data.title),
          budget: `S/ ${Number(data.budget).toFixed(2)}`,
          platformUrl: this.resolvePlatformHref(data.platformUrl),
          year: new Date().getFullYear(),
        },
      })
      this.logger.debug(`Correo de rendición aprobada enviado a ${email}`)
    } catch (error) {
      this.logger.error(
        `Error al enviar correo de rendición aprobada a ${email}:`,
        error
      )
    }
  }

  /** Confirmación al colaborador de que su rendición fue enviada y queda pendiente de aprobación. */
  async sendRendicionSubmittedToColaborador(
    email: string,
    data: {
      clientId?: string
      collaboratorName: string
      reportTitle: string
      budgetFormatted: string
      expenseCount: number
      hasDirectaDeposit?: boolean
      depositFormatted?: string
      expenseTotalFormatted?: string
      saldoFormatted?: string
      platformUrl?: string
    }
  ) {
    try {
      const { platformUrl, ...rest } = data
      const reportTitle = this.normalizeIsoDatesInText(data.reportTitle)
      await this.send({
        to: email,
        subject: `Rendición enviada para aprobación — ${reportTitle}`,
        template: './rendicion-submitted-colaborador',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          reportTitle,
          platformUrl: this.resolvePlatformHref(platformUrl),
        },
      })
      this.logger.debug(
        `Confirmación de rendición enviada al colaborador ${email}`
      )
    } catch (error) {
      this.logger.error(
        `Error confirmación rendición colaborador ${email}:`,
        error
      )
    }
  }

  /** Notifica a Contabilidad que una rendición fue aprobada por Coordinador y queda pendiente de aprobación final. */
  async sendRendicionPendienteContabilidad(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      collaboratorName: string
      reportTitle: string
      budgetFormatted: string
      expenseCount: number
      platformUrl?: string
    }
  ) {
    try {
      const { platformUrl, ...rest } = data
      const reportTitle = this.normalizeIsoDatesInText(data.reportTitle)
      await this.send({
        to: email,
        subject: `Rendición pendiente de aprobación final — ${reportTitle}`,
        template: './rendicion-pendiente-contabilidad',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          reportTitle,
          platformUrl: this.resolvePlatformHref(platformUrl),
        },
      })
      this.logger.debug(
        `Correo rendición pendiente contabilidad enviado a ${email}`
      )
    } catch (error) {
      this.logger.error(
        `Error rendición pendiente contabilidad a ${email}:`,
        error
      )
    }
  }

  /** Notifica a Tesorería que una rendición fue aprobada y requiere pago al colaborador. */
  async sendRendicionAprobadaTesoreria(
    email: string,
    data: {
      clientId?: string
      reportTitle: string
      collaboratorName: string
      collaboratorDni?: string
      budgetFormatted: string
      bankName?: string
      accountType?: string
      accountNumber?: string
      cci?: string
      hasBankAccount: boolean
      platformUrl?: string
    }
  ) {
    console.log(`[EMAIL] sendRendicionAprobadaTesoreria -> ${email}`)
    try {
      const { platformUrl, ...rest } = data
      const reportTitle = this.normalizeIsoDatesInText(data.reportTitle)
      await this.send({
        to: email,
        subject: `Rendición aprobada, pendiente de pago — ${reportTitle}`,
        template: './rendicion-aprobada-tesoreria',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          reportTitle,
          platformUrl: this.resolvePlatformHref(platformUrl),
        },
      })
      console.log(`[EMAIL] sendRendicionAprobadaTesoreria ENVIADO a ${email}`)
    } catch (error) {
      console.error(`[EMAIL] sendRendicionAprobadaTesoreria ERROR a ${email}:`, error)
      this.logger.error(
        `Error rendicion aprobada tesoreria a ${email}:`,
        error
      )
    }
  }

  /** Notifica a Tesorería que un viático ≤ S/500 fue aprobado por el coordinador y requiere desembolso. */
  async sendViaticoAprobadoTesoreria(
    email: string,
    data: {
      clientId?: string
      advanceDescription: string
      collaboratorName: string
      collaboratorDni?: string
      budgetFormatted: string
      currencySymbol?: string
      projectLabel?: string
      bankName?: string
      accountType?: string
      accountNumber?: string
      cci?: string
      hasBankAccount: boolean
      platformUrl?: string
    }
  ) {
    console.log(`[EMAIL] sendViaticoAprobadoTesoreria -> ${email}`)
    try {
      const { platformUrl, ...rest } = data
      await this.send({
        to: email,
        subject: `Viático aprobado, pendiente de pago — ${data.advanceDescription}`,
        template: './viatico-aprobado-tesoreria',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          platformUrl: this.resolvePlatformHref(platformUrl),
        },
      })
      console.log(`[EMAIL] sendViaticoAprobadoTesoreria ENVIADO a ${email}`)
    } catch (error) {
      console.error(`[EMAIL] sendViaticoAprobadoTesoreria ERROR a ${email}:`, error)
      this.logger.error(`Error viatico aprobado tesoreria a ${email}:`, error)
    }
  }

  /** Notifica al colaborador que su rendición fue rechazada (coord o contabilidad). */
  async sendRendicionRechazadaColaborador(
    email: string,
    data: {
      clientId?: string
      collaboratorName: string
      reportTitle: string
      rejectionReason: string
      rejectedBy: string
      platformUrl?: string
    }
  ) {
    try {
      const { platformUrl, ...rest } = data
      const reportTitle = this.normalizeIsoDatesInText(data.reportTitle)
      await this.send({
        to: email,
        subject: `Rendición rechazada — ${reportTitle}`,
        template: './rendicion-rechazada-colaborador',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          reportTitle,
          platformUrl: this.resolvePlatformHref(platformUrl),
        },
      })
      this.logger.debug(
        `Correo rendición rechazada (colaborador) enviado a ${email}`
      )
    } catch (error) {
      this.logger.error(
        `Error rendición rechazada (colaborador) a ${email}:`,
        error
      )
    }
  }

  /** Notifica al coordinador que la rendición que aprobó fue rechazada por Contabilidad. */
  async sendRendicionRechazadaCoordinador(
    email: string,
    data: {
      clientId?: string
      coordinatorName: string
      collaboratorName: string
      reportTitle: string
      rejectionReason: string
      platformUrl?: string
    }
  ) {
    try {
      const { platformUrl, ...rest } = data
      const reportTitle = this.normalizeIsoDatesInText(data.reportTitle)
      await this.send({
        to: email,
        subject: `Rendición rechazada por Contabilidad — ${reportTitle}`,
        template: './rendicion-rechazada-coordinador',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          reportTitle,
          platformUrl: this.resolvePlatformHref(platformUrl),
        },
      })
      this.logger.debug(
        `Correo rendición rechazada (coordinador) enviado a ${email}`
      )
    } catch (error) {
      this.logger.error(
        `Error rendición rechazada (coordinador) a ${email}:`,
        error
      )
    }
  }

  /** Notifica reapertura de rendición cerrada (colaborador o coordinador). */
  async sendRendicionReabierta(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      reportTitle: string
      reason: string
      intro: string
      platformUrl?: string
    }
  ) {
    try {
      const { platformUrl, ...rest } = data
      const reportTitle = this.normalizeIsoDatesInText(data.reportTitle)
      await this.send({
        to: email,
        subject: `Rendición reabierta — ${reportTitle}`,
        template: './rendicion-reabierta',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          reportTitle,
          platformUrl: this.resolvePlatformHref(platformUrl),
        },
      })
      this.logger.debug(`Correo rendición reabierta enviado a ${email}`)
    } catch (error) {
      this.logger.error(`Error rendición reabierta a ${email}:`, error)
    }
  }

  async sendRendicionSubmitted(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      collaboratorName: string
      reportTitle: string
      budgetFormatted: string
      expenseCount: number
      expenseTotalFormatted?: string
      expenseItems?: Array<{
        categoryName: string
        description: string
        totalFormatted: string
      }>
      isDirecta?: boolean
      hasDirectaDeposit?: boolean
      depositFormatted?: string
      saldoFormatted?: string
      platformUrl?: string
    }
  ) {
    try {
      this.logger.debug(`Enviando correo de rendición enviada a ${email}`)
      const reportTitle = this.normalizeIsoDatesInText(data.reportTitle)
      await this.send({
        to: email,
        subject: `Rendición enviada para revisión — ${reportTitle}`,
        template: './rendicion-submitted',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...data,
          reportTitle,
          platformUrl: this.resolvePlatformHref(data.platformUrl),
        },
      })
      this.logger.debug(`Correo de rendición enviada enviado a ${email}`)
    } catch (error) {
      this.logger.error(`Error correo rendición enviada a ${email}:`, error)
    }
  }

  /** Fase 3 — rechazo al colaborador (Funcionalidades.md §3.1) */
  async sendViaticoRechazoColaborador(
    email: string,
    data: {
      clientId?: string
      collaboratorName: string
      collaboratorDocument: string
      collaboratorArea: string
      collaboratorCargo: string
      projectLabel: string
      rejectionReason: string
      platformUrl?: string
    }
  ) {
    try {
      const subject = `Rechazo de solicitud de viáticos - ${data.projectLabel}`
      const { platformUrl, ...rest } = data
      await this.send({
        to: email,
        subject,
        template: './viatico-rechazo-colaborador',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          platformUrl: this.resolvePlatformHref(platformUrl),
        },
      })
      this.logger.debug(`Correo rechazo viático enviado a ${email}`)
    } catch (error) {
      this.logger.error(`Error rechazo viático a ${email}:`, error)
      throw error
    }
  }

  /** Notificación a Contabilidad cuando una solicitud queda en pending_l2. */
  async sendViaticoPendienteL2(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      urgent: boolean
      urgentBanner: string
      emailTitle: string
      /** HTML libre con el desglose largo. Opcional: el bloque «Detalles
       *  rápidos» de la plantilla se arma con los campos sueltos de abajo. */
      detailBody?: string
      collaboratorName?: string
      place?: string
      startDate?: string
      endDate?: string
      totalFormatted?: string
      currencySymbol?: string
      projectLabel: string
      platformUrl?: string
    }
  ) {
    try {
      const prefix = data.urgent ? '[🔴 URGENTE] ' : ''
      const subject = `${prefix}${this.withSubjectRef('Solicitud pendiente de aprobación final', data.projectLabel)}`
      const { platformUrl, ...rest } = data
      await this.send({
        to: email,
        subject,
        template: './viatico-pendiente-l2',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          platformUrl: this.resolvePlatformHref(platformUrl),
        },
      })
      this.logger.debug(`Correo pendiente L2 enviado a ${email}`)
    } catch (error) {
      this.logger.error(`Error pendiente L2 a ${email}:`, error)
      throw error
    }
  }

  /** Fase 3 — aprobación a contabilidad / tesorería (Funcionalidades.md §3.2) */
  async sendViaticoAprobacionContabilidad(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      urgent: boolean
      urgentBanner: string
      emailTitle: string
      /** Párrafo de contexto bajo el saludo; la plantilla trae uno genérico. */
      intro?: string
      /** HTML libre con el desglose largo. Opcional: el bloque «Detalles
       *  rápidos» de la plantilla se arma con los campos sueltos de abajo. */
      detailBody?: string
      collaboratorName?: string
      place?: string
      startDate?: string
      endDate?: string
      totalFormatted?: string
      currencySymbol?: string
      /** Etiqueta N° centro de costo ej. `[CODE - Nombre]` (Fase 3). */
      projectLabel: string
      platformUrl?: string
    }
  ) {
    try {
      const prefix = data.urgent ? '[🔴 URGENTE] ' : ''
      const subject = `${prefix}${this.withSubjectRef('Solicitud aprobada', data.projectLabel)}`
      const { platformUrl, ...rest } = data
      await this.send({
        to: email,
        subject,
        template: './viatico-aprobacion-contabilidad',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          platformUrl: this.resolvePlatformHref(platformUrl),
        },
      })
      this.logger.debug(
        `Correo aprobación viático (contabilidad) enviado a ${email}`
      )
    } catch (error) {
      this.logger.error(`Error aprobación viático a ${email}:`, error)
      throw error
    }
  }

  /** Fase 2 — nueva solicitud de viáticos al coordinador (Funcionalidades.md §2.2) */
  async sendViaticoSolicitudToCoordinator(
    email: string,
    data: {
      clientId?: string
      coordinatorName: string
      collaboratorName: string
      place: string
      startDate: string
      endDate: string
      totalFormatted: string
      currencySymbol?: string
      projectLabel: string
      platformUrl?: string
    }
  ) {
    try {
      const subject = this.withSubjectRef(
        'Nueva solicitud de viáticos',
        data.projectLabel
      )
      this.logger.debug(`Enviando solicitud de viáticos a coordinador ${email}`)
      const { platformUrl, ...rest } = data
      await this.send({
        to: email,
        subject,
        template: './viatico-solicitud-coordinator',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          startDate: this.formatDateDDMMYYYY(data.startDate),
          endDate: this.formatDateDDMMYYYY(data.endDate),
          platformUrl: this.resolvePlatformHref(platformUrl),
        },
      })
      this.logger.debug(`Correo de solicitud de viáticos enviado a ${email}`)
    } catch (error) {
      this.logger.error(
        `Error al enviar solicitud de viáticos a ${email}:`,
        error
      )
      throw error
    }
  }

  /** Confirmación al colaborador de que su solicitud de viáticos fue enviada y queda pendiente de aprobación. */
  async sendViaticoSolicitudToColaborador(
    email: string,
    data: {
      clientId?: string
      collaboratorName: string
      place: string
      startDate: string
      endDate: string
      totalFormatted: string
      currencySymbol?: string
      projectLabel: string
      platformUrl?: string
    }
  ) {
    try {
      const subject = this.withSubjectRef(
        'Solicitud de viáticos enviada',
        data.projectLabel
      )
      const { platformUrl, ...rest } = data
      await this.send({
        to: email,
        subject,
        template: './viatico-solicitud-colaborador',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          startDate: this.formatDateDDMMYYYY(data.startDate),
          endDate: this.formatDateDDMMYYYY(data.endDate),
          platformUrl: this.resolvePlatformHref(platformUrl),
        },
      })
      this.logger.debug(
        `Confirmación de solicitud de viáticos enviada al colaborador ${email}`
      )
    } catch (error) {
      this.logger.error(
        `Error confirmación solicitud viáticos colaborador ${email}:`,
        error
      )
    }
  }

  async sendViaticoSolicitudToContabilidad(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      collaboratorName: string
      place: string
      startDate: string
      endDate: string
      totalFormatted: string
      currencySymbol?: string
      projectLabel: string
      platformUrl?: string
    }
  ) {
    try {
      const subject = this.withSubjectRef(
        'Nueva solicitud de viáticos',
        data.projectLabel
      )
      const { platformUrl, ...rest } = data
      await this.send({
        to: email,
        subject,
        template: './viatico-solicitud-contabilidad',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          startDate: this.formatDateDDMMYYYY(data.startDate),
          endDate: this.formatDateDDMMYYYY(data.endDate),
          platformUrl: this.resolvePlatformHref(platformUrl),
        },
      })
      this.logger.debug(
        `Correo solicitud viáticos (contabilidad) enviado a ${email}`
      )
    } catch (error) {
      this.logger.error(
        `Error solicitud viáticos (contabilidad) a ${email}:`,
        error
      )
      throw error
    }
  }

  async sendViaticoCancelacion(
    email: string,
    data: {
      clientId?: string
      coordinatorName: string
      collaboratorName: string
      place: string
      startDate: string
      endDate: string
      totalFormatted: string
      projectLabel: string
      plainSummary: string
      cancelReason?: string
      platformUrl?: string
    }
  ) {
    try {
      const { platformUrl, ...rest } = data
      await this.send({
        to: email,
        subject: this.withSubjectRef('Solicitud de viáticos cancelada', data.projectLabel),
        template: './viatico-cancelacion-coordinator',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          startDate: this.formatDateDDMMYYYY(data.startDate),
          endDate: this.formatDateDDMMYYYY(data.endDate),
          platformUrl: this.resolvePlatformHref(platformUrl),
        },
      })
      this.logger.debug(`Correo cancelación viático enviado a ${email}`)
    } catch (error) {
      this.logger.error(
        `Error al enviar cancelación viático a ${email}:`,
        error
      )
    }
  }

  /** Fase 6 — rendición aprobada con saldo a favor del colaborador (pendiente de pago). */
  async sendRendicionReembolsoContabilidad(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      /** Identificador legible para el asunto (ej. título + ref. corta), alineado a Funcionalidades §6.1 */
      reportLabel: string
      reportTitle: string
      collaboratorName: string
      amountFormatted: string
      detailUrl: string
    }
  ) {
    try {
      const reportLabel = this.normalizeIsoDatesInText(data.reportLabel)
      const reportTitle = this.normalizeIsoDatesInText(data.reportTitle)
      const subject = `Rendición «${reportLabel}» requiere reembolso de S/ ${data.amountFormatted} a ${data.collaboratorName}`
      const { detailUrl, ...rest } = data
      await this.send({
        to: email,
        subject,
        template: './rendicion-reembolso-contabilidad',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          reportLabel,
          reportTitle,
          detailUrl: this.resolvePlatformHref(detailUrl),
        },
      })
    } catch (error) {
      this.logger.error(
        `Error correo reembolso contabilidad a ${email}:`,
        error
      )
      throw error
    }
  }

  /** Fase 6 — reembolso pagado al colaborador (adjunta comprobante). */
  async sendRendicionReembolsoPagado(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      collaboratorName: string
      coordinatorName?: string
      reportTitle: string
      amountFormatted: string
      transferDate: string
      reference?: string
      paymentMethod: string
      paymentReceiptUrl: string
      paymentReceiptFileName?: string
      platformUrl?: string
    }
  ) {
    try {
      const reportTitle = this.normalizeIsoDatesInText(data.reportTitle)
      const subject = `Reembolso de gastos registrado — ${reportTitle}`
      const { platformUrl, ...rest } = data
      await this.send({
        to: email,
        subject,
        template: './rendicion-reembolso-pagado',
        attachments: data.paymentReceiptUrl
          ? [
              {
                filename:
                  data.paymentReceiptFileName ||
                  'comprobante-reembolso-rendicion.pdf',
                path: data.paymentReceiptUrl,
              },
            ]
          : [],
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          reportTitle,
          transferDate: this.formatDateDDMMYYYY(data.transferDate),
          platformUrl: this.resolvePlatformHref(platformUrl),
        },
      })
      this.logger.debug(`Correo reembolso pagado enviado a ${email}`)
    } catch (error) {
      this.logger.error(`Error correo reembolso pagado a ${email}:`, error)
      throw error
    }
  }

  /** Fase 4 — pago de viáticos registrado para colaborador y coordinador. */
  async sendViaticoPagoRealizado(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      collaboratorName: string
      coordinatorName?: string
      projectLabel: string
      amountFormatted: string
      currencySymbol?: string
      transferDate: string
      reference?: string
      paymentMethod: string
      paymentReceiptUrl: string
      paymentReceiptFileName?: string
      platformUrl?: string
    }
  ) {
    try {
      const subject = `Viáticos aprobados y pagados — ${data.projectLabel}`
      const { platformUrl, ...rest } = data
      await this.send({
        to: email,
        subject,
        template: './viatico-pago-realizado',
        attachments: data.paymentReceiptUrl
          ? [
              {
                filename:
                  data.paymentReceiptFileName ||
                  'comprobante-pago-viaticos.pdf',
                path: data.paymentReceiptUrl,
              },
            ]
          : [],
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...rest,
          transferDate: this.formatDateDDMMYYYY(data.transferDate),
          platformUrl: this.resolvePlatformHref(platformUrl),
        },
      })
      this.logger.debug(`Correo de pago viático enviado a ${email}`)
    } catch (error) {
      this.logger.error(`Error correo pago viático a ${email}:`, error)
      throw error
    }
  }

  // ─── Fase 8 — Cierre definitivo ──────────────────────────────────────────

  async sendRendicionCerrada(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      reportTitle: string
      closedAt: string
    }
  ) {
    try {
      const reportTitle = this.normalizeIsoDatesInText(data.reportTitle)
      await this.send({
        to: email,
        subject: `Rendición cerrada definitivamente — ${reportTitle}`,
        template: './rendicion-cerrada',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...data,
          reportTitle,
          closedAt: this.formatDateDDMMYYYY(data.closedAt),
        },
      })
    } catch (error) {
      this.logger.error(`Error correo rendición cerrada a ${email}:`, error)
    }
  }

  async sendRendicionDevolucionColaborador(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      reportTitle: string
      amountFormatted: string
      closedAt: string
      platformUrl?: string
    }
  ) {
    try {
      const reportTitle = this.normalizeIsoDatesInText(data.reportTitle)
      await this.send({
        to: email,
        subject: `Devolución pendiente — ${reportTitle} — S/ ${data.amountFormatted}`,
        template: './rendicion-devolucion-colaborador',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...data,
          reportTitle,
          closedAt: this.formatDateDDMMYYYY(data.closedAt),
          platformUrl: this.resolvePlatformHref(data.platformUrl),
        },
      })
    } catch (error) {
      this.logger.error(
        `Error correo devolucion colaborador a ${email}:`,
        error
      )
    }
  }

  async sendRendicionDevolucionCargada(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      collaboratorName: string
      reportTitle: string
      amountFormatted: string
      depositDate: string
      bankOrigin?: string
      operationNumber?: string
      platformUrl?: string
    }
  ) {
    try {
      const reportTitle = this.normalizeIsoDatesInText(data.reportTitle)
      await this.send({
        to: email,
        subject: `Comprobante de devolución cargado — ${reportTitle} — ${data.collaboratorName}`,
        template: './rendicion-devolucion-cargada',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...data,
          reportTitle,
          depositDate: this.formatDateDDMMYYYY(data.depositDate),
          platformUrl: this.resolvePlatformHref(data.platformUrl),
        },
      })
    } catch (error) {
      this.logger.error(`Error correo devolucion cargada a ${email}:`, error)
    }
  }

  async sendRendicionCancelada(
    email: string,
    data: {
      clientId?: string
      adminName: string
      collaboratorName: string
      reportTitle: string
      cancelReason?: string
    }
  ) {
    try {
      const reportTitle = this.normalizeIsoDatesInText(data.reportTitle)
      await this.send({
        to: email,
        subject: `Rendición cancelada por el colaborador — ${reportTitle}`,
        template: './rendicion-cancelada',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...data,
          reportTitle,
        },
      })
    } catch (error) {
      this.logger.error(`Error correo rendición cancelada a ${email}:`, error)
    }
  }

  // ─── Fase 7 — Devolución de saldos ───────────────────────────────────────

  async sendDevolucionPendiente(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      amountDue: string
      dueDate: string
      advanceId: string
      currencySymbol?: string
    }
  ) {
    try {
      await this.send({
        to: email,
        subject: `Devolución pendiente — Anticipo N° ${data.advanceId} — ${data.currencySymbol ?? 'S/'} ${data.amountDue}`,
        template: './devolucion-pendiente',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...data,
          dueDate: this.formatDateDDMMYYYY(data.dueDate),
        },
      })
    } catch (error) {
      this.logger.error(`Error correo devolución pendiente a ${email}:`, error)
    }
  }

  async sendDevolucionValidada(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      amountDue: string
      advanceId: string
      currencySymbol?: string
    }
  ) {
    try {
      await this.send({
        to: email,
        subject: `Devolución validada — Anticipo N° ${data.advanceId}`,
        template: './devolucion-validada',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...data,
        },
      })
    } catch (error) {
      this.logger.error(`Error correo devolución validada a ${email}:`, error)
    }
  }

  async sendDevolucionRechazada(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      amountDue: string
      rejectionReason?: string
      advanceId: string
      currencySymbol?: string
    }
  ) {
    try {
      await this.send({
        to: email,
        subject: `Comprobante de devolución rechazado — Anticipo N° ${data.advanceId}`,
        template: './devolucion-rechazada',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...data,
        },
      })
    } catch (error) {
      this.logger.error(`Error correo devolución rechazada a ${email}:`, error)
    }
  }

  // ─── Fase 10 — Caja Chica ────────────────────────────────────────────────

  async sendCajaChicaCreada(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      code: string
      period: string
      fundAmount: number
    }
  ) {
    try {
      await this.send({
        to: email,
        subject: `Caja chica creada — ${data.code}`,
        template: './caja-chica-creada',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...data,
        },
      })
    } catch (error) {
      this.logger.error(`Error correo caja chica creada a ${email}:`, error)
    }
  }

  async sendCajaChicaFondeada(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      code: string
      fundAmount: number
    }
  ) {
    try {
      await this.send({
        to: email,
        subject: `Caja chica activa — ${data.code}`,
        template: './caja-chica-fondeada',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          ...data,
        },
      })
    } catch (error) {
      this.logger.error(`Error correo caja chica fondeada a ${email}:`, error)
    }
  }

  async sendViaticoRecordatorioColaborador(
    email: string,
    data: {
      clientId?: string
      collaboratorName: string
      place: string
      startDate: string
      endDate: string
      frequency: 'semanal' | 'mensual'
      platformUrl?: string
    }
  ) {
    try {
      const periodoLabel =
        data.frequency === 'semanal' ? 'esta semana' : 'este mes'
      await this.send({
        to: email,
        subject: `Recordatorio de rendición de viáticos — ${periodoLabel}`,
        template: './viatico-recordatorio-colaborador',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          collaboratorName: data.collaboratorName,
          place: data.place,
          startDate: this.formatDateDDMMYYYY(data.startDate),
          endDate: this.formatDateDDMMYYYY(data.endDate),
          isSemanal: data.frequency === 'semanal',
          platformUrl: this.resolvePlatformHref(data.platformUrl),
        },
      })
    } catch (error) {
      this.logger.error(
        `Error recordatorio rendición colaborador a ${email}:`,
        error
      )
    }
  }

  async sendViaticoRecordatorioUltimoDia(
    email: string,
    data: {
      clientId?: string
      collaboratorName: string
      place: string
      endDate: string
      platformUrl?: string
    }
  ) {
    try {
      const formattedEndDate = this.formatDateDDMMYYYY(data.endDate)
      await this.send({
        to: email,
        subject: `Hoy vence su periodo de viáticos — ${formattedEndDate}`,
        template: './viatico-recordatorio-ultimo-dia',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          collaboratorName: data.collaboratorName,
          place: data.place,
          endDate: formattedEndDate,
          platformUrl: this.resolvePlatformHref(data.platformUrl),
        },
      })
    } catch (error) {
      this.logger.error(
        `Error recordatorio último día colaborador a ${email}:`,
        error
      )
    }
  }

  async sendViaticoResumenCoordinador(
    email: string,
    data: {
      clientId?: string
      coordinatorName: string
      collaboratorName: string
      place: string
      startDate: string
      endDate: string
      pendingCount: number
      frequency: 'semanal' | 'mensual'
      platformUrl?: string
    }
  ) {
    try {
      const periodoLabel = data.frequency === 'semanal' ? 'semanal' : 'mensual'
      await this.send({
        to: email,
        subject: `Gastos de viáticos pendientes de revisión — resumen ${periodoLabel}`,
        template: './viatico-resumen-coordinador',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          coordinatorName: data.coordinatorName,
          collaboratorName: data.collaboratorName,
          place: data.place,
          startDate: this.formatDateDDMMYYYY(data.startDate),
          endDate: this.formatDateDDMMYYYY(data.endDate),
          pendingCount: data.pendingCount,
          platformUrl: this.resolvePlatformHref(data.platformUrl),
        },
      })
    } catch (error) {
      this.logger.error(`Error resumen viáticos coordinador a ${email}:`, error)
    }
  }

  async sendRendicionRecordatorioCoordinador(
    email: string,
    data: {
      clientId?: string
      coordinatorName: string
      pendingCount: number
      reports: { collaboratorName: string; title: string; endDateFormatted?: string }[]
      platformUrl?: string
    }
  ) {
    try {
      await this.send({
        to: email,
        subject: `Rendiciones pendientes de revisión — ${data.pendingCount} pendiente(s)`,
        template: './rendicion-recordatorio-coordinador',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          coordinatorName: data.coordinatorName,
          pendingCount: data.pendingCount,
          reports: data.reports,
          platformUrl: this.resolvePlatformHref(data.platformUrl ?? '/rendiciones'),
        },
      })
    } catch (error) {
      this.logger.error(`Error recordatorio rendición coordinador a ${email}:`, error)
    }
  }

  async sendRendicionRecordatorioContabilidad(
    email: string,
    data: {
      clientId?: string
      recipientName: string
      pendingCount: number
      reports: { collaboratorName: string; title: string; endDateFormatted?: string }[]
      platformUrl?: string
    }
  ) {
    try {
      await this.send({
        to: email,
        subject: `Rendiciones pendientes de aprobación contable — ${data.pendingCount} pendiente(s)`,
        template: './rendicion-recordatorio-contabilidad',
        context: {
          logoUrl: await this.resolveLogoUrl(this.extractClientId(data)),
          year: new Date().getFullYear(),
          recipientName: data.recipientName,
          pendingCount: data.pendingCount,
          reports: data.reports,
          platformUrl: this.resolvePlatformHref(data.platformUrl ?? '/tesoreria'),
        },
      })
    } catch (error) {
      this.logger.error(`Error recordatorio rendición contabilidad a ${email}:`, error)
    }
  }
}
