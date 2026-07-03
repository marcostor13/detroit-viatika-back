import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { createHash } from 'crypto'
import OpenAI from 'openai'
import { ExpenseReport } from '../expense-report/entities/expense-report.entity'
import { Expense } from '../expense/entities/expense.entity'
import { Advance } from '../advance/entities/advance.entity'
import { Project } from '../project/entities/project.entity'
import { User } from '../user/schemas/user.schema'
import { Category } from '../category/entities/category.entity'
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service'
import { AccountingConfigService } from '../accounting-config/accounting-config.service'
import { AccountingConfigDocument } from '../accounting-config/entities/accounting-config.entity'
import {
  CONTANET_COLUMNS,
  ContanetLine,
  toExcelSerial,
} from './entities/contanet-columns'
import { buildContanetWorkbook, resolveTemplatePath } from './entities/contanet-export'
import {
  AsientoTipo,
  CuadreError,
  GeneratedFile,
} from './entities/accounting-entries.types'
import { AccountingEntriesCache } from './entities/accounting-entries-cache.entity'
import { resolveCodTipDoc, TIPO_DOCUMENTO } from './constants/tipo-documento'
import {
  buildDeducibilidadPrompt,
  CargoContext,
} from './constants/deducibilidad-prompt'
import {
  ExpenseCargoClasificado,
  ExpenseCargosClasificacion,
} from '../expense/entities/expense.entity'

/** Porción analítica resuelta para una línea de gasto. */
interface AnalyticPortion {
  proyectId?: string
  condicion: 'afecto' | 'inafecto'
  monto: number
  /** Etiqueta opcional (ej. "RECARGO DE CONSUMO") para la glosa de la línea. */
  etiqueta?: string
  /**
   * Serie de control interno (0001/0003/0008) cuando la porción es un gasto
   * NO deducible: va en "Numero Documento" con "Codigo Tipo Document" vacío.
   */
  serieNoDeducible?: string
}

/** Series de control interno de gastos no deducibles (nodeducible.md). */
const SERIES_NO_DEDUCIBLE = new Set(['0001', '0003', '0008'])

@Injectable()
export class AccountingEntriesService {
  private readonly logger = new Logger(AccountingEntriesService.name)
  private readonly openai: OpenAI
  private readonly aiModel = 'deepseek-chat'

  constructor(
    @InjectModel(ExpenseReport.name)
    private reportModel: Model<any>,
    @InjectModel(Expense.name)
    private expenseModel: Model<any>,
    @InjectModel(Advance.name)
    private advanceModel: Model<any>,
    @InjectModel(Project.name)
    private projectModel: Model<any>,
    @InjectModel(User.name)
    private userModel: Model<any>,
    @InjectModel(Category.name)
    private categoryModel: Model<any>,
    @InjectModel(AccountingEntriesCache.name)
    private cacheModel: Model<any>,
    private accountingConfigService: AccountingConfigService,
    private exchangeRateService: ExchangeRateService,
    private configService: ConfigService
  ) {
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY')
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY no configurada')
    this.openai = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' })

    for (const tipo of ['compra', 'aplicacion', 'reembolso'] as AsientoTipo[]) {
      const p = resolveTemplatePath(tipo)
      if (p) this.logger.log(`[asientos] template OK: ${p}`)
      else this.logger.warn(`[asientos] template NO encontrado para tipo="${tipo}"`)
    }
  }

  // ----------------------------------------------------------------------
  // Orquestación
  // ----------------------------------------------------------------------

  /**
   * Genera los archivos de asientos de una rendición para los tipos solicitados.
   * Disponible en cualquier estado de la rendición (decisión de negocio).
   */
  async generateForReport(
    reportId: string,
    clientId: string,
    tipos: AsientoTipo[]
  ): Promise<GeneratedFile[]> {
    const report = (await this.reportModel
      .findById(reportId)
      .lean()
      .exec()) as any
    if (!report) throw new NotFoundException('Rendición no encontrada')

    // Lecturas independientes en paralelo (config + entidades del reporte).
    const [config, expenses, advances, colaborador] = await Promise.all([
      this.accountingConfigService.getEffective(clientId),
      this.expenseModel
        .find({ expenseReportId: report._id, status: { $ne: 'rejected' } })
        .lean()
        .exec() as Promise<any[]>,
      (report.advanceIds?.length
        ? this.advanceModel
            .find({ _id: { $in: report.advanceIds } })
            .lean()
            .exec()
        : Promise.resolve([])) as Promise<any[]>,
      this.userModel.findById(report.userId).lean().exec(),
    ])

    // Fingerprint barato: invalida la caché si cambia la rendición, sus gastos,
    // los anticipos o la configuración contable.
    const fingerprint = this.computeFingerprint(
      report,
      expenses,
      advances,
      config
    )

    // Reutiliza de caché los tipos cuyo fingerprint coincide.
    const cachedDocs = (await this.cacheModel
      .find({ reportId: report._id, tipo: { $in: tipos }, fingerprint })
      .lean()
      .exec()) as any[]
    const cachedByTipo = new Map<string, any>(
      cachedDocs.map(c => [c.tipo, c])
    )

    const files: GeneratedFile[] = []
    for (const tipo of tipos) {
      const hit = cachedByTipo.get(tipo)
      if (!hit) continue
      files.push({
        tipo,
        filename: hit.filename,
        base64: this.bufferToBase64(hit.buffer),
        asientosCount: hit.asientosCount ?? 0,
        cuadreErrors: hit.cuadreErrors ?? [],
      })
    }

    const tiposToGenerate = tipos.filter(t => !cachedByTipo.has(t))
    if (!tiposToGenerate.length) return this.orderFiles(files, tipos)

    // Trabajo pesado (IA + tipo de cambio + ExcelJS) solo para los faltantes.
    const [projectMap, categoryMap] = await Promise.all([
      this.buildProjectMap(expenses, report, clientId),
      this.buildCategoryMap(expenses, clientId),
    ])

    const periodDate = this.resolvePeriodDate(report, advances)

    // prefetchRates (API externa) y la clasificación de cargos ≠ IGV (IA solo
    // si hay cargos desconocidos sin clasificar) son independientes: en paralelo.
    const [rateMap, cargosMap] = await Promise.all([
      this.prefetchRates(report, expenses, advances, config),
      tiposToGenerate.includes('compra') && expenses.length > 0
        ? this.resolveCargosClasificacion(expenses)
        : Promise.resolve(new Map<string, ExpenseCargoClasificado[]>()),
    ])

    // Genera tipos secuencialmente: ExcelJS carga un workbook completo en RAM por tipo,
    // generar en paralelo multiplica el pico de memoria por N (causaba OOM a ~4 GB).
    const generated: GeneratedFile[] = []
    for (const tipo of tiposToGenerate) {
      const lines = await this.buildLinesForTipo(tipo, {
        report,
        config,
        expenses,
        advances,
        colaborador,
        projectMap,
        categoryMap,
        periodDate,
        rateMap,
        cargosMap,
      })
      if (!lines.length) continue
      const cuadreErrors = this.validateCuadre(lines)
      if (cuadreErrors.length) {
        this.logger.warn(
          `[asientos] cuadre incorrecto en tipo="${tipo}" reportId=${reportId}: ` +
            cuadreErrors
              .map(e => `rel=${e.relacionado} diff=${e.diferencia}`)
              .join(', ')
        )
      }
      const buffer = await buildContanetWorkbook(lines, 'CONTABILIDAD', tipo)
      const filename = this.fileName(tipo, report)
      const asientosCount = this.countAsientos(lines)
      void this.persistCache(report, clientId, tipo, fingerprint, {
        filename,
        buffer,
        asientosCount,
        cuadreErrors,
      })
      generated.push({
        tipo,
        filename,
        base64: buffer.toString('base64'),
        asientosCount,
        cuadreErrors,
      })
      // Release ExcelJS workbook memory before building the next tipo.
      // Requires --expose-gc (set in Dockerfile CMD).
      if (typeof (global as any).gc === 'function') (global as any).gc()
    }

    files.push(...generated)
    return this.orderFiles(files, tipos)
  }

