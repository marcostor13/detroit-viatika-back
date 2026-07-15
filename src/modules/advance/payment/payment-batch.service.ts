import {
  Injectable,
  Inject,
  forwardRef,
  Logger,
  BadRequestException,
} from '@nestjs/common'
import { AdvanceService } from '../advance.service'
import { ExpenseReportService } from '../../expense-report/expense-report.service'
import { ClientService } from '../../client/client.service'
import {
  BbvaDetailRecord,
  BbvaDocType,
  BbvaAccountType,
  BbvaPdfSummary,
  buildBbvaTxt,
  toLatin1Buffer,
  solesToCents,
  normalizeName,
  namesMatch,
  parseBbvaPdfText,
} from './bbva-format'

/** Glosa por tipo de pago (VD-7). Ajustable si el cliente pide otra convención. */
const CONCEPTO = {
  advance: 'SOLICITUD DE FONDOS',
  viatico: 'SOLICITUD DE FONDOS',
  reembolso: 'REEMBOLSO',
} as const

export type PaymentKind = 'advance' | 'viatico' | 'reembolso'

/** Un pago pendiente ya resuelto a datos de beneficiario + importe. */
export interface PendingPayment {
  kind: PaymentKind
  /** advanceId o reportId según el tipo. */
  id: string
  beneficiaryName: string
  documentType: BbvaDocType
  documentNumber: string
  accountType: BbvaAccountType
  cci: string
  bankName: string
  email: string
  /** Importe por pagar en soles. */
  amount: number
  concepto: string
}

export interface ExcludedPayment {
  kind: PaymentKind
  id: string
  beneficiaryName: string
  amount: number
  reason: string
}

export interface CollectResult {
  payable: PendingPayment[]
  excluded: ExcludedPayment[]
}

export interface GenerateTxtResult {
  fileName: string
  /** Contenido del archivo en Latin-1, codificado base64. */
  fileBase64: string
  count: number
  totalSoles: number
  excluded: ExcludedPayment[]
}

export interface BatchActor {
  role: string
  permissions?: { canApproveL2?: boolean }
}

export interface ReconcileResult {
  operationNumber?: string
  executedAt?: string
  conciliados: Array<{
    kind: PaymentKind
    id: string
    beneficiaryName: string
    documentNumber: string
    amount: number
  }>
  sinConciliar: Array<{
    titular: string
    documentNumber: string
    amount: number
    reason: string
  }>
  noAbonados: Array<{ titular: string; documentNumber: string; situacion: string }>
}

@Injectable()
export class PaymentBatchService {
  private readonly logger = new Logger(PaymentBatchService.name)

  constructor(
    @Inject(forwardRef(() => AdvanceService))
    private readonly advanceService: AdvanceService,
    @Inject(forwardRef(() => ExpenseReportService))
    private readonly expenseReportService: ExpenseReportService,
    private readonly clientService: ClientService
  ) {}

  // ── Reglas de derivación ───────────────────────────────────────────────────

  /**
   * Tipo de cuenta para el archivo BBVA: `P` (propia BBVA) cuando el CCI empieza
   * por el código de banco de BBVA (`0011`), `I` (interbancaria) en otro caso.
   * Regla verificada contra el archivo real; ajustable si BBVA lo precisa (§6).
   */
  private resolveAccountType(cci: string): BbvaAccountType {
    return (cci ?? '').replace(/\D/g, '').startsWith('0011') ? 'P' : 'I'
  }

  private buildCandidate(
    kind: PaymentKind,
    id: string,
    user: any,
    amount: number,
    cci: string,
    bankName: string
  ): PendingPayment | ExcludedPayment {
    const beneficiaryName = user?.name ?? '—'
    const documentNumber = (user?.dni ?? '').trim()
    const digitsCci = (cci ?? '').replace(/\D/g, '')

    if (!documentNumber) {
      return { kind, id, beneficiaryName, amount, reason: 'Sin DNI/documento registrado' }
    }
    if (digitsCci.length !== 20) {
      return {
        kind,
        id,
        beneficiaryName,
        amount,
        reason: 'CCI inválido o incompleto (se requieren 20 dígitos)',
      }
    }
    return {
      kind,
      id,
      beneficiaryName,
      documentType: (user?.documentType as BbvaDocType) || 'L',
      documentNumber,
      accountType: this.resolveAccountType(digitsCci),
      cci: digitsCci,
      bankName: bankName ?? '',
      email: user?.email ?? '',
      amount,
      concepto: CONCEPTO[kind],
    }
  }

