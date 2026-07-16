import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Expense, ExpenseDocument } from '../expense/entities/expense.entity'
import { Advance, AdvanceDocument } from '../advance/entities/advance.entity'
import {
  ExpenseReport,
  ExpenseReportDocument,
} from '../expense-report/entities/expense-report.entity'
import { DashboardQueryDto } from './dto/dashboard-query.dto'

interface ResolvedRange {
  from: Date
  to: Date
  prevFrom: Date
  prevTo: Date
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Expense.name)
    private readonly expenseModel: Model<ExpenseDocument>,
    @InjectModel(Advance.name)
    private readonly advanceModel: Model<AdvanceDocument>,
    @InjectModel(ExpenseReport.name)
    private readonly reportModel: Model<ExpenseReportDocument>
  ) {}

  async getDashboard(clientId: string, query: DashboardQueryDto) {
    const clientOid = new Types.ObjectId(clientId)
    const range = this.resolveRange(query.dateFrom, query.dateTo)

    const [
      expenseAgg,
      expenseAggPrev,
      expenseByStatus,
      expenseByType,
      topCategories,
      topProjects,
      topCollaborators,
      expenseMonthly,
      advanceAgg,
      advanceByStatus,
      advanceMonthly,
      pendingReturns,
      reportByStatus,
      topLocations,
      // Viáticos: en Detroit las solicitudes/anticipos no viven en `advances` sino
      // como ExpenseReport con type='viatico'. Se agregan aquí y se combinan con los
      // advances (legacy) para que los KPI de anticipos reflejen la data real.
      viaticoAgg,
      viaticoByStatus,
      viaticoMonthly,
      viaticoReturns,
      topViaticoLocations,
    ] = await Promise.all([
      this.aggregateExpenseTotals(clientOid, query, range.from, range.to),
      this.aggregateExpenseTotals(
        clientOid,
        query,
        range.prevFrom,
        range.prevTo
      ),
      this.aggregateExpenseByStatus(clientOid, query, range),
      this.aggregateExpenseByType(clientOid, query, range),
      this.aggregateTopCategories(clientOid, query, range),
      this.aggregateTopProjects(clientOid, query, range),
      this.aggregateTopCollaborators(clientOid, query, range),
      this.aggregateExpenseMonthly(clientOid, query, range),
      this.aggregateAdvanceTotals(clientOid, query, range),
      this.aggregateAdvanceByStatus(clientOid, query, range),
      this.aggregateAdvanceMonthly(clientOid, query, range),
      this.aggregatePendingReturns(clientOid, query, range),
      this.aggregateReportByStatus(clientOid, query, range),
      this.aggregateTopLocations(clientOid, query, range),
      this.aggregateViaticoTotals(clientOid, query, range.from, range.to),
      this.aggregateViaticoByStatus(clientOid, query, range),
      this.aggregateViaticoMonthly(clientOid, query, range),
      this.aggregateViaticoPendingReturns(clientOid, query, range),
      this.aggregateTopViaticoLocations(clientOid, query, range),
    ])

    const totalGasto = expenseAgg.amount
    const gastoCount = expenseAgg.count
    const totalGastoPrev = expenseAggPrev.amount
    const deltaPct =
      totalGastoPrev > 0
        ? ((totalGasto - totalGastoPrev) / totalGastoPrev) * 100
        : totalGasto > 0
          ? 100
          : 0

    const statusMap = (
      rows: { status: string; amount: number; count: number }[]
    ) =>
      rows.reduce<Record<string, { amount: number; count: number }>>(
        (acc, r) => {
          acc[r.status] = { amount: r.amount, count: r.count }
          return acc
        },
        {}
      )

    // Combina filas {status, amount, count} sumando los duplicados (advances legacy
    // + viáticos comparten claves de estado como 'pending_l1', 'paid', etc.).
    const mergeStatusRows = (
      rows: { status: string; amount: number; count: number }[]
    ): { status: string; amount: number; count: number }[] => {
      const m: Record<string, { status: string; amount: number; count: number }> =
        {}
      for (const r of rows) {
        if (!m[r.status]) m[r.status] = { status: r.status, amount: 0, count: 0 }
        m[r.status].amount += r.amount
        m[r.status].count += r.count
      }
      return Object.values(m).sort((a, b) => b.amount - a.amount)
    }

    const anticipoByStatus = mergeStatusRows([
      ...advanceByStatus,
      ...viaticoByStatus,
    ])

    const eStatus = statusMap(expenseByStatus)
    const aStatus = statusMap(anticipoByStatus)

    const sumStatuses = (
      map: Record<string, { amount: number; count: number }>,
      keys: string[]
    ) =>
      keys.reduce(
        (acc, k) => {
          acc.amount += map[k]?.amount ?? 0
          acc.count += map[k]?.count ?? 0
          return acc
        },
        { amount: 0, count: 0 }
      )

    const gastoApproved = sumStatuses(eStatus, ['approved', 'sunat_valid'])
    const gastoRejected = sumStatuses(eStatus, ['rejected', 'sunat_error'])
    const gastoPending = sumStatuses(eStatus, [
      'pending',
      'sunat_valid_not_ours',
      'sunat_not_found',
    ])
    const decidedCount = gastoApproved.count + gastoRejected.count
    const tasaAprobacionGastos =
      decidedCount > 0 ? (gastoApproved.count / decidedCount) * 100 : 0

    const anticipoSolicitado = advanceAgg.amount + viaticoAgg.amount
    const anticipoSolicitadoCount = advanceAgg.count + viaticoAgg.count
    const anticipoAprobado = sumStatuses(aStatus, [
      'approved',
      'viatico_approved',
      'partially_paid',
      'paid',
      'settled',
    ])
    const anticipoPagado = sumStatuses(aStatus, [
      'partially_paid',
      'paid',
      'settled',
    ])
    const anticipoPendienteAprob = sumStatuses(aStatus, [
      'pending_l1',
      'pending_l2',
      'pending_contabilidad',
    ])
    const devolucionesPendientes = {
      amount: pendingReturns.amount + viaticoReturns.amount,
      count: pendingReturns.count + viaticoReturns.count,
    }

    const reportStatusMap = reportByStatus.reduce<Record<string, number>>(
      (acc, r) => {
        acc[r.status] = r.count
        return acc
      },
      {}
    )
    const rendicionesTotal = reportByStatus.reduce((s, r) => s + r.count, 0)
    // Detroit renombró los estados: 'submitted'/'pending_accounting' → además de
    // 'pending_contabilidad' y la cadena por centro de costo ('pending_l1'/'pending_l2').
    // 'open' = registrando gastos (en curso, no pendiente de aprobación).
    const rendicionesPendientes =
      (reportStatusMap['submitted'] ?? 0) +
      (reportStatusMap['pending_accounting'] ?? 0) +
      (reportStatusMap['pending_contabilidad'] ?? 0) +
      (reportStatusMap['pending_l1'] ?? 0) +
      (reportStatusMap['pending_l2'] ?? 0)
    const rendicionesAprobadas =
      (reportStatusMap['approved'] ?? 0) +
      (reportStatusMap['reimbursed'] ?? 0) +
      (reportStatusMap['closed'] ?? 0) +
      (reportStatusMap['settled'] ?? 0)

    return {
      range: {
        dateFrom: range.from.toISOString(),
        dateTo: range.to.toISOString(),
      },
      currency: 'PEN',
      kpis: {
        totalGasto,
        gastoCount,
        ticketPromedio: gastoCount > 0 ? totalGasto / gastoCount : 0,
        totalGastoPrev,
        totalGastoDeltaPct: deltaPct,
        gastoApprovedAmount: gastoApproved.amount,
        gastoPendingAmount: gastoPending.amount,
        gastoPendingCount: gastoPending.count,
        gastoRejectedAmount: gastoRejected.amount,
        tasaAprobacionGastos,
        anticipoSolicitado,
        anticipoSolicitadoCount,
        anticipoAprobadoAmount: anticipoAprobado.amount,
        anticipoPagadoAmount: anticipoPagado.amount,
        anticipoPendienteAprobAmount: anticipoPendienteAprob.amount,
        anticipoPendienteAprobCount: anticipoPendienteAprob.count,
        devolucionesPendientesAmount: devolucionesPendientes.amount,
        devolucionesPendientesCount: devolucionesPendientes.count,
        rendicionesTotal,
        rendicionesPendientes,
        rendicionesAprobadas,
      },
      expenseByStatus,
      expenseByType,
      advanceByStatus: anticipoByStatus,
      reportByStatus,
      topCategories,
      topProjects,
      topCollaborators,
      topLocations: this.mergeLocations([
        ...topLocations,
        ...topViaticoLocations,
      ]),
      monthlySeries: this.mergeMonthly(
        expenseMonthly,
        this.mergeMonthlyAmounts([...advanceMonthly, ...viaticoMonthly])
      ),
    }
  }

  /** Suma montos mensuales por mes (para fusionar series de advances + viáticos). */
  private mergeMonthlyAmounts(
    rows: { month: string; amount: number }[]
  ): { month: string; amount: number }[] {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.month, (m.get(r.month) ?? 0) + r.amount)
    return Array.from(m, ([month, amount]) => ({ month, amount })).sort((a, b) =>
      a.month.localeCompare(b.month)
    )
  }

  /** Fusiona ubicaciones (advances + viáticos) por destino, sumando conteo y monto. */
  private mergeLocations(
    rows: {
      place: string
      count: number
      amount: number
      lat?: number
      lng?: number
    }[]
  ) {
    const m = new Map<
      string,
      { place: string; count: number; amount: number; lat?: number; lng?: number }
    >()
    for (const r of rows) {
      const key = (r.place ?? '').toLowerCase().trim()
      const cur = m.get(key)
      if (cur) {
        cur.count += r.count
        cur.amount += r.amount
        cur.lat = cur.lat ?? r.lat
        cur.lng = cur.lng ?? r.lng
      } else {
        m.set(key, { ...r })
      }
    }
    return Array.from(m.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 20)
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private resolveRange(dateFrom?: string, dateTo?: string): ResolvedRange {
    // Los filtros llegan como 'YYYY-MM-DD'. `new Date('YYYY-MM-DD')` los interpreta
    // como medianoche UTC y un `setHours` posterior corre en la zona local, lo que
    // desplaza el borde y deja fuera registros del propio día en zonas con offset
    // negativo (p. ej. America/Lima, UTC-5): al filtrar "hasta 15/07" se perdían los
    // viáticos creados esa misma tarde. Se construye el borde como día local completo.
    const to =
      this.parseLocalDate(dateTo, true) ??
      (() => {
        const d = new Date()
        d.setHours(23, 59, 59, 999)
        return d
      })()

    const from =
      this.parseLocalDate(dateFrom, false) ??
      (() => {
        const d = new Date(to)
        d.setMonth(d.getMonth() - 6)
        d.setHours(0, 0, 0, 0)
        return d
      })()

    const spanMs = to.getTime() - from.getTime()
    const prevTo = new Date(from.getTime() - 1)
    const prevFrom = new Date(prevTo.getTime() - spanMs)

    return { from, to, prevFrom, prevTo }
  }

  /**
   * Convierte 'YYYY-MM-DD' en el inicio (00:00:00.000) o fin (23:59:59.999) de ese
   * día calendario en la zona local del servidor. Evita el corrimiento de un día
   * que produce `new Date('YYYY-MM-DD')` (parseado en UTC) frente a `setHours` local.
   */
  private parseLocalDate(
    value: string | undefined,
    endOfDay: boolean
  ): Date | null {
    if (!value) return null
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
    if (!m) {
      const d = new Date(value)
      if (isNaN(d.getTime())) return null
      d.setHours(
        endOfDay ? 23 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 999 : 0
      )
      return d
    }
    const [, y, mo, da] = m
    return new Date(
      Number(y),
      Number(mo) - 1,
      Number(da),
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0
    )
  }

  /** Match base para gastos (Expense) en el rango/filtros. */
  private expenseMatch(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    from: Date,
    to: Date
  ): Record<string, any> {
    const match: Record<string, any> = {
      clientId,
      createdAt: { $gte: from, $lte: to },
    }
    if (query.projectId) match.proyectId = new Types.ObjectId(query.projectId)
    if (query.categoryId)
      match.categoryId = new Types.ObjectId(query.categoryId)
    if (query.collaboratorId) match.createdBy = query.collaboratorId
    return match
  }

  private advanceMatch(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    from: Date,
    to: Date
  ): Record<string, any> {
    const match: Record<string, any> = {
      clientId,
      createdAt: { $gte: from, $lte: to },
    }
    if (query.projectId) match.projectId = new Types.ObjectId(query.projectId)
    if (query.collaboratorId)
      match.userId = new Types.ObjectId(query.collaboratorId)
    if (query.categoryId)
      match['lines.categoryId'] = new Types.ObjectId(query.categoryId)
    return match
  }

  private reportMatch(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    from: Date,
    to: Date
  ): Record<string, any> {
    // Rendiciones antiguas no tienen `createdAt` (el campo timestamps se agregó
    // después). Para no excluirlas, se usa la fecha embebida en el _id como
    // respaldo cuando `createdAt` falta.
    const effectiveDate = { $ifNull: ['$createdAt', { $toDate: '$_id' }] }
    const match: Record<string, any> = {
      clientId,
      isCajaChica: { $ne: true },
      // Los viáticos (type='viatico') SÍ cuentan como rendiciones: es lo que hace
      // la página /rendiciones. El anticipo (monto S/) y la rendición (documento)
      // son métricas distintas, por eso un viático aporta a ambas. Solo se excluye
      // la caja chica.
      $expr: {
        $and: [{ $gte: [effectiveDate, from] }, { $lte: [effectiveDate, to] }],
      },
    }
    if (query.projectId) match.projectId = new Types.ObjectId(query.projectId)
    if (query.collaboratorId)
      match.userId = new Types.ObjectId(query.collaboratorId)
    return match
  }

  /**
   * Match para viáticos-solicitud (ExpenseReport con type='viatico'), que en Detroit
   * son la fuente real de los anticipos (la colección `advances` quedó en desuso).
   */
  private viaticoMatch(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    from: Date,
    to: Date
  ): Record<string, any> {
    const effectiveDate = { $ifNull: ['$createdAt', { $toDate: '$_id' }] }
    const match: Record<string, any> = {
      clientId,
      type: 'viatico',
      $expr: {
        $and: [{ $gte: [effectiveDate, from] }, { $lte: [effectiveDate, to] }],
      },
    }
    if (query.projectId) match.projectId = new Types.ObjectId(query.projectId)
    if (query.collaboratorId)
      match.userId = new Types.ObjectId(query.collaboratorId)
    if (query.categoryId)
      match['viaticoLines.categoryId'] = new Types.ObjectId(query.categoryId)
    return match
  }

  private readonly amountExpr = {
    $convert: { input: '$total', to: 'double', onError: 0, onNull: 0 },
  }

  // ─── Expense aggregations ─────────────────────────────────────────────────

  private async aggregateExpenseTotals(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    from: Date,
    to: Date
  ): Promise<{ amount: number; count: number }> {
    const res = await this.expenseModel.aggregate([
      { $match: this.expenseMatch(clientId, query, from, to) },
      {
        $group: {
          _id: null,
          amount: { $sum: this.amountExpr },
          count: { $sum: 1 },
        },
      },
    ])
    return { amount: res[0]?.amount ?? 0, count: res[0]?.count ?? 0 }
  }

  private async aggregateExpenseByStatus(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    range: ResolvedRange
  ): Promise<{ status: string; amount: number; count: number }[]> {
    const res = await this.expenseModel.aggregate([
      { $match: this.expenseMatch(clientId, query, range.from, range.to) },
      {
        $group: {
          _id: { $ifNull: ['$status', 'pending'] },
          amount: { $sum: this.amountExpr },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, status: '$_id', amount: 1, count: 1 } },
      { $sort: { amount: -1 } },
    ])
    return res
  }

  private async aggregateExpenseByType(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    range: ResolvedRange
  ): Promise<{ type: string; amount: number; count: number }[]> {
    const res = await this.expenseModel.aggregate([
      { $match: this.expenseMatch(clientId, query, range.from, range.to) },
      {
        $group: {
          _id: { $ifNull: ['$expenseType', 'factura'] },
          amount: { $sum: this.amountExpr },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, type: '$_id', amount: 1, count: 1 } },
      { $sort: { amount: -1 } },
    ])
    return res
  }

  private async aggregateTopCategories(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    range: ResolvedRange
  ) {
    const res = await this.expenseModel.aggregate([
      { $match: this.expenseMatch(clientId, query, range.from, range.to) },
      {
        $group: {
          _id: '$categoryId',
          amount: { $sum: this.amountExpr },
          count: { $sum: 1 },
        },
      },
      { $sort: { amount: -1 } },
      { $limit: 8 },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'cat',
        },
      },
      {
        $project: {
          _id: 0,
          categoryId: '$_id',
          name: {
            $ifNull: [{ $arrayElemAt: ['$cat.name', 0] }, 'Sin categoría'],
          },
          amount: 1,
          count: 1,
        },
      },
    ])
    return res
  }

  private async aggregateTopProjects(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    range: ResolvedRange
  ) {
    const res = await this.expenseModel.aggregate([
      { $match: this.expenseMatch(clientId, query, range.from, range.to) },
      {
        $group: {
          _id: '$proyectId',
          amount: { $sum: this.amountExpr },
          count: { $sum: 1 },
        },
      },
      { $sort: { amount: -1 } },
      { $limit: 8 },
      {
        $lookup: {
          from: 'projects',
          localField: '_id',
          foreignField: '_id',
          as: 'proj',
        },
      },
      {
        $project: {
          _id: 0,
          projectId: '$_id',
          name: {
            $ifNull: [
              { $arrayElemAt: ['$proj.name', 0] },
              'Sin centro de costo',
            ],
          },
          amount: 1,
          count: 1,
        },
      },
    ])
    return res
  }

  private async aggregateTopCollaborators(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    range: ResolvedRange
  ) {
    const res = await this.expenseModel.aggregate([
      { $match: this.expenseMatch(clientId, query, range.from, range.to) },
      {
        $group: {
          _id: '$createdBy',
          amount: { $sum: this.amountExpr },
          count: { $sum: 1 },
        },
      },
      { $sort: { amount: -1 } },
      { $limit: 10 },
      {
        $addFields: {
          userOid: {
            $convert: {
              input: '$_id',
              to: 'objectId',
              onError: null,
              onNull: null,
            },
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'userOid',
          foreignField: '_id',
          as: 'usr',
        },
      },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          name: {
            $ifNull: [{ $arrayElemAt: ['$usr.name', 0] }, 'Sin asignar'],
          },
          amount: 1,
          count: 1,
        },
      },
    ])
    return res
  }

  private async aggregateExpenseMonthly(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    range: ResolvedRange
  ): Promise<{ month: string; amount: number }[]> {
    const res = await this.expenseModel.aggregate([
      { $match: this.expenseMatch(clientId, query, range.from, range.to) },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m', date: '$createdAt' },
          },
          amount: { $sum: this.amountExpr },
        },
      },
      { $project: { _id: 0, month: '$_id', amount: 1 } },
      { $sort: { month: 1 } },
    ])
    return res
  }

  // ─── Advance aggregations ─────────────────────────────────────────────────

  private async aggregateAdvanceTotals(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    range: ResolvedRange
  ): Promise<{ amount: number; count: number }> {
    const res = await this.advanceModel.aggregate([
      { $match: this.advanceMatch(clientId, query, range.from, range.to) },
      {
        $group: {
          _id: null,
          amount: { $sum: { $ifNull: ['$amount', 0] } },
          count: { $sum: 1 },
        },
      },
    ])
    return { amount: res[0]?.amount ?? 0, count: res[0]?.count ?? 0 }
  }

  private async aggregateAdvanceByStatus(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    range: ResolvedRange
  ): Promise<{ status: string; amount: number; count: number }[]> {
    const res = await this.advanceModel.aggregate([
      { $match: this.advanceMatch(clientId, query, range.from, range.to) },
      {
        $group: {
          _id: { $ifNull: ['$status', 'pending_l1'] },
          // Monto desembolsado real: usa paidAmount cuando existe (pagos parciales),
          // sino el monto solicitado.
          amount: {
            $sum: { $ifNull: ['$paidAmount', { $ifNull: ['$amount', 0] }] },
          },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, status: '$_id', amount: 1, count: 1 } },
      { $sort: { amount: -1 } },
    ])
    return res
  }

  private async aggregateAdvanceMonthly(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    range: ResolvedRange
  ): Promise<{ month: string; amount: number }[]> {
    const res = await this.advanceModel.aggregate([
      { $match: this.advanceMatch(clientId, query, range.from, range.to) },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          amount: { $sum: { $ifNull: ['$amount', 0] } },
        },
      },
      { $project: { _id: 0, month: '$_id', amount: 1 } },
      { $sort: { month: 1 } },
    ])
    return res
  }

  private async aggregatePendingReturns(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    range: ResolvedRange
  ): Promise<{ amount: number; count: number }> {
    const match = this.advanceMatch(clientId, query, range.from, range.to)
    match['returnRecord.status'] = { $in: ['pending', 'proof_uploaded'] }
    const res = await this.advanceModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          amount: { $sum: { $ifNull: ['$returnRecord.amountDue', 0] } },
          count: { $sum: 1 },
        },
      },
    ])
    return { amount: res[0]?.amount ?? 0, count: res[0]?.count ?? 0 }
  }

  // ─── Viático aggregations (ExpenseReport type='viatico') ──────────────────

  /** Total solicitado en viáticos (monto pedido) y nº de solicitudes. */
  private async aggregateViaticoTotals(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    from: Date,
    to: Date
  ): Promise<{ amount: number; count: number }> {
    const res = await this.reportModel.aggregate([
      { $match: this.viaticoMatch(clientId, query, from, to) },
      {
        $group: {
          _id: null,
          amount: { $sum: { $ifNull: ['$viaticoAmount', 0] } },
          count: { $sum: 1 },
        },
      },
    ])
    return { amount: res[0]?.amount ?? 0, count: res[0]?.count ?? 0 }
  }

  private async aggregateViaticoByStatus(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    range: ResolvedRange
  ): Promise<{ status: string; amount: number; count: number }[]> {
    const res = await this.reportModel.aggregate([
      { $match: this.viaticoMatch(clientId, query, range.from, range.to) },
      {
        $group: {
          _id: { $ifNull: ['$status', 'pending_l1'] },
          // Monto desembolsado real: viaticoPaidAmount cuando existe (pagos
          // parciales), si no el monto solicitado.
          amount: {
            $sum: {
              $ifNull: ['$viaticoPaidAmount', { $ifNull: ['$viaticoAmount', 0] }],
            },
          },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, status: '$_id', amount: 1, count: 1 } },
      { $sort: { amount: -1 } },
    ])
    return res
  }

  private async aggregateViaticoMonthly(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    range: ResolvedRange
  ): Promise<{ month: string; amount: number }[]> {
    const res = await this.reportModel.aggregate([
      { $match: this.viaticoMatch(clientId, query, range.from, range.to) },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m',
              date: { $ifNull: ['$createdAt', { $toDate: '$_id' }] },
            },
          },
          amount: { $sum: { $ifNull: ['$viaticoAmount', 0] } },
        },
      },
      { $project: { _id: 0, month: '$_id', amount: 1 } },
      { $sort: { month: 1 } },
    ])
    return res
  }

  private async aggregateViaticoPendingReturns(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    range: ResolvedRange
  ): Promise<{ amount: number; count: number }> {
    const match = this.viaticoMatch(clientId, query, range.from, range.to)
    match['viaticoReturnRecord.status'] = { $in: ['pending', 'proof_uploaded'] }
    const res = await this.reportModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          amount: { $sum: { $ifNull: ['$viaticoReturnRecord.amountDue', 0] } },
          count: { $sum: 1 },
        },
      },
    ])
    return { amount: res[0]?.amount ?? 0, count: res[0]?.count ?? 0 }
  }

  private async aggregateTopViaticoLocations(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    range: ResolvedRange
  ): Promise<
    { place: string; count: number; amount: number; lat?: number; lng?: number }[]
  > {
    const baseMatch = this.viaticoMatch(clientId, query, range.from, range.to)
    const match = {
      ...baseMatch,
      viaticoPlace: { $exists: true, $nin: [null, ''] },
    }
    const res = await this.reportModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $toLower: { $trim: { input: '$viaticoPlace' } } },
          place: { $first: '$viaticoPlace' },
          count: { $sum: 1 },
          amount: { $sum: { $ifNull: ['$viaticoAmount', 0] } },
          lat: { $first: '$viaticoLat' },
          lng: { $first: '$viaticoLng' },
        },
      },
      { $sort: { amount: -1 } },
      { $limit: 20 },
      { $project: { _id: 0, place: 1, count: 1, amount: 1, lat: 1, lng: 1 } },
    ])
    return res
  }

  // ─── Expense report aggregations ──────────────────────────────────────────

  private async aggregateReportByStatus(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    range: ResolvedRange
  ): Promise<{ status: string; count: number; budget: number }[]> {
    const res = await this.reportModel.aggregate([
      { $match: this.reportMatch(clientId, query, range.from, range.to) },
      {
        $group: {
          _id: { $ifNull: ['$status', 'open'] },
          count: { $sum: 1 },
          budget: { $sum: { $ifNull: ['$budget', 0] } },
        },
      },
      { $project: { _id: 0, status: '$_id', count: 1, budget: 1 } },
      { $sort: { count: -1 } },
    ])
    return res
  }

  // ─── Location aggregations ────────────────────────────────────────────────

  private async aggregateTopLocations(
    clientId: Types.ObjectId,
    query: DashboardQueryDto,
    range: ResolvedRange
  ): Promise<
    {
      place: string
      count: number
      amount: number
      lat?: number
      lng?: number
    }[]
  > {
    const baseMatch = this.advanceMatch(clientId, query, range.from, range.to)
    const match = { ...baseMatch, place: { $exists: true, $nin: [null, ''] } }
    const res = await this.advanceModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $toLower: { $trim: { input: '$place' } } },
          place: { $first: '$place' },
          count: { $sum: 1 },
          amount: { $sum: { $ifNull: ['$amount', 0] } },
          lat: { $first: '$lat' },
          lng: { $first: '$lng' },
        },
      },
      { $sort: { amount: -1 } },
      { $limit: 20 },
      {
        $project: {
          _id: 0,
          place: 1,
          count: 1,
          amount: 1,
          lat: 1,
          lng: 1,
        },
      },
    ])
    return res
  }

  // ─── Series merge ─────────────────────────────────────────────────────────

  private mergeMonthly(
    gasto: { month: string; amount: number }[],
    anticipo: { month: string; amount: number }[]
  ): { month: string; gasto: number; anticipo: number }[] {
    const map = new Map<string, { gasto: number; anticipo: number }>()
    gasto.forEach(g => {
      map.set(g.month, { gasto: g.amount, anticipo: 0 })
    })
    anticipo.forEach(a => {
      const cur = map.get(a.month) ?? { gasto: 0, anticipo: 0 }
      cur.anticipo = a.amount
      map.set(a.month, cur)
    })
    return Array.from(map.entries())
      .map(([month, v]) => ({ month, gasto: v.gasto, anticipo: v.anticipo }))
      .sort((a, b) => a.month.localeCompare(b.month))
  }
}