  /** Ordena los archivos según el orden solicitado en `tipos`. */
  private orderFiles(files: GeneratedFile[], tipos: AsientoTipo[]): GeneratedFile[] {
    const order = new Map(tipos.map((t, i) => [t, i]))
    return [...files].sort(
      (a, b) => (order.get(a.tipo) ?? 0) - (order.get(b.tipo) ?? 0)
    )
  }

  /** base64 de un Buffer de Mongo (puede llegar como { buffer } binario). */
  private bufferToBase64(buf: any): string {
    if (Buffer.isBuffer(buf)) return buf.toString('base64')
    if (buf?.buffer) return Buffer.from(buf.buffer).toString('base64')
    return Buffer.from(buf ?? []).toString('base64')
  }

  /**
   * Hash de invalidación de caché. Cualquier cambio en la rendición, sus gastos,
   * los anticipos o la configuración contable produce un fingerprint distinto.
   */
  private computeFingerprint(
    report: any,
    expenses: any[],
    advances: any[],
    config: any
  ): string {
    const ts = (x: any): number => {
      const raw = x?.updatedAt || x?.createdAt
      const t = raw ? new Date(raw).getTime() : 0
      return Number.isNaN(t) ? 0 : t
    }
    const maxTs = (arr: any[]): number =>
      arr.reduce((m, x) => Math.max(m, ts(x)), 0)
    const parts = [
      ts(report),
      report?.status ?? '',
      expenses.length,
      maxTs(expenses),
      advances.length,
      maxTs(advances),
      ts(config),
    ]
    return createHash('sha1').update(parts.join('|')).digest('hex')
  }

  /** Persiste (upsert) el archivo generado en la caché de asientos. */
  private async persistCache(
    report: any,
    clientId: string,
    tipo: AsientoTipo,
    fingerprint: string,
    data: {
      filename: string
      buffer: Buffer
      asientosCount: number
      cuadreErrors: CuadreError[]
    }
  ): Promise<void> {
    try {
      await this.cacheModel
        .findOneAndUpdate(
          { reportId: report._id, tipo },
          {
            $set: {
              clientId: report.clientId ?? clientId,
              fingerprint,
              filename: data.filename,
              buffer: data.buffer,
              asientosCount: data.asientosCount,
              cuadreErrors: data.cuadreErrors,
            },
          },
          { upsert: true }
        )
        .exec()
    } catch (error) {
      // La caché es best-effort: si falla, el archivo igual se devuelve.
      this.logger.warn(
        `No se pudo cachear asientos (${tipo}): ${(error as Error)?.message}`
      )
    }
  }

  /** Elimina todas las entradas de caché de una rendición. */
  async clearCache(reportId: string): Promise<{ deleted: number }> {
    const result = await this.cacheModel.deleteMany({ reportId }).exec()
    return { deleted: result.deletedCount ?? 0 }
  }

  private fileName(tipo: AsientoTipo, report: any): string {
    const code =
      report.codigo || report._id?.toString()?.slice(-6) || 'rendicion'
    const ext = 'xlsx'
    return `asientos_${tipo}_${code}.${ext}`
  }

  /** Fecha de referencia para ejercicio/periodo: inicio de la solicitud. */
  private resolvePeriodDate(report: any, advances: any[]): Date {
    const advStarts = (advances ?? [])
      .map(a => a?.startDate || a?.createdAt)
      .filter(Boolean)
      .map(d => new Date(d))
      .filter(d => !Number.isNaN(d.getTime()))
    if (advStarts.length) {
      return advStarts.sort((a, b) => a.getTime() - b.getTime())[0]
    }
    const raw = report?.startDate || report?.createdAt
    const d = raw ? new Date(raw) : new Date()
    return Number.isNaN(d.getTime()) ? new Date() : d
  }

