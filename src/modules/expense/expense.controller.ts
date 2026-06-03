import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Request,
  UseGuards,
  Logger,
  Query,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ExpenseActorContext, ExpenseService } from './expense.service'
import { CreateExpenseDto } from './dto/create-expense.dto'
import { UpdateExpenseDto } from './dto/update-expense.dto'
import { ApprovalDto } from './dto/approval.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorador'
import { ROLES } from '../auth/enums/roles.enum'
import { AuditLogService } from '../audit-log/audit-log.service'

@Controller('expense')
export class ExpenseController {
  private readonly logger = new Logger(ExpenseController.name)

  constructor(
    private readonly expenseService: ExpenseService,
    private readonly auditLogService: AuditLogService
  ) {}

  private toActorContext(user: {
    _id?: string
    roles?: string[]
    clientId?: string
  }): ExpenseActorContext {
    return {
      userId: String(user?._id ?? ''),
      roleName: user?.roles?.[0] ?? '',
      clientId: user?.clientId,
    }
  }

  @Post('analyze-image')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async analyzeImage(@Body() body: CreateExpenseDto, @Request() req) {
    const clientId = body.clientId || req.user?.clientId
    if (!clientId) {
      throw new Error('No se pudo obtener la empresa del usuario ni del body')
    }
    body.clientId = clientId
    body.userId = req.user?.sub || req.user?._id || body.userId
    const result = await this.expenseService.analyzeImageWithUrl(body)
    this.auditLogService.log({
      userId: req.user?._id || req.user?.sub,
      userName: req.user?.name || req.user?.email || 'Usuario',
      action: 'create_invoice',
      module: 'facturas',
      entityId: (result as any)?._id?.toString(),
      clientId,
    })
    return result
  }

  @Post('analize-pdf')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(FileInterceptor('file'))
  async analyzePdf(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateExpenseDto,
    @Request() req
  ) {
    const clientId = body.clientId || req.user?.clientId
    if (!clientId) {
      throw new Error('No se pudo obtener la empresa del usuario ni del body')
    }
    body.clientId = clientId
    body.userId = req.user?.sub || req.user?._id || body.userId
    const result = await this.expenseService.analyzePdf(body, file)
    this.auditLogService.log({
      userId: req.user?._id || req.user?.sub,
      userName: req.user?.name || req.user?.email || 'Usuario',
      action: 'create_invoice',
      module: 'facturas',
      entityId: (result as any)?._id?.toString(),
      clientId,
    })
    return result
  }

  @Post('mobility-sheet')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async createMobilitySheet(@Body() body: CreateExpenseDto, @Request() req) {
    const clientId = body.clientId || req.user?.clientId
    if (!clientId)
      throw new Error('No se pudo obtener la empresa del usuario ni del body')
    body.clientId = clientId
    body.userId = req.user?.sub || req.user?._id || body.userId
    const result = await this.expenseService.createMobilitySheet(body)
    this.auditLogService.log({
      userId: req.user?._id || req.user?.sub,
      userName: req.user?.name || req.user?.email || 'Usuario',
      action: 'create_mobility_sheet',
      module: 'facturas',
      entityId: (result as any)?._id?.toString(),
      clientId,
    })
    return result
  }

  @Post('other-expense')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async createOtherExpense(@Body() body: CreateExpenseDto, @Request() req) {
    const clientId = body.clientId || req.user?.clientId
    if (!clientId)
      throw new Error('No se pudo obtener la empresa del usuario ni del body')
    body.clientId = clientId
    body.userId = req.user?.sub || req.user?._id || body.userId
    const result = await this.expenseService.createOtherExpense(body)
    this.auditLogService.log({
      userId: req.user?._id || req.user?.sub,
      userName: req.user?.name || req.user?.email || 'Usuario',
      action: 'create_other_expense',
      module: 'facturas',
      entityId: (result as any)?._id?.toString(),
      clientId,
    })
    return result
  }

  @Post('cash-receipt')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async createCashReceipt(@Body() body: CreateExpenseDto, @Request() req) {
    const clientId = body.clientId || req.user?.clientId
    if (!clientId)
      throw new Error('No se pudo obtener la empresa del usuario ni del body')
    body.clientId = clientId
    body.userId = req.user?.sub || req.user?._id || body.userId
    const result = await this.expenseService.createCashReceiptExpense(body)
    this.auditLogService.log({
      userId: req.user?._id || req.user?.sub,
      userName: req.user?.name || req.user?.email || 'Usuario',
      action: 'create_other_expense',
      module: 'facturas',
      entityId: (result as any)?._id?.toString(),
      clientId,
    })
    return result
  }

