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

    const eStatus = statusMap(expenseByStatus)
    const aStatus = statusMap(advanceByStatus)

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

    const anticipoSolicitado = advanceAgg.amount
    const anticipoAprobado = sumStatuses(aStatus, [
      'approved',
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
    ])

    const reportStatusMap = reportByStatus.reduce<Record<string, number>>(
      (acc, r) => {
        acc[r.status] = r.count
        return acc
      },
      {}
    )
    const rendicionesTotal = reportByStatus.reduce((s, r) => s + r.count, 0)
    const rendicionesPendientes =
      (reportStatusMap['submitted'] ?? 0) +
      (reportStatusMap['pending_accounting'] ?? 0)
    const rendicionesAprobadas =
      (reportStatusMap['approved'] ?? 0) +
      (reportStatusMap['reimbursed'] ?? 0) +
      (reportStatusMap['closed'] ?? 0)

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
        anticipoSolicitadoCount: advanceAgg.count,
        anticipoAprobadoAmount: anticipoAprobado.amount,
        anticipoPagadoAmount: anticipoPagado.amount,
        anticipoPendienteAprobAmount: anticipoPendienteAprob.amount,
        anticipoPendienteAprobCount: anticipoPendienteAprob.count,
        devolucionesPendientesAmount: pendingReturns.amount,
        devolucionesPendientesCount: pendingReturns.count,
        rendicionesTotal,
        rendicionesPendientes,
        rendicionesAprobadas,
      },
      expenseByStatus,
      expenseByType,
      advanceByStatus,
      reportByStatus,
      topCategories,
      topProjects,
      topCollaborators,
      topLocations,
      monthlySeries: this.mergeMonthly(expenseMonthly, advanceMonthly),
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private resolveRange(dateFrom?: string, dateTo?: string): ResolvedRange {
    const to = dateTo ? new Date(dateTo) : new Date()
    to.setHours(23, 59, 59, 999)

    let from: Date
    if (dateFrom) {
      from = new Date(dateFrom)
    } else {
      from = new Date(to)
      from.setMonth(from.getMonth() - 6)
    }
    from.setHours(0, 0, 0, 0)

    const spanMs = to.getTime() - from.getTime()
    const prevTo = new Date(from.getTime() - 1)
    const prevFrom = new Date(prevTo.getTime() - spanMs)

    return { from, to, prevFrom, prevTo }
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
      $expr: {
        $and: [{ $gte: [effectiveDate, from] }, { $lte: [effectiveDate, to] }],
      },
    }
    if (query.projectId) match.projectId = new Types.ObjectId(query.projectId)
    if (query.collaboratorId)
      match.userId = new Types.ObjectId(query.collaboratorId)
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
