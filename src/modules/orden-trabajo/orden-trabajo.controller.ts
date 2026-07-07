import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { OrdenTrabajoService } from './orden-trabajo.service'
import { CreateOrdenTrabajoDto } from './dto/create-orden-trabajo.dto'
import { UpdateOrdenTrabajoDto } from './dto/update-orden-trabajo.dto'
import { Roles } from '../auth/decorators/roles.decorador'
import { ROLES } from '../auth/enums/roles.enum'
import { RolesGuard } from '../auth/guards/roles.guard'
import { AuditLogService } from '../audit-log/audit-log.service'

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('orden-trabajo')
export class OrdenTrabajoController {
  constructor(
    private readonly ordenTrabajoService: OrdenTrabajoService,
    private readonly auditLogService: AuditLogService
  ) {}

  private resolveClientId(req: any, fallback?: string): string {
    const raw = req?.user?.clientId
    const fromUser =
      raw && typeof raw === 'object' && '_id' in raw ? String(raw._id) : raw
    const clientId = fromUser || fallback
    if (!clientId) {
      throw new Error('No se pudo determinar la empresa del usuario')
    }
    return String(clientId)
  }

  @Post()
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  async create(@Body() dto: CreateOrdenTrabajoDto, @Request() req: any) {
    const clientId = this.resolveClientId(req, dto.clientId)
    const result = await this.ordenTrabajoService.create(dto, clientId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'create_orden_trabajo',
      module: 'configuracion',
      entityId: (result as any)?._id?.toString(),
      details: `${(result as any).nombre}`,
      clientId,
    })
    return result
  }

  @Get(':clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  findAll(
    @Param('clientId') clientId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('costCenterId') costCenterId?: string
  ) {
    return this.ordenTrabajoService.findAll(clientId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search,
      costCenterId,
    })
  }

  @Get(':id/:clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  findOne(@Param('id') id: string, @Param('clientId') clientId: string) {
    return this.ordenTrabajoService.findOne(id, clientId)
  }

  @Patch(':id')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrdenTrabajoDto,
    @Request() req: any
  ) {
    const clientId = this.resolveClientId(req)
    const result = await this.ordenTrabajoService.update(id, dto, clientId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'update_orden_trabajo',
      module: 'configuracion',
      entityId: id,
      details: JSON.stringify(dto),
      clientId,
    })
    return result
  }

  @Delete(':id')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  async remove(@Param('id') id: string, @Request() req: any) {
    const clientId = this.resolveClientId(req)
    const result = await this.ordenTrabajoService.remove(id, clientId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'delete_orden_trabajo',
      module: 'configuracion',
      entityId: id,
      details: `${(result as any)?.nombre ?? ''}`,
      clientId,
    })
    return result
  }
}
