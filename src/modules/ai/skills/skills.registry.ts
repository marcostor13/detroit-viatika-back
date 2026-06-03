import OpenAI from 'openai'
import { AdvanceService } from '../../advance/advance.service'
import { ExpenseReportService } from '../../expense-report/expense-report.service'
import { ExpenseService } from '../../expense/expense.service'

export interface UserContext {
  userId: string
  clientId: string
  userRole: string
  userName: string
}

export const OPENAI_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_my_expense_reports',
      description:
        'Obtiene las rendiciones de gastos del usuario. Usar cuando pregunte por rendiciones, viáticos o solicitudes de gastos.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description:
              'Filtrar por estado: solicited, open, submitted, approved, rejected, closed',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_advances',
      description:
        'Obtiene los viáticos del usuario. Usar cuando pregunte por viáticos, adelantos o pagos adelantados.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description:
              'Filtrar por estado: pending_l1, pending_l2, approved, paid, settled, rejected, returned',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pending_approvals',
      description:
        'Obtiene viáticos pendientes de aprobación (solo administradores). Usar cuando el admin pregunte por aprobaciones pendientes.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_expense_summary',
      description:
        'Obtiene un resumen de gastos del usuario (o de todos los colaboradores si es admin), opcionalmente filtrado por fechas.',
      parameters: {
        type: 'object',
        properties: {
          dateFrom: {
            type: 'string',
            description: 'Fecha inicio formato YYYY-MM-DD',
          },
          dateTo: {
            type: 'string',
            description: 'Fecha fin formato YYYY-MM-DD',
          },
        },
      },
    },
  },
]

export class SkillsExecutor {
  constructor(
    private readonly advanceService: AdvanceService,
    private readonly expenseReportService: ExpenseReportService,
    private readonly expenseService: ExpenseService
  ) {}

  async execute(
    toolName: string,
    input: Record<string, any>,
    ctx: UserContext
  ): Promise<string> {
    switch (toolName) {
      case 'get_my_expense_reports':
        return this.getMyExpenseReports(input, ctx)
      case 'get_my_advances':
        return this.getMyAdvances(input, ctx)
      case 'get_pending_approvals':
        return this.getPendingApprovals(ctx)
      case 'get_expense_summary':
        return this.getExpenseSummary(input, ctx)
      default:
        return JSON.stringify({ error: `Skill "${toolName}" no encontrada` })
    }
  }

  private async getMyExpenseReports(
    input: Record<string, any>,
    ctx: UserContext
  ): Promise<string> {
    try {
      const reports = await this.expenseReportService.findAllByUser(
        ctx.userId,
        ctx.clientId
      )
      const filtered = input['status']
        ? reports.filter(r => r.status === input['status'])
        : reports
      const data = filtered.map(r => ({
        id: String((r as any)._id),
        titulo: r.title,
        estado: r.status,
        presupuesto: `S/ ${r.budget}`,
        gastos: r.expenseIds?.length ?? 0,
        anticipos: (r as any).advanceIds?.length ?? 0,
        fecha: new Date((r as any).createdAt).toLocaleDateString('es-PE'),
      }))
      return JSON.stringify({ total: data.length, rendiciones: data })
    } catch {
      return JSON.stringify({ error: 'Error al obtener rendiciones' })
    }
  }

  private async getMyAdvances(
    input: Record<string, any>,
    ctx: UserContext
  ): Promise<string> {
    try {
      const advances = await this.advanceService.findMyAdvances(
        ctx.userId,
        ctx.clientId
      )
      const filtered = input['status']
        ? advances.filter(a => a.status === input['status'])
        : advances
      const data = filtered.map(a => ({
        id: String((a as any)._id),
        monto: `S/ ${a.amount}`,
        descripcion: a.description,
        estado: a.status,
        nivelesRequeridos: a.requiredLevels,
        nivelActual: a.approvalLevel,
        fecha: new Date((a as any).createdAt).toLocaleDateString('es-PE'),
      }))
      return JSON.stringify({ total: data.length, anticipos: data })
    } catch {
      return JSON.stringify({ error: 'Error al obtener viáticos' })
    }
  }

  private async getPendingApprovals(ctx: UserContext): Promise<string> {
    if (
      ctx.userRole !== 'Administrador' &&
      ctx.userRole !== 'Superadministrador'
    ) {
      return JSON.stringify({
        error: 'Solo los administradores pueden ver aprobaciones pendientes',
      })
    }
    try {
      const pending = await this.advanceService.findPending(ctx.clientId)
      const data = pending.map(a => ({
        id: String((a as any)._id),
        colaborador: (a.userId as any)?.name ?? 'N/A',
        monto: `S/ ${a.amount}`,
        descripcion: a.description,
        estado: a.status,
        fecha: new Date((a as any).createdAt).toLocaleDateString('es-PE'),
      }))
      return JSON.stringify({ total: data.length, pendientes: data })
    } catch {
      return JSON.stringify({
        error: 'Error al obtener aprobaciones pendientes',
      })
    }
  }

  private async getExpenseSummary(
    input: Record<string, any>,
    ctx: UserContext
  ): Promise<string> {
    try {
      const isAdmin =
        ctx.userRole === 'Administrador' ||
        ctx.userRole === 'Superadministrador'
      const filters: Record<string, any> = {}
      if (input['dateFrom']) filters['dateFrom'] = input['dateFrom']
      if (input['dateTo']) filters['dateTo'] = input['dateTo']
      if (!isAdmin) filters['createdBy'] = ctx.userId

      const result = await this.expenseService.findAll(ctx.clientId, filters)
      const expenses = result.data
      const totalAmount = expenses.reduce((sum, e) => sum + (e.total ?? 0), 0)
      const byStatus = expenses.reduce<Record<string, number>>((acc, e) => {
        acc[e.status] = (acc[e.status] ?? 0) + 1
        return acc
      }, {})

      return JSON.stringify({
        totalGastos: result.total,
        montoTotal: `S/ ${totalAmount.toFixed(2)}`,
        porEstado: byStatus,
        periodo: {
          desde: input['dateFrom'] ?? 'inicio',
          hasta: input['dateTo'] ?? 'hoy',
        },
      })
    } catch {
      return JSON.stringify({ error: 'Error al obtener resumen de gastos' })
    }
  }
}