  /** Prefetch del tipo de cambio (PEN/USD) de todas las fechas del lote. */
  private async prefetchRates(
    report: any,
    expenses: any[],
    advances: any[],
    config: AccountingConfigDocument
  ): Promise<Map<string, number>> {
    const dates = new Set<string>()
    const add = (d: Date) => dates.add(d.toISOString().slice(0, 10))
    for (const e of expenses) add(this.asientoDate(e, report))
    for (const a of advances) {
      const d = a?.payment?.transferDate || a?.startDate || a?.createdAt
      if (d) add(new Date(d))
    }
    if (report?.updatedAt) add(new Date(report.updatedAt))
    add(this.resolvePeriodDate(report, advances))

    const fallback = Number(config.tipoCambio) || 1
    const map = new Map<string, number>()
    // Consulta todas las fechas en paralelo (cada una cachea en BD por su cuenta).
    const isoList = Array.from(dates)
    const rates = await Promise.all(
      isoList.map(iso => this.exchangeRateService.getRate(iso))
    )
    isoList.forEach((iso, i) => map.set(iso, rates[i] ?? fallback))
    return map
  }

  /** Tipo de cambio (PEN/USD) de una fecha, desde el mapa prefetcheado. */
  private tcFor(
    date: Date,
    rateMap: Map<string, number>,
    config: AccountingConfigDocument
  ): number {
    const iso = date.toISOString().slice(0, 10)
    return rateMap.get(iso) ?? (Number(config.tipoCambio) || 1)
  }

  private async buildLinesForTipo(
    tipo: AsientoTipo,
    ctx: {
      report: any
      config: AccountingConfigDocument
      expenses: any[]
      advances: any[]
      colaborador: any
      projectMap: Map<string, any>
      categoryMap: Map<string, any>
      periodDate: Date
      rateMap: Map<string, number>
      cargosMap: Map<string, ExpenseCargoClasificado[]>
    }
  ): Promise<ContanetLine[]> {
    switch (tipo) {
      case 'compra':
        return this.buildCompraLines(ctx)
      case 'solicitud':
        return this.buildSolicitudLines(ctx)
      case 'aplicacion':
        return this.buildAplicacionLines(ctx)
      case 'devolucion':
        return this.buildDevolucionReembolsoLines(ctx, 'devolucion')
      case 'reembolso':
        return this.buildDevolucionReembolsoLines(ctx, 'reembolso')
      default:
        return []
    }
  }

  /** Mapa categoryId → categoría (para resolver cuentas 9X/6X). */
  private async buildCategoryMap(
    expenses: any[],
    clientId: string
  ): Promise<Map<string, any>> {
    const ids = new Set<string>()
    for (const e of expenses) {
      if (e.categoryId) ids.add(e.categoryId.toString())
    }
    const categories = (
      ids.size
        ? await this.categoryModel
            .find({ _id: { $in: Array.from(ids) }, clientId })
            .lean()
            .exec()
        : []
    ) as any[]
    const map = new Map<string, any>()
    for (const c of categories) map.set(c._id.toString(), c)
    return map
  }

  // ----------------------------------------------------------------------
  // Helpers de datos
  // ----------------------------------------------------------------------

  private async buildProjectMap(
    expenses: any[],
    report: any,
    clientId: string
  ): Promise<Map<string, any>> {
    const ids = new Set<string>()
    if (report.projectId) ids.add(report.projectId.toString())
    for (const e of expenses) {
      if (e.proyectId) ids.add(e.proyectId.toString())
      for (const d of e.detalleAnalitico ?? []) {
        if (d.proyectId) ids.add(d.proyectId.toString())
      }
    }
    const projects = (
      ids.size
        ? await this.projectModel
            .find({ _id: { $in: Array.from(ids) }, clientId })
            .lean()
            .exec()
        : []
    ) as any[]
    const map = new Map<string, any>()
    for (const p of projects) map.set(p._id.toString(), p)
    return map
  }

  /** Parsea el JSON `data` del comprobante de forma segura. */
  private parseData(expense: any): Record<string, any> {
    if (!expense?.data || typeof expense.data !== 'string') return {}
    try {
      return JSON.parse(expense.data)
    } catch {
      return {}
    }
  }

  /** Fecha del asiento: fechaEmision del comprobante o fecha del reporte. */
  private asientoDate(expense: any, report: any): Date {
    const raw = expense?.fechaEmision || report?.createdAt || report?.updatedAt
    const d = raw ? new Date(raw) : new Date()
    return Number.isNaN(d.getTime()) ? new Date() : d
  }

  /**
   * Resuelve las porciones analíticas de un comprobante (factura).
   * Prioridad: (1) detalleAnalitico explícito, (2) totales de `comprobanteDetallado`
   * (gravada/exonerada/inafecta + recargo al consumo + ISC/ICBPER deterministas
   * + otros cargos clasificados), (3) base/IGV/inafecto sueltos.
   */
  private resolvePortions(
    expense: any,
    cargosClasificados: ExpenseCargoClasificado[] = []
  ): AnalyticPortion[] {
    const proyectId = expense.proyectId?.toString()

    // (1) Detalle explícito (corregido por Contabilidad)
    const detalle: AnalyticPortion[] = (expense.detalleAnalitico ?? []).map(
      (d: any) => ({
        proyectId: d.proyectId?.toString() || proyectId,
        condicion: d.condicion === 'inafecto' ? 'inafecto' : 'afecto',
        monto: this.round2(Number(d.monto) || 0),
        etiqueta: undefined,
      })
    )
    if (detalle.length) return detalle

    // (2) Totales del objeto detallado de la factura
    const tot = expense.comprobanteDetallado?.totales ?? {}
    const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)
    const gravada = num(tot.operacionGravada)
    const exonerada = num(tot.operacionExonerada)
    const inafectaOp = num(tot.operacionInafecta)
    const gratuita = num(tot.operacionGratuita)
    const recargo =
      num(expense.comprobanteDetallado?.recargoConsumo) || num(expense.inafecto)