  private isExcluded(x: PendingPayment | ExcludedPayment): x is ExcludedPayment {
    return 'reason' in x
  }

  // ── Recolección de pendientes ──────────────────────────────────────────────

  async collectPendingPayments(clientId: string): Promise<CollectResult> {
    const [advances, viaticos, reembolsos] = await Promise.all([
      this.advanceService.findBatchPayableAdvances(clientId),
      this.expenseReportService.findBatchPayableViaticos(clientId),
      this.expenseReportService.findPendingReimbursementsByClient(clientId),
    ])

    const candidates: Array<PendingPayment | ExcludedPayment> = []

    for (const a of advances) {
      candidates.push(
        this.buildCandidate('advance', a.advanceId, a.user, a.remaining, a.cci, a.bankName)
      )
    }
    for (const v of viaticos) {
      candidates.push(
        this.buildCandidate('viatico', v.reportId, v.user, v.remaining, v.cci, v.bankName)
      )
    }
    for (const r of reembolsos as any[]) {
      const amount = Math.abs(Number(r?.settlement?.difference ?? 0))
      if (amount <= 0.009) continue
      const cci = r?.userId?.bankAccount?.cci ?? ''
      const bankName = r?.userId?.bankAccount?.bankName ?? ''
      candidates.push(
        this.buildCandidate('reembolso', String(r._id), r.userId, amount, cci, bankName)
      )
    }

    return {
      payable: candidates.filter(c => !this.isExcluded(c)) as PendingPayment[],
      excluded: candidates.filter(c => this.isExcluded(c)) as ExcludedPayment[],
    }
  }

  // ── Generación del TXT ─────────────────────────────────────────────────────

  async generateTxt(clientId: string): Promise<GenerateTxtResult> {
    const { payable, excluded } = await this.collectPendingPayments(clientId)
    if (payable.length === 0) {
      // Si hay pendientes pero todos con datos incompletos, no lanzamos error:
      // devolvemos el detalle de los excluidos para que Tesorería sepa qué corregir.
      if (excluded.length > 0) {
        return {
          fileName: 'BBVAREND.txt',
          fileBase64: '',
          count: 0,
          totalSoles: 0,
          excluded,
        }
      }
      throw new BadRequestException(
        'No hay pagos pendientes para generar el archivo.'
      )
    }

    const client = await this.clientService.findOne(clientId)
    const chargeAccount = (client as any)?.paymentAccount ?? ''
    if (!chargeAccount) {
      throw new BadRequestException(
        'La empresa no tiene configurada la cuenta de cargo (Configuración → Empresa). Es obligatoria para la cabecera del archivo BBVA.'
      )
    }

    const records: BbvaDetailRecord[] = payable.map(p => ({
      documentType: p.documentType,
      documentNumber: p.documentNumber,
      accountType: p.accountType,
      accountNumber: p.cci,
      beneficiaryName: p.beneficiaryName,
      amountCents: solesToCents(p.amount),
      concepto: p.concepto,
      email: p.email,
    }))

    const totalCents = records.reduce((s, r) => s + r.amountCents, 0)
    const txt = buildBbvaTxt(records, {
      chargeAccount,
      currency: 'PEN',
      description: this.buildPlanillaDescription(client),
    })

    return {
      fileName: 'BBVAREND.txt',
      fileBase64: toLatin1Buffer(txt).toString('base64'),
      count: records.length,
      totalSoles: Math.round(totalCents) / 100,
      excluded,
    }
  }

  private readonly MESES = [
    'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
    'JULIO', 'AGOSTO', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
  ]

  /**
   * Descripción de la planilla (cabecera, 24 chars). Sigue la convención del
   * archivo real de BBVA: `PROVEEDORES SOL <día> <MES>` (ej. PROVEEDORES SOL 02 JUNIO).
   */
  private buildPlanillaDescription(_client: any): string {
    const now = new Date()
    const dd = String(now.getDate()).padStart(2, '0')
    const mes = this.MESES[now.getMonth()]
    return `PROVEEDORES SOL ${dd} ${mes}`.slice(0, 24)
  }

