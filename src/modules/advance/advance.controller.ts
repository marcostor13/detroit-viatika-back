import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { AdvanceService } from './advance.service'
import { PaymentBatchService, PaymentKind } from './payment/payment-batch.service'
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
    private readonly paymentBatchService: PaymentBatchService,
    private readonly auditLogService: AuditLogService
  ) {}

  // ─── Pagos por lote BBVA (VD-7) ──────────────────────────────────────────

  /**
   * Genera el archivo TXT de pagos masivos BBVA con TODOS los pendientes
   * (anticipos + viáticos + reembolsos) que tengan datos bancarios válidos.
   * Devuelve el archivo Latin-1 en base64 + los excluidos por datos incompletos.
   */
  @Get('payments/txt/client/:clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD, ROLES.TESORERIA)
  async generatePaymentsTxt(
    @Param('clientId') clientId: string,
    @Request() req
  ) {
    const result = await this.paymentBatchService.generateTxt(clientId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'generate_payments_txt',
      module: 'tesoreria',
      details: `${result.count} pagos · S/ ${result.totalSoles.toFixed(2)}`,
      clientId: req.user.clientId,
    })
    return result
  }

  /**
   * Concilia el PDF "Consulta de Pagos Masivos" de BBVA: por cada abono exitoso
   * cruza titular + DNI + monto contra los pagos pendientes y los marca pagados.
   */
  @Post('payments/reconcile/client/:clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD, ROLES.TESORERIA)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    })
  )
  async reconcilePayments(
    @Param('clientId') clientId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Debes adjuntar el PDF de BBVA.')
    }
    const actor = {
      role: req.user?.roles?.[0] || req.user?.role,
      permissions: req.user?.permissions,
    }
    const result = await this.paymentBatchService.reconcileFromPdf(
      clientId,
      file.buffer,
      actor
    )
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'reconcile_payments',
      module: 'tesoreria',
      details: `conciliados: ${result.conciliados.length}, sin conciliar: ${result.sinConciliar.length}`,
      clientId: req.user.clientId,
    })
    return result
  }

  /**
   * PRUEBAS: simula el PDF de "Consulta de Pagos Masivos" de BBVA y concilia
   * todos los pagos pendientes (los marca como pagados) por el mismo motor que el
   * PDF real, para poder continuar el flujo sin depender del banco.
   */
  @Post('payments/simulate-reconcile/client/:clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD, ROLES.TESORERIA)
  async simulateReconcile(@Param('clientId') clientId: string, @Request() req) {
    const actor = {
      role: req.user?.roles?.[0] || req.user?.role,
      permissions: req.user?.permissions,
    }
    const result = await this.paymentBatchService.simulateReconcile(
      clientId,
      actor
    )
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'simulate_reconcile_payments',
      module: 'tesoreria',
      details: `SIMULADO · conciliados: ${result.conciliados.length}, sin conciliar: ${result.sinConciliar.length}`,
      clientId: req.user.clientId,
    })
    return result
  }

  /** Confirmación manual (fallback): marca como pagados los items indicados. */
  @Post('payments/confirm-manual/client/:clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD, ROLES.TESORERIA)
  async confirmManualPayments(
    @Param('clientId') clientId: string,
    @Body()
    body: {
      items: Array<{ kind: PaymentKind; id: string }>
      operationNumber?: string
      paymentDate?: string
    },
    @Request() req
  ) {
    const actor = {
      role: req.user?.roles?.[0] || req.user?.role,
      permissions: req.user?.permissions,
    }
    const result = await this.paymentBatchService.confirmManual(
      clientId,
      body.items ?? [],
      { operationNumber: body.operationNumber, paymentDate: body.paymentDate },
      actor
    )
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'confirm_manual_payments',
      module: 'tesoreria',
      details: `pagados: ${result.pagados}`,
      clientId: req.user.clientId,
    })
    return result
  }

  /** Mis anticipos (colaborador) */
  @Get('my/:userId/client/:clientId')
  @Roles(
    ROLES.COLABORADOR,
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
    ROLES.CONTABILIDAD,
    ROLES.TESORERIA
  )
  findMy(@Param('userId') userId: string, @Param('clientId') clientId: string) {
    return this.advanceService.findMyAdvances(userId, clientId)
  }

  /** Todos los anticipos del cliente (Admin/Tesorero) */
  @Get('client/:clientId')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD, ROLES.TESORERIA)
  findAll(@Param('clientId') clientId: string) {
    return this.advanceService.findAllByClient(clientId)
  }

  /** Anticipos pendientes de acción (Admin/Tesorero) */
  @Get('pending/client/:clientId')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  findPending(@Param('clientId') clientId: string) {
    return this.advanceService.findPending(clientId)
  }

  /** Estadísticas para dashboard Tesorería */
  @Get('stats/client/:clientId')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD, ROLES.TESORERIA)
  getStats(@Param('clientId') clientId: string) {
    return this.advanceService.getStats(clientId)
  }

  /** Advances sin ExpenseReport vinculado — para vista unificada de rendiciones */
  @Get('orphaned/client/:clientId')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD, ROLES.TESORERIA, ROLES.COORDINADOR, ROLES.COLABORADOR)
  findOrphaned(@Param('clientId') clientId: string, @Request() req) {
    return this.advanceService.findOrphaned(clientId, {
      userId: req.user?.sub || req.user?._id,
      role: req.user?.roles?.[0] || req.user?.role,
    })
  }

  /** Detalle de un anticipo */
  @Get(':id')
  @Roles(ROLES.COLABORADOR, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD, ROLES.TESORERIA)
  findOne(@Param('id') id: string) {
    return this.advanceService.findOne(id)
  }

  /**
   * Aprueba el nivel actual de la cadena de aprobadores. La autorización real
   * la hace `canActOnChain` (¿el actor está en el paso pendiente?, o
   * Superadmin) — no se restringe por @Roles aquí.
   */
  @Patch(':id/approve')
  async approve(
    @Param('id') id: string,
    @Body() dto: ApproveAdvanceDto,
    @Request() req
  ) {
    const actorId = req.user?.sub || req.user?._id
    dto.approvedBy = actorId
    const actorRole = req.user?.roles?.[0] || req.user?.role
    const result = await this.advanceService.approve(id, dto, actorId, actorRole)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'approve_advance',
      module: 'tesoreria',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }

  /** Rechazo (aprobador al que le toca el turno, o Superadmin) — autorización real vía canActOnChain. */
  @Patch(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectAdvanceDto,
    @Request() req
  ) {
    const actorId = req.user?.sub || req.user?._id
    dto.rejectedBy = actorId
    const actorRole = req.user?.roles?.[0] || req.user?.role
    const result = await this.advanceService.reject(id, dto, actorId, actorRole)
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

  /** Registro de pago / transferencia (SuperAdmin, Tesorería o usuario con canApproveL2) */
  @Patch(':id/register-payment')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD, ROLES.TESORERIA)
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
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD, ROLES.TESORERIA)
  registerReturn(
    @Param('id') id: string,
    @Body() body: { returnedAmount: number }
  ) {
    return this.advanceService.registerReturn(id, body.returnedAmount)
  }

  // ─── Fase 7 ────────────────────────────────────────────────────────────

  /** Inicia el sub-flujo de devolución (llamado después de settle con type=devolucion). */
  @Patch(':id/return/initiate')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD, ROLES.TESORERIA)
  initiateReturn(@Param('id') id: string) {
    return this.advanceService.initiateReturnTracking(id)
  }

  /** Colaborador carga comprobante de depósito. */
  @Patch(':id/return/proof')
  @Roles(ROLES.COLABORADOR, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  uploadReturnProof(
    @Param('id') id: string,
    @Body()
    body: {
      depositDate: string
      amountReturned: number
      bankOrigin: string
      operationNumber: string
      fileUrl: string
      fileKey?: string
      note?: string
      scannedAmount?: number
      operationDate?: string
      operationTime?: string
      titular?: string
    }
  ) {
    return this.advanceService.uploadReturnProof(id, {
      ...body,
      depositDate: new Date(body.depositDate),
    })
  }

  /** Contabilidad valida o rechaza el comprobante. */
  @Patch(':id/return/validate')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD, ROLES.TESORERIA)
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
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD, ROLES.TESORERIA)
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

  /**
   * Elimina una solicitud de viáticos. El colaborador propietario puede eliminarla
   * mientras no tenga ninguna aprobación; una vez aprobada por alguien, solo
   * Contabilidad (o Superadmin) puede hacerlo.
   */
  @Delete(':id')
  @Roles(ROLES.COLABORADOR, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CONTABILIDAD)
  async remove(@Param('id') id: string, @Request() req) {
    const result = await this.advanceService.remove(id, {
      userId: req.user._id || req.user.sub,
      role: req.user.roles?.[0],
    })
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'delete_advance',
      module: 'tesoreria',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }
}