    const portions: AnalyticPortion[] = []
    if (gravada > 0)
      portions.push({
        proyectId,
        condicion: 'afecto',
        monto: this.round2(gravada),
      })
    if (exonerada > 0)
      portions.push({
        proyectId,
        condicion: 'inafecto',
        monto: this.round2(exonerada),
      })
    if (inafectaOp > 0)
      portions.push({
        proyectId,
        condicion: 'inafecto',
        monto: this.round2(inafectaOp),
      })
    if (gratuita > 0)
      portions.push({
        proyectId,
        condicion: 'inafecto',
        monto: this.round2(gratuita),
      })
    if (recargo > 0)
      portions.push({
        proyectId,
        condicion: 'inafecto',
        monto: this.round2(recargo),
        etiqueta: 'RECARGO DE CONSUMO',
      })

    // Cargos ≠ IGV deterministas (sin IA): ISC e ICBPER son deducibles y van
    // con la misma cuenta de la categoría, como porciones inafectas.
    const isc = num(tot.isc)
    const icbper = num(tot.icbper)
    if (isc > 0)
      portions.push({
        proyectId,
        condicion: 'inafecto',
        monto: this.round2(isc),
        etiqueta: 'ISC',
      })
    if (icbper > 0)
      portions.push({
        proyectId,
        condicion: 'inafecto',
        monto: this.round2(icbper),
        etiqueta: 'ICBPER',
      })

    // Otros cargos (otrosTributos/otrosCargos) según su clasificación:
    // deducible → porción normal; no deducible → serie de control interno.
    for (const cargo of cargosClasificados) {
      if (cargo.monto <= 0) continue
      portions.push({
        proyectId,
        condicion: 'inafecto',
        monto: this.round2(cargo.monto),
        etiqueta: cargo.deducible
          ? cargo.concepto === 'otrosTributos'
            ? 'OTROS TRIBUTOS'
            : 'OTROS CARGOS'
          : 'NO DEDUCIBLE',
        ...(cargo.deducible
          ? {}
          : { serieNoDeducible: cargo.serieControlInterno || '0001' }),
      })
    }
    if (portions.length) return portions

