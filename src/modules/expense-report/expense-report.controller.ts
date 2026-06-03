import {
  Controller,
  ForbiddenException,
  BadRequestException,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common'
import { Types } from 'mongoose'
import { ExpenseReportService } from './expense-report.service'
import { CreateExpenseReportDto } from './dto/create-expense-report.dto'
import { UpdateExpenseReportDto } from './dto/update-expense-report.dto'
import { CreateAffidavitDto } from './dto/create-affidavit.dto'
import { AuthGuard } from '@nestjs/passport'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorador'
import { ROLES } from '../auth/enums/roles.enum'
import { AuditLogService } from '../audit-log/audit-log.service'
import { RegisterReimbursementPaymentDto } from './dto/register-reimbursement-payment.dto'

@Controller('expense-report')
export class ExpenseReportController {
  constructor(
    private readonly expenseReportService: ExpenseReportService,
    private readonly auditLogService: AuditLogService
  ) {}

  /** Cliente activo del JWT (ObjectId string); vacío si sesión sin cliente (ej. super sin tenant). */
  private resolveClientId(req: any): string {
    const raw = req?.user?.clientId
    if (raw && typeof raw === 'object' && '_id' in raw) {
      return String((raw as { _id: unknown })._id)
    }
    return raw != null && raw !== '' ? String(raw) : ''
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR)
  @Post()
  async create(
    @Body() createExpenseReportDto: CreateExpenseReportDto,
    @Request() req: any
  ) {
    const createdBy = req.user._id
    const isCollaborator = req.user.roles?.includes(ROLES.COLABORADOR)

    // Rendición directa: requiere permiso 'nueva-rendicion' si quien crea es colaborador
    if (createExpenseReportDto.isDirecta && isCollaborator) {
      const hasPermission = req.user.permissions?.modules?.includes('nueva-rendicion')
      if (!hasPermission) {
        throw new ForbiddenException(
          'No tienes permiso para crear rendiciones directas.'
        )
      }
    }

    const result = await this.expenseReportService.create(
      createExpenseReportDto,
      createdBy,
      isCollaborator
    )
    await this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email || 'Usuario',
      action: 'create_rendicion',
      module: 'rendiciones',
      entityId: result?._id?.toString(),
      details: result.title,
      clientId: req.user.clientId,
    })
    return result
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('directas/expenses/:clientId')
  findDirectRendicionExpenses(
    @Param('clientId') clientId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('projectId') projectId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('docNumber') docNumber?: string,
    @Query('tipo') tipo?: string,
  ) {
    return this.expenseReportService.findDirectRendicionExpenses(clientId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      dateFrom,
      dateTo,
      projectId,
      categoryId,
      docNumber,
      tipo,
    })
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('client/:clientId')
  findAllByClient(@Param('clientId') clientId: string, @Request() req: any) {
    const role = req.user.roles[0]
    const hasRendicionesPermission = req.user.permissions?.modules?.includes('rendiciones')
    const isRestrictedUser = role === ROLES.COLABORADOR && !hasRendicionesPermission
    if (isRestrictedUser) {
      return this.expenseReportService.findAllByUser(req.user._id, clientId)
    }
    return this.expenseReportService.findAllByClient(clientId)
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('user/:userId/client/:clientId')
  findAllByUser(
    @Param('userId') userId: string,
    @Param('clientId') clientId: string
  ) {
    return this.expenseReportService.findAllByUser(userId, clientId)
  }

  /** Fase 6 — Tesorería: rendiciones aprobadas con reembolso pendiente de comprobante */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  @Get('pending-reimbursements/client/:clientId')
  findPendingReimbursements(
    @Param('clientId') clientId: string,
    @Request() req: any
  ) {
    const role = req.user?.roles?.[0] || req.user?.role
    const canPay =
      [ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD].includes(role) ||
      req.user?.permissions?.canApproveL2 === true
    if (!canPay) {
      throw new ForbiddenException(
        'No tienes permiso para consultar reembolsos pendientes.'
      )
    }
    const isSuperAdmin = role === ROLES.SUPER_ADMIN
    const mine = this.resolveClientId(req)
    if (!isSuperAdmin) {
      if (!mine || mine !== clientId) {
        throw new ForbiddenException(
          'No puedes consultar reembolsos de otro cliente.'
        )
      }
    }
    return this.expenseReportService.findPendingReimbursementsByClient(clientId)
  }

  /** Fase 6 — Colaborador: comprobantes de viático pagado y de reembolso */
  @UseGuards(AuthGuard('jwt'))
  @Get('documents/my')
  findMyDocuments(@Request() req: any) {
    const userId = req.user._id || req.user.sub
    const clientId = this.resolveClientId(req)
    if (!Types.ObjectId.isValid(clientId)) {
      throw new BadRequestException(
        'Cliente no identificado en la sesión; no se pueden listar documentos.'
      )
    }
    return this.expenseReportService.findMyDocuments(String(userId), clientId)
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id/expenses')
  findExpensesPaginated(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('search') search?: string
  ) {
    return this.expenseReportService.findExpensesPaginated(id, {
      page: page ? Math.max(1, parseInt(page, 10)) : 1,
      limit: limit ? Math.min(50, Math.max(1, parseInt(limit, 10))) : 10,
      type,
      status,
      search,
    })
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.expenseReportService.findOne(id)
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR, ROLES.COORDINADOR, ROLES.CONTABILIDAD)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateExpenseReportDto: UpdateExpenseReportDto,
    @Request() req: any
  ) {
    const status = updateExpenseReportDto.status
    const role = req.user?.roles?.[0]
    const isCollaborator = role === ROLES.COLABORADOR
    const isContabilidad = role === ROLES.CONTABILIDAD
    const isAdminOrSuperAdmin =
      role === ROLES.ADMIN || role === ROLES.SUPER_ADMIN ||
      (role === ROLES.COORDINADOR && req.user?.permissions?.modules?.includes('rendiciones'))

    if (
      isCollaborator &&
      (status === 'open' ||
        status === 'pending_accounting' ||
        status === 'approved' ||
        status === 'rejected' ||
        status === 'closed' ||
        status === 'reimbursed')
    ) {
      throw new ForbiddenException(
        'No tienes permisos para aprobar/rechazar rendiciones.'
      )
    }

    if (
      (status === 'open' ||
        status === 'closed' ||
        status === 'reimbursed') &&
      !isAdminOrSuperAdmin
    ) {
      throw new ForbiddenException(
        'Solo un aprobador puede cambiar a este estado.'
      )
    }

    // Solo coordinador/admin puede enviar a contabilidad (paso 1)
    if (status === 'pending_accounting' && !isAdminOrSuperAdmin) {
      throw new ForbiddenException(
        'Solo el coordinador o administrador puede aprobar esta etapa de la rendicion.'
      )
    }

    // Solo contabilidad/admin/superadmin puede hacer la aprobacion final (paso 2)
    if (status === 'approved' && !isAdminOrSuperAdmin && !isContabilidad) {
      throw new ForbiddenException(
        'Solo contabilidad puede realizar la aprobacion final de la rendicion.'
      )
    }

    // Registrar quién aprobó en cada paso
    if (
      updateExpenseReportDto.status === 'open' ||
      updateExpenseReportDto.status === 'pending_accounting' ||
      updateExpenseReportDto.status === 'approved'
    ) {
      await this.expenseReportService.setApprovedBy(id, req.user._id)
    }
    // Guardar timestamps de aprobación por rol
    if (updateExpenseReportDto.status === 'pending_accounting') {
      await this.expenseReportService.setCoordinatorApproval(id, req.user._id)
    }
    if (updateExpenseReportDto.status === 'approved') {
      await this.expenseReportService.setContabilidadApproval(id, req.user._id)
    }
    const result = await this.expenseReportService.update(
      id,
      updateExpenseReportDto
    )
    if (updateExpenseReportDto.status) {
      await this.auditLogService.log({
        userId: req.user._id || req.user.sub,
        userName: req.user.name || req.user.email || 'Usuario',
        action: 'update_rendicion_status',
        module: 'rendiciones',
        entityId: id,
        details: updateExpenseReportDto.status,
        clientId: req.user.clientId,
      })
    }
    return result
  }

  /** Fase 6 — Registro de pago de reembolso (contabilidad / tesorería con canApproveL2) */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  @Patch(':id/register-reimbursement-payment')
  async registerReimbursementPayment(
    @Param('id') id: string,
    @Body() dto: RegisterReimbursementPaymentDto,
    @Request() req: any
  ) {
    const userRole = req.user?.roles?.[0] || req.user?.role
    const result = await this.expenseReportService.registerReimbursementPayment(
      id,
      dto,
      userRole,
      req.user?.permissions,
      {
        requestClientId: this.resolveClientId(req),
        isSuperAdmin: userRole === ROLES.SUPER_ADMIN,
      }
    )
    await this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email || 'Usuario',
      action: 'register_reimbursement_payment',
      module: 'rendiciones',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }

  /** Cancela una rendición en estado 'solicited' (colaborador propietario). */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR)
  @Patch(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Request() req: any
  ) {
    const result = await this.expenseReportService.cancel(
      id,
      req.user._id,
      body.reason
    )
    await this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email || 'Usuario',
      action: 'cancel_rendicion',
      module: 'rendiciones',
      entityId: id,
      details: body.reason,
      clientId: req.user.clientId,
    })
    return result
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: any) {
    const result = await this.expenseReportService.remove(id)
    await this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email || 'Usuario',
      action: 'delete_rendicion',
      module: 'rendiciones',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }

  // ─── Fase 8 — Cierre Definitivo ────────────────────────────────────────────

  /** Valida condiciones de cierre sin cerrar. */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  @Get(':id/close/validate')
  validateClosure(@Param('id') id: string) {
    return this.expenseReportService.validateClosureConditions(id)
  }

  /** Cierra definitivamente la rendición. */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  @Patch(':id/close')
  async close(@Param('id') id: string, @Request() req: any) {
    const closedBy = req.user._id || req.user.sub
    const result = await this.expenseReportService.close(id, String(closedBy))
    await this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email || 'Usuario',
      action: 'close_rendicion',
      module: 'rendiciones',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }

  /** Contabilidad reabre directamente con motivo. */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  @Patch(':id/reopen')
  async reopen(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Request() req: any
  ) {
    const reopenedBy = String(req.user._id || req.user.sub)
    const result = await this.expenseReportService.reopen(id, reopenedBy, body.reason)
    await this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email || 'Usuario',
      action: 'reopen_rendicion',
      module: 'rendiciones',
      entityId: id,
      details: body.reason?.slice(0, 200),
      clientId: req.user.clientId,
    })
    return result
  }

  /** Solicita reapertura de una rendición cerrada. */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  @Post(':id/reopen-request')
  async requestReopening(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Request() req: any
  ) {
    const requestedBy = req.user._id || req.user.sub
    return this.expenseReportService.requestReopening(id, String(requestedBy), body.reason)
  }

  /** Aprueba o rechaza la reapertura (SuperAdmin/Contabilidad). */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  @Patch(':id/reopen-approve')
  async approveReopening(
    @Param('id') id: string,
    @Body() body: { approve: boolean },
    @Request() req: any
  ) {
    const approvedBy = req.user._id || req.user.sub
    const result = await this.expenseReportService.approveReopening(id, String(approvedBy), body.approve)
    await this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email || 'Usuario',
      action: body.approve ? 'approve_reopen_rendicion' : 'reject_reopen_rendicion',
      module: 'rendiciones',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }

  /** Colaborador adjunta comprobante de devolución (rendición cerrada, settlement=devolucion). */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.COLABORADOR, ROLES.ADMIN, ROLES.SUPER_ADMIN)
  @Post(':id/return-voucher')
  async registerReturnVoucher(
    @Param('id') id: string,
    @Body() body: { depositDate: string; bankOrigin?: string; operationNumber?: string; fileUrl: string; fileName?: string },
    @Request() req: any
  ) {
    const userId = String(req.user._id || req.user.sub)
    return this.expenseReportService.registerReturnVoucher(id, body, userId)
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  @Post(':id/affidavit')
  async createAffidavit(
    @Param('id') id: string,
    @Body() dto: CreateAffidavitDto,
    @Request() req: any
  ) {
    const result = await this.expenseReportService.registerAffidavit(
      id,
      dto,
      req.user._id || req.user.sub
    )
    await this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email || 'Usuario',
      action: 'generate_affidavit',
      module: 'rendiciones',
      entityId: id,
      details: JSON.stringify({
        type: dto.type,
        expenseIds: dto.expenseIds,
      }),
      clientId: req.user.clientId,
    })
    return result
  }
}