  // ── Conciliación por PDF ───────────────────────────────────────────────────

  async reconcileFromPdf(
    clientId: string,
    pdfBuffer: Buffer,
    actor: BatchActor
  ): Promise<ReconcileResult> {
    const text = await this.extractPdfText(pdfBuffer)
    const parsed = parseBbvaPdfText(text)
    if (!parsed.rows.length) {
      throw new BadRequestException(
        'No se pudieron leer abonos del PDF. Verifica que sea la "Consulta de Pagos Masivos" de BBVA, o usa la confirmación manual.'
      )
    }
    return this.reconcileParsedRows(clientId, parsed, actor)
  }

  /**
   * PRUEBAS: simula el PDF de retorno de BBVA marcando como abonados TODOS los
   * pagos pendientes con datos bancarios completos, y los concilia por el mismo
   * motor que el PDF real (matching por DNI+monto + aplicación del pago). Permite
   * continuar el flujo de Tesorería sin depender del banco. El PDF real de BBVA
   * es la vía de producción; esto es solo una ayuda de prueba.
   */
  async simulateReconcile(
    clientId: string,
    actor: BatchActor
  ): Promise<ReconcileResult> {
    const { payable } = await this.collectPendingPayments(clientId)
    if (!payable.length) {
      throw new BadRequestException(
        'No hay pagos pendientes con datos bancarios completos para simular.'
      )
    }
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const parsed: BbvaPdfSummary = {
      rows: payable.map(p => ({
        titular: normalizeName(p.beneficiaryName),
        documentNumber: (p.documentNumber ?? '').replace(/\D/g, ''),
        amount: p.amount,
        situacion: 'ABONO ENVIADO',
        success: true,
      })),
      // N° de operación pseudo-único (9 dígitos) y fecha/hora actuales.
      operationNumber: `SIM${String(now.getTime()).slice(-9)}`,
      executedAt: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    }
    return this.reconcileParsedRows(clientId, parsed, actor)
  }

  /** Núcleo de conciliación: cruza los abonos parseados con los pendientes y aplica el pago. */
  private async reconcileParsedRows(
    clientId: string,
    parsed: BbvaPdfSummary,
    actor: BatchActor
  ): Promise<ReconcileResult> {
    const { payable } = await this.collectPendingPayments(clientId)
    const used = new Set<number>() // índices de payable ya conciliados
    const result: ReconcileResult = {
      operationNumber: parsed.operationNumber,
      executedAt: parsed.executedAt,
      conciliados: [],
      sinConciliar: [],
      noAbonados: [],
    }

    const transferDate = this.toIsoDate(parsed.executedAt)

    for (const row of parsed.rows) {
      if (!row.success) {
        result.noAbonados.push({
          titular: row.titular,
          documentNumber: row.documentNumber,
          situacion: row.situacion,
        })
        continue
      }
      const idx = this.findMatchingCandidate(payable, used, row)
      if (idx < 0) {
        result.sinConciliar.push({
          titular: row.titular,
          documentNumber: row.documentNumber,
          amount: row.amount,
          reason: 'No se encontró un pago pendiente con titular + DNI + monto coincidentes',
        })
        continue
      }
      used.add(idx)
      const cand = payable[idx]
      try {
        await this.applyPayment(cand, {
          operationNumber: parsed.operationNumber,
          transferDate,
          actor,
        })
        result.conciliados.push({
          kind: cand.kind,
          id: cand.id,
          beneficiaryName: cand.beneficiaryName,
          documentNumber: cand.documentNumber,
          amount: cand.amount,
        })
      } catch (err: unknown) {
        used.delete(idx)
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(`Conciliación ${cand.kind} ${cand.id}: ${msg}`)
        result.sinConciliar.push({
          titular: row.titular,
          documentNumber: row.documentNumber,
          amount: row.amount,
          reason: `Error al registrar el pago: ${msg}`,
        })
      }
    }

    return result
  }