    // (3) Respaldo: base/IGV/inafecto sueltos o solo el total
    const total = Number(expense.total) || 0
    const igv = Number(expense.igv) || 0
    const inafecto = Number(expense.inafecto) || 0
    const base =
      Number(expense.baseAfecta) || Math.max(total - igv - inafecto, 0)
    if (base > 0)
      portions.push({
        proyectId,
        condicion: 'afecto',
        monto: this.round2(base),
      })
    if (inafecto > 0)
      portions.push({
        proyectId,
        condicion: 'inafecto',
        monto: this.round2(inafecto),
      })
    if (!portions.length && total > 0)
      portions.push({
        proyectId,
        condicion: 'afecto',
        monto: this.round2(total),
      })
    return portions
  }

  /**
   * Porciones de un documento SIN derecho a crédito fiscal (boleta, ticket,
   * planilla de movilidad, recibos, DJ, otros): todo el importe es gasto.
   * El detalleAnalitico explícito (corregido por Contabilidad) sigue mandando.
   */
  private resolveNonFacturaPortions(expense: any): AnalyticPortion[] {
    const proyectId = expense.proyectId?.toString()
    const detalle: AnalyticPortion[] = (expense.detalleAnalitico ?? []).map(
      (d: any) => ({
        proyectId: d.proyectId?.toString() || proyectId,
        condicion: d.condicion === 'inafecto' ? 'inafecto' : 'afecto',
        monto: this.round2(Number(d.monto) || 0),
      })
    )
    if (detalle.length) return detalle

    const det = expense.comprobanteDetallado ?? {}
    const total = this.round2(
      Number(expense.total) || Number(det?.totales?.importeTotal) || 0
    )
    if (total <= 0) return []
    return [{ proyectId, condicion: 'inafecto', monto: total }]
  }

  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100
  }

  /**
   * Línea base con los campos comunes a todo asiento.
   * `date` = fecha del comprobante (para las columnas de fechas y el tipo de cambio).
   * `periodDate` = fecha de inicio de la solicitud (para ejercicio/periodo).
   * `tc` = tipo de cambio PEN/USD del día.
   */
  private baseLine(
    config: AccountingConfigDocument,
    date: Date,
    fuente: string,
    glosa: string,
    tc: number,
    periodDate: Date,
    extra: ContanetLine = {}
  ): ContanetLine {
    const serial = toExcelSerial(date)
    return {
      ejercicio: periodDate.getUTCFullYear(),
      periodo: String(periodDate.getUTCMonth() + 1).padStart(2, '0'),
      codModulo: config.codModulo,
      modulo: config.modulo,
      fuente,
      conceptoFec: config.conceptoFec,
      glosa,
      mdaOrigen: config.monedaOrigen,
      mdaRegistro: config.monedaRegistro,
      centroCosto: config.centroCosto || '',
      subCentroCosto: config.subCentroCosto || '',
      subSubCentroCosto: config.subCentroCosto || '',
      area: config.area || '',
      identCtrMda: config.identificadorCtrMda,
      fechaEmision: serial,
      fechaVencimiento: serial,
      fechaMovimiento: serial,
      fechaRegistro: serial,
      cambioMoneda: tc,
      esCancelado: 0,
      esConciliado: 0,
      esProvision: 0,
      esAnulado: 0,
      esDestino: 0,
      montoDebe: 0,
      montoHaber: 0,
      montoDebeME: 0,
      montoHaberME: 0,
      ...extra,
    }
  }

  /**
   * Aplica el centro de costo del proyecto a una línea. El "Codigo Centro Costo"
   * y el "Codigo Sub Centro Costo" reciben el código del centro de costo
   * (proyecto). Prioriza los campos contables explícitos del proyecto y, si no,
   * usa el `code` del centro de costo.
   */
  private applyProjectCostCenter(
    line: ContanetLine,
    project: any | undefined
  ): void {
    if (!project) return
    const cc = project.centroCosto || project.code || ''
    const sub =
      project.subCentroCosto || project.centroCosto || project.code || ''
    if (cc) line.centroCosto = cc
    if (sub) {
      line.subCentroCosto = sub
      line.subSubCentroCosto = sub
    }
    if (project.area) line.area = project.area
  }

  /** Subcuenta 14 del colaborador (parametrizada o construida con la raíz). */
  private cuenta14(config: AccountingConfigDocument, colaborador: any): string {
    if (colaborador?.subcuenta14) return colaborador.subcuenta14
    return config.cuenta14Raiz
  }

  // ----------------------------------------------------------------------
  // Cargos ≠ IGV — clasificación de deducibilidad (IA solo si es necesario)
  // ----------------------------------------------------------------------

  /**
   * Cargos del comprobante que requieren clasificación de deducibilidad.
   * `recargoConsumo`, `isc` e `icbper` NO pasan por aquí: son deducibles por
   * regla determinista y se resuelven directo en `resolvePortions`.
   */
  private extractCargosDesconocidos(
    expense: any
  ): Array<{ concepto: string; monto: number }> {
    const tot = expense?.comprobanteDetallado?.totales ?? {}
    const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)
    const out: Array<{ concepto: string; monto: number }> = []
    const otrosTributos = this.round2(num(tot.otrosTributos))
    const otrosCargos = this.round2(num(tot.otrosCargos))
    if (otrosTributos > 0)
      out.push({ concepto: 'otrosTributos', monto: otrosTributos })
    if (otrosCargos > 0) out.push({ concepto: 'otrosCargos', monto: otrosCargos })
    return out
  }

  /** Hash de los cargos: si no cambian, la clasificación persistida sigue válida. */
  private cargosHash(cargos: Array<{ concepto: string; monto: number }>): string {
    return createHash('sha1').update(JSON.stringify(cargos)).digest('hex')
  }

  /**
   * Clasifica los cargos ≠ IGV de las facturas de la rendición.
   * Orden de resolución (para minimizar IA):
   *  1. Sin cargos desconocidos → nada que hacer (caso común, 0 IA).
   *  2. Clasificación ya persistida en el expense con el mismo hash → reuso.
   *  3. Restantes → UN solo request batcheado a DeepSeek; el veredicto se
   *     persiste en el expense (sin tocar updatedAt, no invalida la caché).
   * Si la IA falla, los cargos se tratan como deducibles (revisión manual).
   */
  private async resolveCargosClasificacion(
    expenses: any[]
  ): Promise<Map<string, ExpenseCargoClasificado[]>> {
    const map = new Map<string, ExpenseCargoClasificado[]>()
    const pendientes: Array<{
      expense: any
      cargos: Array<{ concepto: string; monto: number }>
      hash: string
    }> = []

    for (const expense of expenses) {
      if (expense.expenseType && expense.expenseType !== 'factura') continue
      const cargos = this.extractCargosDesconocidos(expense)
      if (!cargos.length) continue
      const hash = this.cargosHash(cargos)
      const stored: ExpenseCargosClasificacion | undefined =
        expense.otrosCargosClasificacion
      if (stored?.hash === hash && Array.isArray(stored.cargos)) {
        map.set(expense._id.toString(), stored.cargos)
      } else {
        pendientes.push({ expense, cargos, hash })
      }
    }
    if (!pendientes.length) return map

    // Contexto por cargo para el prompt (idx global sobre todos los pendientes).
    const contexts: CargoContext[] = []
    const owners: Array<{ pendiente: (typeof pendientes)[0]; cargoIdx: number }> =
      []
    for (const pendiente of pendientes) {
      const det = pendiente.expense.comprobanteDetallado ?? {}
      const items: string[] = (det.items ?? [])
        .map((it: any) => String(it?.descripcion || '').trim())
        .filter(Boolean)
      pendiente.cargos.forEach((cargo, cargoIdx) => {
        contexts.push({
          idx: contexts.length + 1,
          concepto: cargo.concepto,
          monto: cargo.monto,
          proveedor: det?.emisor?.razonSocial || '',
          descripcion: pendiente.expense.comentario || '',
          items,
          leyendas: det?.leyendas || '',
          observaciones: det?.observaciones || '',
        })
        owners.push({ pendiente, cargoIdx })
      })
    }

    // Por defecto (o si la IA falla): deducible, sin serie de control.
    const verdicts: Array<{ deducible: boolean; serie?: string }> =
      contexts.map(() => ({ deducible: true }))

    try {
      const completion = await this.openai.chat.completions.create(
        {
          model: this.aiModel,
          messages: [
            { role: 'user', content: buildDeducibilidadPrompt(contexts) },
          ],
          temperature: 0,
          max_tokens: 4096,
        },
        { timeout: 60000 }
      )
      const rawContent = (completion.choices[0]?.message?.content || '').trim()
      const raw = rawContent
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim()
      const parsed: Array<{ idx: number; deducible?: boolean; serie?: string }> =
        JSON.parse(raw)
      for (const entry of parsed) {
        const verdict = verdicts[entry.idx - 1]
        if (!verdict) continue
        if (entry.deducible === false) {
          const serie = String(entry.serie || '')
          verdict.deducible = false
          verdict.serie = SERIES_NO_DEDUCIBLE.has(serie) ? serie : '0001'
        }
      }
      this.logger.log(
        `[asientos] IA clasificó deducibilidad de ${contexts.length} cargos`
      )
    } catch (error) {
      this.logger.warn(
        `[asientos] IA no pudo clasificar cargos: ${(error as Error)?.message}. ` +
          'Se tratan como deducibles.'
      )
    }

    // Agrupa por expense, alimenta el mapa y persiste (best-effort).
    const byExpense = new Map<string, ExpenseCargoClasificado[]>()
    owners.forEach(({ pendiente, cargoIdx }, i) => {
      const id = pendiente.expense._id.toString()
      const list = byExpense.get(id) ?? []
      const cargo = pendiente.cargos[cargoIdx]
      const verdict = verdicts[i]
      list.push({
        concepto: cargo.concepto,
        monto: cargo.monto,
        deducible: verdict.deducible,
        ...(verdict.serie ? { serieControlInterno: verdict.serie } : {}),
      })
      byExpense.set(id, list)
    })
    for (const pendiente of pendientes) {
      const id = pendiente.expense._id.toString()
      const cargos = byExpense.get(id) ?? []
      map.set(id, cargos)
      // timestamps:false — no altera updatedAt, así el fingerprint de la caché
      // de asientos no se invalida por esta escritura interna.
      void this.expenseModel
        .updateOne(
          { _id: pendiente.expense._id },
          {
            $set: {
              otrosCargosClasificacion: { hash: pendiente.hash, cargos },
            },
          },
          { timestamps: false }
        )
        .exec()
        .catch((error: Error) =>
          this.logger.warn(
            `[asientos] no se pudo persistir clasificación de cargos: ${error.message}`
          )
        )
    }
    return map
  }

  // ----------------------------------------------------------------------
  // C2 — Builder COMPRA (registro de la compra, por comprobante)
  // ----------------------------------------------------------------------

  private async buildCompraLines(ctx: {
    report: any
    config: AccountingConfigDocument
    expenses: any[]
    projectMap: Map<string, any>
    categoryMap: Map<string, any>
    periodDate: Date
    rateMap: Map<string, number>
    cargosMap: Map<string, ExpenseCargoClasificado[]>
  }): Promise<ContanetLine[]> {
    const {
      config,
      expenses,
      report,
      projectMap,
      categoryMap,
      periodDate,
      rateMap,
      cargosMap,
    } = ctx
    const lines: ContanetLine[] = []
    let relacionado = 1
    let correlativo = 1

    for (const expense of expenses) {
      const data = this.parseData(expense)
      const det = expense.comprobanteDetallado ?? {}
      const date = this.asientoDate(expense, report)
      const tc = this.tcFor(date, rateMap, config)
      const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)

      // Tipo de documento Contanet (codigos.md). Solo la factura (01) otorga
      // crédito fiscal; boletas/tickets/planillas/recibos van íntegros al gasto.
      const codTipDoc = resolveCodTipDoc(expense, data.tipoComprobante)
      const esFactura = codTipDoc === TIPO_DOCUMENTO.FT

      // Cuenta principal: SIEMPRE de la categoría seleccionada en el documento.
      // Destino 6X: category.cuentaDestino6x → config.cuenta79 (fallback).
      const category = expense.categoryId
        ? categoryMap.get(expense.categoryId.toString())
        : undefined
      const cuenta9x = category?.cuenta || ''
      const cuenta6xCat = category?.cuentaDestino6x || config.cuenta79

      // Centro de costo del proyecto del gasto (aplica a todas las líneas).
      const expenseProject = expense.proyectId
        ? projectMap.get(expense.proyectId.toString())
        : undefined

      // IGV: solo la factura da derecho a crédito fiscal (línea 40). Si
      // Contabilidad revisó el desglose manualmente, sus valores ganan; si no,
      // manda `comprobanteDetallado`.
      const igv = !esFactura
        ? 0
        : this.round2(
            expense.desgloseRevisado
              ? Number(expense.igv) || 0
              : num(det?.totales?.igv) || Number(expense.igv) || 0
          )
      const cargos = esFactura
        ? (cargosMap.get(expense._id.toString()) ?? [])
        : []
      const portions = esFactura
        ? this.resolvePortions(expense, cargos)
        : this.resolveNonFacturaPortions(expense)
      const baseTotal = this.round2(portions.reduce((s, p) => s + p.monto, 0))
      const total = this.round2(
        num(det?.totales?.importeTotal) ||
          Number(expense.total) ||
          baseTotal + igv
      )

      const serie = det?.comprobante?.serie || data.serie || ''
      const nroDoc =
        det?.comprobante?.correlativo ||
        data.correlativo ||
        expense.internalCode ||
        ''
      const ruc = det?.emisor?.ruc || data.rucEmisor || ''
      const razonSocial =
        det?.emisor?.razonSocial ||
        data.razonSocial ||
        expense.providerName ||
        ''
      const glosaBase = (expense.comentario || data.comentario || 'GASTO')
        .toString()
        .slice(0, 100)
        .toUpperCase()

      const push = (line: ContanetLine) => {
        // Centro de costo en todas las líneas del comprobante.
        this.applyProjectCostCenter(line, expenseProject)
        line.relacionado = relacionado
        line.correlativo = correlativo++
        lines.push(line)
      }

      // (1) Cuentas 9X — analítica por porción (Debe); omitir si no hay cuenta configurada.
      // Porción NO deducible: "Codigo Tipo Document" vacío y la serie de control
      // interno (0001/0003/0008) en "Numero Documento" (nodeducible.md).
      if (cuenta9x) {
        for (const p of portions) {
          const glosa = p.etiqueta ? `${glosaBase} (${p.etiqueta})` : glosaBase
          const docFields = p.serieNoDeducible
            ? { codTipDoc: '', nroSerie: '', nroDoc: p.serieNoDeducible }
            : { codTipDoc, nroSerie: serie, nroDoc }
          push(
            this.baseLine(
              config,
              date,
              config.fuenteCompra,
              glosa,
              tc,
              periodDate,
              {
                nroCuenta: cuenta9x,
                ...docFields,
                identTipAfecto: p.condicion === 'afecto' ? 'S' : 'N',
                montoDebe: this.round2(p.monto),
                montoDebeME: this.toME(p.monto, tc),
              }
            )
          )
        }
      }

      // (2) Cuenta 40 — IGV (Debe), solo facturas con IGV
      if (igv > 0) {
        const cuenta40 = this.resolveCuenta40(config, expense.tasaIgv)
        push(
          this.baseLine(
            config,
            date,
            config.fuenteCompra,
            glosaBase,
            tc,
            periodDate,
            {
              nroCuenta: cuenta40,
              codTipDoc,
              nroSerie: serie,
              nroDoc,
              montoDebe: igv,
              montoDebeME: this.toME(igv, tc),
            }
          )
        )
      }

      // (3) Cuenta 42 — total del comprobante (Haber), provisión + proveedor
      push(
        this.baseLine(
          config,
          date,
          config.fuenteCompra,
          glosaBase,
          tc,
          periodDate,
          {
            nroCuenta: config.cuenta42,
            codTipDoc,
            nroSerie: serie,
            nroDoc,
            montoHaber: total,
            montoHaberME: this.toME(total, tc),
            esProvision: 1,
            codTipDocIdentProv: ruc ? '06' : '',
            nroDocProv: ruc,
            razonSocialProv: razonSocial,
          }
        )
      )

      // (4) Destino — par 6X (Debe) / 79 (Haber) por porción
      for (const p of portions) {
        const glosa = p.etiqueta ? `${glosaBase} (${p.etiqueta})` : glosaBase
        push(
          this.baseLine(
            config,
            date,
            config.fuenteCompra,
            glosa,
            tc,
            periodDate,
            {
              nroCuenta: cuenta6xCat,
              montoDebe: this.round2(p.monto),
              montoDebeME: this.toME(p.monto, tc),
              esDestino: 1,
            }
          )
        )
        push(
          this.baseLine(
            config,
            date,
            config.fuenteCompra,
            glosa,
            tc,
            periodDate,
            {
              nroCuenta: config.cuenta79,
              montoHaber: this.round2(p.monto),
              montoHaberME: this.toME(p.monto, tc),
              esDestino: 1,
            }
          )
        )
      }

      relacionado++
    }

    return lines
  }

  private resolveCuenta40(
    config: AccountingConfigDocument,
    tasaIgv?: number
  ): string {
    const rates = config.igvRates ?? []
    if (tasaIgv != null) {
      const match = rates.find(r => Number(r.tasa) === Number(tasaIgv))
      if (match) return match.cuenta40
    }
    return rates[0]?.cuenta40 || '40.1.1.100'
  }

  /** Equivalente en USD: monto en soles / tipo de cambio del día. */
  private toME(amount: number, tc: number): number {
    const rate = Number(tc) || 0
    if (rate <= 0) return 0
    return this.round2(amount / rate)
  }

  // ----------------------------------------------------------------------
  // C3 — Builders SOLICITUD / APLICACIÓN / DEVOLUCIÓN-REEMBOLSO
  // ----------------------------------------------------------------------

  private async buildSolicitudLines(ctx: {
    report: any
    config: AccountingConfigDocument
    advances: any[]
    colaborador: any
    periodDate: Date
    rateMap: Map<string, number>
  }): Promise<ContanetLine[]> {
    const { config, advances, colaborador, report, periodDate, rateMap } = ctx
    const lines: ContanetLine[] = []
    let relacionado = 1
    let correlativo = 1
    const trabDni = colaborador?.dni || ''
    const trabNombre = colaborador?.name || ''
    const cuenta14 = this.cuenta14(config, colaborador)

    for (const adv of advances) {
      const amount = this.round2(Number(adv.amount) || 0)
      if (amount <= 0) continue
      const rawDate =
        adv.payment?.transferDate || adv.startDate || adv.createdAt
      const date = rawDate ? new Date(rawDate) : new Date()
      const tc = this.tcFor(date, rateMap, config)
      const banco = this.resolveBankAccount(config, adv.payment?.accountNumber)
      const glosa = (adv.description || 'SOLICITUD VIATICO')
        .toString()
        .slice(0, 100)
        .toUpperCase()

      // 14 (Debe) — nace la obligación del colaborador
      lines.push({
        ...this.baseLine(
          config,
          date,
          config.fuenteCajaBancos,
          glosa,
          tc,
          periodDate,
          {
            nroCuenta: cuenta14,
            montoDebe: amount,
            montoDebeME: this.toME(amount, tc),
            codTipDocIdentTrab: trabDni ? '01' : '',
            nroDocTrab: trabDni,
            razonSocialTrab: trabNombre,
          }
        ),
        relacionado,
        correlativo: correlativo++,
      })

      // 104 (Haber) — sale el dinero del banco
      lines.push({
        ...this.baseLine(
          config,
          date,
          config.fuenteCajaBancos,
          glosa,
          tc,
          periodDate,
          {
            nroCuenta: banco,
            montoHaber: amount,
            montoHaberME: this.toME(amount, tc),
          }
        ),
        relacionado,
        correlativo: correlativo++,
      })

      relacionado++
    }

    void report
    return lines
  }

  private async buildAplicacionLines(ctx: {
    report: any
    config: AccountingConfigDocument
    expenses: any[]
    colaborador: any
    periodDate: Date
    rateMap: Map<string, number>
  }): Promise<ContanetLine[]> {
    const { config, expenses, colaborador, report, periodDate, rateMap } = ctx
    const lines: ContanetLine[] = []
    let relacionado = 1
    let correlativo = 1
    const trabDni = colaborador?.dni || ''
    const trabNombre = colaborador?.name || ''
    const cuenta14 = this.cuenta14(config, colaborador)

    for (const expense of expenses) {
      const data = this.parseData(expense)
      const det = expense.comprobanteDetallado ?? {}
      const date = this.asientoDate(expense, report)
      const tc = this.tcFor(date, rateMap, config)
      // Mismo total que el asiento de compra (comprobanteDetallado primero)
      // para que compra y aplicación descarguen importes idénticos.
      const total = this.round2(
        Number(det?.totales?.importeTotal) || Number(expense.total) || 0
      )
      if (total <= 0) continue
      const ruc = det?.emisor?.ruc || data.rucEmisor || ''
      const razonSocial =
        det?.emisor?.razonSocial ||
        data.razonSocial ||
        expense.providerName ||
        ''
      const glosa = 'APLICACION'
      const codTipDoc = resolveCodTipDoc(expense, data.tipoComprobante)

      // 42 (Debe) — cancela la provisión del proveedor
      lines.push({
        ...this.baseLine(
          config,
          date,
          config.fuenteAplicacion,
          glosa,
          tc,
          periodDate,
          {
            nroCuenta: config.cuenta42,
            codTipDoc,
            nroSerie: det?.comprobante?.serie || data.serie || '',
            nroDoc: det?.comprobante?.correlativo || data.correlativo || '',
            montoDebe: total,
            montoDebeME: this.toME(total, tc),
            codTipDocIdentProv: ruc ? '06' : '',
            nroDocProv: ruc,
            razonSocialProv: razonSocial,
          }
        ),
        relacionado,
        correlativo: correlativo++,
      })

      // 14 (Haber) — reduce la cuenta por cobrar del colaborador
      lines.push({
        ...this.baseLine(
          config,
          date,
          config.fuenteAplicacion,
          glosa,
          tc,
          periodDate,
          {
            nroCuenta: cuenta14,
            montoHaber: total,
            montoHaberME: this.toME(total, tc),
            codTipDocIdentTrab: trabDni ? '01' : '',
            nroDocTrab: trabDni,
            razonSocialTrab: trabNombre,
          }
        ),
        relacionado,
        correlativo: correlativo++,
      })

      relacionado++
    }

    return lines
  }

  private async buildDevolucionReembolsoLines(
    ctx: {
      report: any
      config: AccountingConfigDocument
      advances: any[]
      colaborador: any
      periodDate: Date
      rateMap: Map<string, number>
    },
    modo: 'devolucion' | 'reembolso'
  ): Promise<ContanetLine[]> {
    const { config, colaborador, report, advances, periodDate, rateMap } = ctx
    const settlement = report.settlement
    const diff = this.round2(Math.abs(Number(settlement?.difference) || 0))
    if (diff <= 0) return []

    // Coherencia: solo emitir si el tipo de liquidación corresponde al modo.
    if (settlement?.type && settlement.type !== modo) return []

    const date = new Date(report.updatedAt || Date.now())
    const tc = this.tcFor(date, rateMap, config)
    const trabDni = colaborador?.dni || ''
    const trabNombre = colaborador?.name || ''
    const cuenta14 = this.cuenta14(config, colaborador)
    const banco = this.resolveBankAccount(
      config,
      advances?.[0]?.payment?.accountNumber
    )
    const glosa = modo === 'devolucion' ? 'DEVOLUCION' : 'REEMBOLSO'
    const cuentaColab =
      modo === 'reembolso' && config.cuentaReembolso === '46'
        ? config.cuenta46 || cuenta14
        : cuenta14

    const lines: ContanetLine[] = []

    if (modo === 'devolucion') {
      // 104 (Debe) entra al banco / 14 (Haber) reduce la CxC
      lines.push({
        ...this.baseLine(
          config,
          date,
          config.fuenteCajaBancos,
          glosa,
          tc,
          periodDate,
          {
            nroCuenta: banco,
            montoDebe: diff,
            montoDebeME: this.toME(diff, tc),
          }
        ),
        relacionado: 1,
        correlativo: 1,
      })
      lines.push({
        ...this.baseLine(
          config,
          date,
          config.fuenteCajaBancos,
          glosa,
          tc,
          periodDate,
          {
            nroCuenta: cuenta14,
            montoHaber: diff,
            montoHaberME: this.toME(diff, tc),
            codTipDocIdentTrab: trabDni ? '01' : '',
            nroDocTrab: trabDni,
            razonSocialTrab: trabNombre,
          }
        ),
        relacionado: 1,
        correlativo: 2,
      })
    } else {
      // Reembolso: 14/46 (Debe) / 104 (Haber) sale del banco
      lines.push({
        ...this.baseLine(
          config,
          date,
          config.fuenteCajaBancos,
          glosa,
          tc,
          periodDate,
          {
            nroCuenta: cuentaColab,
            montoDebe: diff,
            montoDebeME: this.toME(diff, tc),
            codTipDocIdentTrab: trabDni ? '01' : '',
            nroDocTrab: trabDni,
            razonSocialTrab: trabNombre,
          }
        ),
        relacionado: 1,
        correlativo: 1,
      })
      lines.push({
        ...this.baseLine(
          config,
          date,
          config.fuenteCajaBancos,
          glosa,
          tc,
          periodDate,
          {
            nroCuenta: banco,
            montoHaber: diff,
            montoHaberME: this.toME(diff, tc),
          }
        ),
        relacionado: 1,
        correlativo: 2,
      })
    }

    return lines
  }

  private resolveBankAccount(
    config: AccountingConfigDocument,
    nroCuenta?: string
  ): string {
    const accounts = config.bankAccounts ?? []
    if (nroCuenta) {
      const match = accounts.find(b => b.nroCuenta === nroCuenta)
      if (match) return match.cuentaContable
    }
    const active = accounts.find(b => b.activo !== false)
    return active?.cuentaContable || accounts[0]?.cuentaContable || '10.4.1.100'
  }

  // ----------------------------------------------------------------------
  // C4 — Validación de cuadre (partida doble)
  // ----------------------------------------------------------------------

  validateCuadre(lines: ContanetLine[]): CuadreError[] {
    const groups = new Map<number, { debe: number; haber: number }>()
    for (const line of lines) {
      const rel = Number(line.relacionado)
      if (!groups.has(rel)) groups.set(rel, { debe: 0, haber: 0 })
      const g = groups.get(rel)!
      g.debe += Number(line.montoDebe) || 0
      g.haber += Number(line.montoHaber) || 0
    }
    const errors: CuadreError[] = []
    for (const [rel, g] of groups) {
      const debe = this.round2(g.debe)
      const haber = this.round2(g.haber)
      if (Math.abs(debe - haber) > 0.001) {
        errors.push({
          relacionado: rel,
          totalDebe: debe,
          totalHaber: haber,
          diferencia: this.round2(debe - haber),
        })
      }
    }
    return errors
  }

  private countAsientos(lines: ContanetLine[]): number {
    return new Set(lines.map(l => Number(l.relacionado))).size
  }

  /** Expuesto para tests: columnas del template. */
  get columns() {
    return CONTANET_COLUMNS
  }
}
