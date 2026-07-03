import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Request,
  UseGuards,
} from '@nestjs/common'
import { PettyCashService } from './petty-cash.service'
import { CreatePettyCashDto } from './dto/create-petty-cash.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorador'
import { ROLES } from '../auth/enums/roles.enum'
import { AuditLogService } from '../audit-log/audit-log.service'

@Controller('petty-cash')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PettyCashController {
  constructor(
    private readonly service: PettyCashService,
    private readonly auditLogService: AuditLogService
  ) {}

  @Post()
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  async create(@Body() dto: CreatePettyCashDto, @Request() req: any) {
    dto.clientId = dto.clientId || req.user?.clientId
    const createdBy = req.user._id || req.user.sub
    const result = await this.service.create(dto, String(createdBy))
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'create_petty_cash',
      module: 'caja-chica',
      entityId: String(result._id),
      clientId: req.user.clientId,
    })
    return result
  }

  @Get('client/:clientId')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  findAllByClient(@Param('clientId') clientId: string) {
    return this.service.findAllByClient(clientId)
  }

  @Get('my/client/:clientId')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR)
  findMine(@Param('clientId') clientId: string, @Request() req: any) {
    const responsibleId = req.user._id || req.user.sub
    return this.service.findByResponsible(String(responsibleId), clientId)
  }

  @Get(':id')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  @Patch(':id/register-funding')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  async registerFunding(
    @Param('id') id: string,
    @Body()
    body: {
      transferDate: string
      amount: number
      operationNumber: string
      receiptUrl: string
    },
    @Request() req: any
  ) {
    const registeredBy = req.user._id || req.user.sub
    const result = await this.service.registerFunding(
      id,
      body,
      String(registeredBy)
    )
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'fund_petty_cash',
      module: 'caja-chica',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }

  @Patch(':id/add-expense')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COLABORADOR)
  addExpense(
    @Param('id') id: string,
    @Body() body: { expenseId: string; amount: number; category?: string }
  ) {
    return this.service.addExpense(
      id,
      body.expenseId,
      body.amount,
      body.category
    )
  }

  @Patch(':id/close')
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  async close(@Param('id') id: string, @Request() req: any) {
    const closedBy = req.user._id || req.user.sub
    const result = await this.service.close(id, String(closedBy))
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'close_petty_cash',
      module: 'caja-chica',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }
}