  /**
   * Cruce por DNI + monto (clave fuerte: el DNI es único por persona). El nombre
   * del PDF real es poco fiable (se parte en líneas, Ñ corrupta), así que NO se
   * usa como filtro duro: solo desempata cuando hay varios candidatos con el
   * mismo DNI + monto. Sin desempate → FIFO (más antiguo primero).
   */
  private findMatchingCandidate(
    payable: PendingPayment[],
    used: Set<number>,
    row: { titular: string; documentNumber: string; amount: number }
  ): number {
    const rowDni = (row.documentNumber ?? '').replace(/\D/g, '')
    const matches: number[] = []
    for (let i = 0; i < payable.length; i++) {
      if (used.has(i)) continue
      const c = payable[i]
      const dniMatch = (c.documentNumber ?? '').replace(/\D/g, '') === rowDni
      const amountMatch = Math.abs(c.amount - row.amount) < 0.01
      if (dniMatch && amountMatch) matches.push(i)
    }
    if (matches.length === 0) return -1
    if (matches.length > 1 && row.titular) {
      const named = matches.find((i) => namesMatch(row.titular, payable[i].beneficiaryName))
      if (named !== undefined) return named
    }
    return matches[0]
  }

  // ── Confirmación manual (fallback) ─────────────────────────────────────────

  async confirmManual(
    clientId: string,
    items: Array<{ kind: PaymentKind; id: string }>,
    meta: { operationNumber?: string; paymentDate?: string },
    actor: BatchActor
  ): Promise<{ pagados: number; errores: Array<{ id: string; reason: string }> }> {
    const { payable } = await this.collectPendingPayments(clientId)
    const byId = new Map(payable.map(p => [`${p.kind}:${p.id}`, p]))
    const transferDate = this.toIsoDate(meta.paymentDate)
    let pagados = 0
    const errores: Array<{ id: string; reason: string }> = []

    for (const it of items) {
      const cand = byId.get(`${it.kind}:${it.id}`)
      if (!cand) {
        errores.push({ id: it.id, reason: 'El pago ya no está pendiente o no existe' })
        continue
      }
      try {
        await this.applyPayment(cand, {
          operationNumber: meta.operationNumber,
          transferDate,
          actor,
        })
        pagados++
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        errores.push({ id: it.id, reason: msg })
      }
    }
    return { pagados, errores }
  }

  // ── Aplicación del pago por superficie (reutiliza la lógica existente) ──────

  private async applyPayment(
    cand: PendingPayment,
    ctx: { operationNumber?: string; transferDate: string; actor: BatchActor }
  ): Promise<void> {
    const dto: any = {
      method: 'transferencia_bancaria',
      amount: cand.amount,
      transferDate: ctx.transferDate,
      reference: ctx.operationNumber,
      operationNumber: ctx.operationNumber,
    }
    const { role, permissions } = ctx.actor
    if (cand.kind === 'advance') {
      await this.advanceService.registerPayment(cand.id, dto, role, permissions, {
        bypassReceipt: true,
      })
    } else if (cand.kind === 'viatico') {
      await this.expenseReportService.registerViaticoPayment(
        cand.id,
        dto,
        role,
        permissions,
        { bypassReceipt: true }
      )
    } else {
      await this.expenseReportService.registerReimbursementPayment(
        cand.id,
        dto,
        role,
        permissions,
        undefined,
        { bypassReceipt: true }
      )
    }
  }

  // ── Utilidades ─────────────────────────────────────────────────────────────

  /** Convierte una fecha (dd/mm/yyyy | ISO | undefined) a `YYYY-MM-DD`. */
  private toIsoDate(input?: string): string {
    if (input) {
      const dmy = input.match(/^(\d{2})[\/-](\d{2})[\/-](\d{2,4})/)
      if (dmy) {
        const [, d, m, y] = dmy
        const year = y.length === 2 ? `20${y}` : y
        return `${year}-${m}-${d}`
      }
      const iso = input.match(/^\d{4}-\d{2}-\d{2}/)
      if (iso) return iso[0]
    }
    return new Date().toISOString().slice(0, 10)
  }

  /** Extrae el texto del PDF con pdf-parse (carga perezosa para no afectar el arranque). */
  private async extractPdfText(buffer: Buffer): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParse = require('pdf-parse')
      const data = await pdfParse(buffer)
      return data?.text ?? ''
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new BadRequestException(`No se pudo leer el PDF: ${msg}`)
    }
  }
}
