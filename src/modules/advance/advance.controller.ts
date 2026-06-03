import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Request,
  UseGuards,
  Query,
  ForbiddenException,
} from '@nestjs/common'
import { AdvanceService } from './advance.service'
import { CreateAdvanceDto } from './dto/create-advance.dto'
import { ApproveAdvanceDto, RejectAdvanceDto } from './dto/approve-advance.dto'
import { ResubmitAdvanceDto } from './dto/resubmit-advance.dto'
import { PayAdvanceDto } from './dto/pay-advance.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorador'
import { ROLES } from '../auth/enums/roles.enum'
import { AuditLogService } from '../audit-log/audit-log.service'

@Controller('advance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdvanceController {
  constructor(
    private readonly advanceService: AdvanceService,
    private readonly auditLogService: AuditLogService
  ) {}

  /** Colaborador solicita un anticipo */
  @Post()
  @Roles(ROLES.COLABORADOR, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  create(@Body() dto: CreateAdvanceDto, @Request() req) {
    dto.userId = req.user?.sub || req.user?._id
    dto.clientId = dto.clientId || req.user?.clientId
    return this.advanceService.create(dto)
  }

  /** Mis anticipos (colaborador) */
  @Get('my/:userId/client/:clientId')
  @Roles(ROLES.COLABORADOR, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  findMy(@Param('userId') userId: string, @Param('clientId') clientId: string) {
    return this.advanceService.findMyAdvances(userId, clientId)
  }

  /** Todos los anticipos del cliente (Admin/Tesorero) */
  @Get('client/:clientId')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  findAll(@Param('clientId') clientId: string) {
    return this.advanceService.findAllByClient(clientId)
  }

  /** Página Viáticos: listado con filtros — Admin ve todos, coordinador ve solo los suyos */
  @Get('viaticos/list')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  findForViaticosPage(
    @Request() req,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string
  ) {
    const userRole = req.user?.roles?.[0] || req.user?.role
    const isAdminRole = [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(userRole)
    const canApproveL1 = req.user?.permissions?.canApproveL1 === true
    const hasViaticosModule = req.user?.permissions?.modules?.includes('viaticos') === true

    if (!isAdminRole && !canApproveL1 && !hasViaticosModule) {
      throw new ForbiddenException('Sin permiso para acceder a la gestión de viáticos')
    }

    const rawClient = req.user?.clientId
    const clientId =
      rawClient?._id?.toString?.() ??
      rawClient?.toString?.() ??
      String(rawClient ?? '')

    return this.advanceService.findForViaticosPage({
      requesterId: req.user?.sub || req.user?._id,
      requesterRole: userRole,
      requesterPermissions: req.user?.permissions,
      clientId,
      status,
      dateFrom,
      dateTo,
    })
  }

  /** Anticipos pendientes de acción (Admin/Tesorero) */
  @Get('pending/client/:clientId')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  findPending(@Param('clientId') clientId: string) {
    return this.advanceService.findPending(clientId)
  }

  /** Estadísticas para dashboard Tesorería */
  @Get('stats/client/:clientId')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  getStats(@Param('clientId') clientId: string) {
    return this.advanceService.getStats(clientId)
  }

  /** Detalle de un anticipo */
  @Get(':id')
  @Roles(ROLES.COLABORADOR, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  findOne(@Param('id') id: string) {
    return this.advanceService.findOne(id)
  }

  /** Aprobación nivel 1 (Admin/SuperAdmin o usuario con permiso canApproveL1) */
  @Patch(':id/approve-l1')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  async approveL1(
    @Param('id') id: string,
    @Body() dto: ApproveAdvanceDto,
    @Request() req
  ) {
    dto.approvedBy = req.user?.sub || req.user?._id
    const userRole = req.user?.roles?.[0] || req.user?.role
    const result = await this.advanceService.approveL1(
      id,
      dto,
      userRole,
      req.user?.permissions
    )
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'approve_advance_l1',
      module: 'tesoreria',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }

  /** Aprobación nivel 2 (SuperAdmin o usuario con permiso canApproveL2) */
  @Patch(':id/approve-l2')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  async approveL2(
    @Param('id') id: string,
    @Body() dto: ApproveAdvanceDto,
    @Request() req
  ) {
    dto.approvedBy = req.user?.sub || req.user?._id
    const userRole = req.user?.roles?.[0] || req.user?.role
    const result = await this.advanceService.approveL2(
      id,
      dto,
      userRole,
      req.user?.permissions
    )
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'approve_advance_l2',
      module: 'tesoreria',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }

  /** Rechazo (Admin/SuperAdmin o usuario con permiso de aprobación) */
  @Patch(':id/reject')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectAdvanceDto,
    @Request() req
  ) {
    dto.rejectedBy = req.user?.sub || req.user?._id
    const userRole = req.user?.roles?.[0] || req.user?.role
    const result = await this.advanceService.reject(
      id,
      dto,
      userRole,
      req.user?.permissions
    )
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'reject_advance',
      module: 'tesoreria',
      entityId: id,
      details: dto.rejectionReason,
      clientId: req.user.clientId,
    })
    return result
  }

  /** Reenvío tras rechazo — solo el colaborador dueño (Fase 3). */
  @Patch(':id/resubmit')
  @Roles(ROLES.COLABORADOR, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  async resubmit(
    @Param('id') id: string,
    @Body() dto: ResubmitAdvanceDto,
    @Request() req
  ) {
    const userId = req.user?.sub || req.user?._id
    const rawClient = req.user?.clientId
    const clientId =
      rawClient?._id?.toString?.() ??
      rawClient?.toString?.() ??
      String(rawClient ?? '')
    const result = await this.advanceService.resubmitRejected(
      id,
      dto,
      userId,
      clientId
    )
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'resubmit_advance',
      module: 'tesoreria',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }

  /** Reenvío manual de correo al coordinador cuando el envío falló. */
  @Patch(':id/resend-coordinator-email')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  async resendCoordinatorEmail(@Param('id') id: string, @Request() req) {
    const rawClient = req.user?.clientId
    const clientId =
      rawClient?._id?.toString?.() ??
      rawClient?.toString?.() ??
      String(rawClient ?? '')

    const result = await this.advanceService.resendCoordinatorNotification(
      id,
      clientId
    )
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'resend_coordinator_notification',
      module: 'tesoreria',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }

  /** Registro de pago / transferencia (SuperAdmin o usuario con canApproveL2) */
  @Patch(':id/register-payment')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  async registerPayment(
    @Param('id') id: string,
    @Body() dto: PayAdvanceDto,
    @Request() req
  ) {
    const userRole = req.user?.roles?.[0] || req.user?.role
    const result = await this.advanceService.registerPayment(
      id,
      dto,
      userRole,
      req.user?.permissions
    )
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'pay_advance',
      module: 'tesoreria',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }

  /** Registrar devolución de saldo */
  @Patch(':id/return')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  registerReturn(
    @Param('id') id: string,
    @Body() body: { returnedAmount: number }
  ) {
    return this.advanceService.registerReturn(id, body.returnedAmount)
  }

  // ─── Fase 7 ────────────────────────────────────────────────────────────

  /** Inicia el sub-flujo de devolución (llamado después de settle con type=devolucion). */
  @Patch(':id/return/initiate')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  initiateReturn(@Param('id') id: string) {
    return this.advanceService.initiateReturnTracking(id)
  }

  /** Colaborador carga comprobante de depósito. */
  @Patch(':id/return/proof')
  @Roles(ROLES.COLABORADOR, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  uploadReturnProof(
    @Param('id') id: string,
    @Body() body: {
      depositDate: string
      amountReturned: number
      bankOrigin: string
      operationNumber: string
      fileUrl: string
      fileKey?: string
      note?: string
    }
  ) {
    return this.advanceService.uploadReturnProof(id, {
      ...body,
      depositDate: new Date(body.depositDate),
    })
  }

  /** Contabilidad valida o rechaza el comprobante. */
  @Patch(':id/return/validate')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  validateReturn(
    @Param('id') id: string,
    @Body() body: { approved: boolean; rejectionReason?: string },
    @Request() req
  ) {
    return this.advanceService.validateReturn(
      id,
      body.approved,
      req.user?._id || req.user?.sub,
      body.rejectionReason
    )
  }

  /** Lista anticipos con devoluciones pendientes (contabilidad). */
  @Get('pending-returns/client/:clientId')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  findPendingReturns(@Param('clientId') clientId: string) {
    return this.advanceService.findPendingReturns(clientId)
  }

  /** Colaborador cancela su solicitud pendiente de aprobación. */
  @Patch(':id/cancel')
  @Roles(ROLES.COLABORADOR, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  async cancelByCollaborator(@Param('id') id: string, @Request() req) {
    const userId = req.user?.sub || req.user?._id
    const result = await this.advanceService.cancelByCollaborator(id, userId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'cancel_advance',
      module: 'tesoreria',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }

}