  @Post('cash-voucher')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async createCashVoucher(@Body() body: CreateExpenseDto, @Request() req) {
    const clientId = body.clientId || req.user?.clientId
    if (!clientId)
      throw new Error('No se pudo obtener la empresa del usuario ni del body')
    body.clientId = clientId
    body.userId = req.user?.sub || req.user?._id || body.userId
    const result = await this.expenseService.createCashVoucherExpense(body)
    this.auditLogService.log({
      userId: req.user?._id || req.user?.sub,
      userName: req.user?.name || req.user?.email || 'Usuario',
      action: 'create_other_expense',
      module: 'facturas',
      entityId: (result as any)?._id?.toString(),
      clientId,
    })
    return result
  }

  @Post()
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  create(@Body() createExpenseDto: CreateExpenseDto, @Request() req) {
    const userId = req.user?.sub || req.user?._id || createExpenseDto.userId
    if (userId) {
      createExpenseDto.userId = userId
    }

    return this.expenseService.create(createExpenseDto)
  }

  /** Rutas estáticas antes de `:clientId` para no capturar `invoice` como clientId */
  @Get('ruc-info/:ruc')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async getRucInfo(@Param('ruc') ruc: string, @Request() req: any) {
    const clientId = req.user?.clientId
    return this.expenseService.getRucInfo(ruc, clientId)
  }

  @Get('test-sunat-credentials/:clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async testSunatCredentials(@Param('clientId') clientId: string) {
    try {
      const token = await this.expenseService.generateTokenSunat(clientId)
      return {
        success: true,
        message: 'Credenciales SUNAT funcionando correctamente',
        token: {
          access_token: token.access_token ? 'PRESENTE' : 'AUSENTE',
          // token_type: token.token_type,
          // expires_in: token.expires_in,
        },
      }
    } catch (error) {
      const body = error.response?.data ?? error.response ?? null
      return {
        success: false,
        message: 'Error en credenciales SUNAT',
        sunat_error: body?.sunat_error ?? body?.error ?? null,
        sunat_description: body?.sunat_description ?? body?.error_description ?? null,
        detail: body?.message ?? error.message ?? 'Sin detalles adicionales',
      }
    }
  }

  @Get('invoice/:id/sunat-validation')
  @Roles(
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.COLABORADOR,
    ROLES.CONTABILIDAD
  )
  @UseGuards(JwtAuthGuard, RolesGuard)
  getSunatValidation(
    @Param('id') id: string,
    @Request()
    req: { user: { _id?: string; roles?: string[]; clientId?: string } }
  ) {
    return this.expenseService.getSunatValidationInfoForActor(
      id,
      this.toActorContext(req.user)
    )
  }

  @Get('invoice/:id')
  @Roles(
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.COLABORADOR,
    ROLES.CONTABILIDAD
  )
  @UseGuards(JwtAuthGuard, RolesGuard)
  findOne(
    @Param('id') id: string,
    @Request()
    req: { user: { _id?: string; roles?: string[]; clientId?: string } }
  ) {
    return this.expenseService.findOneForActor(
      id,
      this.toActorContext(req.user)
    )
  }

  @Get('my-direct-expenses')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COLABORADOR, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  getMyDirectExpenses(
    @Request() req: any,
    @Query('tipo') tipo?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user._id || req.user.sub
    const raw = req.user?.clientId
    const clientId = raw && typeof raw === 'object' && '_id' in raw ? String(raw._id) : String(raw ?? '')
    return this.expenseService.findMyDirectExpenses(userId, clientId, {
      tipo, dateFrom, dateTo,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    })
  }

  @Post('my-direct-expenses/submit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.COLABORADOR, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  async submitMyDirectExpenses(
    @Request() req: any,
    @Body() body: { motivo?: string } = {}
  ) {
    const userId = req.user._id || req.user.sub
    const raw = req.user?.clientId
    const clientId = raw && typeof raw === 'object' && '_id' in raw ? String(raw._id) : String(raw ?? '')
    return this.expenseService.submitMyDirectExpenses(userId, clientId, body.motivo)
  }

  @Get('stats')
  @Roles(
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.COLABORADOR,
    ROLES.CONTABILIDAD
  )
  @UseGuards(JwtAuthGuard, RolesGuard)
  getStatusCounts(@Request() req) {
    const clientId = req.user?.clientId
    if (!clientId) return { pending: 0, approved: 0, rejected: 0, total: 0 }
    return this.expenseService.getStatusCounts(clientId)
  }

  @Get(':clientId')
  @Roles(
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.COLABORADOR,
    ROLES.CONTABILIDAD
  )
  @UseGuards(JwtAuthGuard, RolesGuard)
  findAll(
    @Param('clientId') clientId: string,
    @Request() req,
    @Query() query: Record<string, unknown>,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc'
  ) {
    if (sortBy) query.sortBy = sortBy
    if (sortOrder) query.sortOrder = sortOrder

    return this.expenseService.findAll(clientId, query)
  }

