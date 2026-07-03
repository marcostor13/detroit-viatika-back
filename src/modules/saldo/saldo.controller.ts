import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common'
import { Types } from 'mongoose'
import { AuthGuard } from '@nestjs/passport'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorador'
import { ROLES } from '../auth/enums/roles.enum'
import { SaldoService } from './saldo.service'
import { CreatePagoSaldoDto } from './dto/create-pago-saldo.dto'
import { SaldoContext } from './entities/saldo.entity'
import { AuditLogService } from '../audit-log/audit-log.service'

@Controller('saldo')
export class SaldoController {
  constructor(
    private readonly saldoService: SaldoService,
    private readonly auditLogService: AuditLogService
  ) {}

  /** Cliente activo del JWT (ObjectId string); vacío si sesión sin cliente. */
  private resolveClientId(req: any): string {
    const raw = req?.user?.clientId
    if (raw && typeof raw === 'object' && '_id' in raw) {
      return String((raw as { _id: unknown })._id)
    }
    return raw != null && raw !== '' ? String(raw) : ''
  }

  /** Contabilidad registra un pago directo → crea un saldo tipo `pago`. */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.CONTABILIDAD, ROLES.SUPER_ADMIN)
  @Post('pago')
  async createPago(@Body() dto: CreatePagoSaldoDto, @Request() req: any) {
    const createdBy = req.user._id || req.user.sub
    const clientId = this.resolveClientId(req)
    if (!Types.ObjectId.isValid(clientId)) {
      throw new BadRequestException(
        'Cliente no identificado en la sesión; no se puede registrar el pago.'
      )
    }
    const result = await this.saldoService.createFromPago(
      dto,
      String(createdBy),
      clientId
    )
    await this.auditLogService.log({
      userId: String(createdBy),
      userName: req.user.name || req.user.email || 'Usuario',
      action: 'create_saldo_pago',
      module: 'saldo',
      entityId: result?._id?.toString(),
      details: `Pago directo S/ ${dto.amount}`,
      clientId: req.user.clientId,
    })
    return result
  }

  /** Saldos disponibles del colaborador autenticado (página Saldo). */
  @UseGuards(AuthGuard('jwt'))
  @Get('mine')
  findMine(@Request() req: any) {
    const userId = String(req.user._id || req.user.sub)
    const clientId = this.resolveClientId(req)
    return this.saldoService.findAvailableByUser(userId, clientId)
  }

  /** Total de saldo disponible del colaborador autenticado (header). */
  @UseGuards(AuthGuard('jwt'))
  @Get('total')
  async getTotal(@Request() req: any) {
    const userId = String(req.user._id || req.user.sub)
    const clientId = this.resolveClientId(req)
    const total = await this.saldoService.getTotalByUser(userId, clientId)
    return { total }
  }

  /** Saldos elegibles según el contexto (rendicion_directa | viatico). */
  @UseGuards(AuthGuard('jwt'))
  @Get('eligible')
  findEligible(
    @Request() req: any,
    @Query('context') context: SaldoContext,
    @Query('projectId') projectId?: string
  ) {
    const userId = String(req.user._id || req.user.sub)
    const clientId = this.resolveClientId(req)
    return this.saldoService.findEligible(userId, clientId, context, projectId)
  }
}