  @Patch('invoice/:id')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD, ROLES.COORDINADOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  update(
    @Param('id') id: string,
    @Body() updateExpenseDto: UpdateExpenseDto,
    @Request()
    req: { user: { _id?: string; roles?: string[]; clientId?: string } }
  ) {
    return this.expenseService.update(
      id,
      updateExpenseDto,
      this.toActorContext(req.user)
    )
  }

  @Patch('invoice/:id/approve')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async approveInvoice(
    @Param('id') id: string,
    @Body() approvalDto: ApprovalDto,
    @Request() req
  ) {
    approvalDto.userId = req.user?._id || req.user?.sub
    const result = await this.expenseService.approveInvoice(id, approvalDto)
    this.auditLogService.log({
      userId: req.user?._id || req.user?.sub,
      userName: req.user?.name || req.user?.email || 'Usuario',
      action: 'approve_invoice',
      module: 'facturas',
      entityId: id,
      clientId: req.user?.clientId,
    })
    return result
  }

  @Patch('invoice/:id/reject')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async rejectInvoice(
    @Param('id') id: string,
    @Body() approvalDto: ApprovalDto,
    @Request() req
  ) {
    approvalDto.userId = req.user?._id || req.user?.sub
    const result = await this.expenseService.rejectInvoice(id, approvalDto)
    this.auditLogService.log({
      userId: req.user?._id || req.user?.sub,
      userName: req.user?.name || req.user?.email || 'Usuario',
      action: 'reject_invoice',
      module: 'facturas',
      entityId: id,
      details: approvalDto.reason,
      clientId: req.user?.clientId,
    })
    return result
  }

  @Delete('invoice/:id')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD, ROLES.COORDINADOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async remove(@Param('id') id: string, @Request() req) {
    const result = await this.expenseService.remove(
      id,
      this.toActorContext(req.user)
    )
    this.auditLogService.log({
      userId: req.user?._id || req.user?.sub,
      userName: req.user?.name || req.user?.email || 'Usuario',
      action: 'delete_invoice',
      module: 'facturas',
      entityId: id,
      clientId: req.user?.clientId,
    })
    return result
  }

  // ─── Aprobación dual: Coordinador / Contabilidad ─────────────────────────────

  @Patch('invoice/:id/approve-coord')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COORDINADOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  approveByCoord(
    @Param('id') id: string,
    @Request() req: { user: { _id?: string; roles?: string[]; clientId?: string } }
  ) {
    return this.expenseService.approveByCoord(id, this.toActorContext(req.user))
  }

  @Patch('invoice/:id/reject-coord')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COORDINADOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  rejectByCoord(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Request() req: { user: { _id?: string; roles?: string[]; clientId?: string } }
  ) {
    return this.expenseService.rejectByCoord(id, this.toActorContext(req.user), body.reason)
  }

  @Patch('invoice/:id/approve-cont')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  @UseGuards(JwtAuthGuard, RolesGuard)
  approveByContabilidad(
    @Param('id') id: string,
    @Request() req: { user: { _id?: string; roles?: string[]; clientId?: string } }
  ) {
    return this.expenseService.approveByContabilidad(id, this.toActorContext(req.user))
  }

  @Patch('invoice/:id/reject-cont')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  @UseGuards(JwtAuthGuard, RolesGuard)
  rejectByContabilidad(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Request() req: { user: { _id?: string; roles?: string[]; clientId?: string } }
  ) {
    return this.expenseService.rejectByContabilidad(id, this.toActorContext(req.user), body.reason)
  }

  @Patch('report/:reportId/batch-approve-collab')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  batchApproveByCollaborator(
    @Param('reportId') reportId: string,
    @Request() req: { user: { _id?: string; roles?: string[]; clientId?: string } }
  ) {
    return this.expenseService.batchApproveByCollaborator(reportId, this.toActorContext(req.user))
  }

  @Patch('report/:reportId/batch-approve-coord')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COORDINADOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  batchApproveByCoord(
    @Param('reportId') reportId: string,
    @Request() req: { user: { _id?: string; roles?: string[]; clientId?: string } }
  ) {
    return this.expenseService.batchApproveByCoord(reportId, this.toActorContext(req.user))
  }

  @Post('invoice/:id/validate-sunat')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD, ROLES.COORDINADOR)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async validateWithSunat(
    @Param('id') id: string,
    @Body()
    body: {
      rucEmisor: string
      serie: string
      correlativo: string
      fechaEmision: string
      montoTotal?: number
      clientId?: string
      tipoComprobante?: string
    },
    @Request() req: any
  ) {
    const clientId = body.clientId || req.user?.clientId
    if (!clientId) {
      throw new Error('No se pudo obtener la empresa del usuario ni del body')
    }
    return this.expenseService.validateWithSunatData(
      id,
      body,
      clientId,
      this.toActorContext(req.user)
    )
  }
}
