import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { LineaNegocioService } from './linea-negocio.service'
import { CreateLineaNegocioDto } from './dto/create-linea-negocio.dto'
import { UpdateLineaNegocioDto } from './dto/update-linea-negocio.dto'
import { Roles } from '../auth/decorators/roles.decorador'
import { ROLES } from '../auth/enums/roles.enum'
import { RolesGuard } from '../auth/guards/roles.guard'
import { AuditLogService } from '../audit-log/audit-log.service'

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('linea-negocio')
export class LineaNegocioController {
  constructor(
    private readonly lineaNegocioService: LineaNegocioService,
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
  async create(@Body() dto: CreateLineaNegocioDto, @Request() req: any) {
    const clientId = this.resolveClientId(req, dto.clientId)
    const result = await this.lineaNegocioService.create(dto, clientId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'create_linea_negocio',
      module: 'configuracion',
      entityId: (result as any)?._id?.toString(),
      details: `${dto.name} (${dto.code})`,
      clientId,
    })
    return result
  }

  @Get(':clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  findAll(@Param('clientId') clientId: string) {
    return this.lineaNegocioService.findAll(clientId)
  }

  @Get(':id/:clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  findOne(@Param('id') id: string, @Param('clientId') clientId: string) {
    return this.lineaNegocioService.findOne(id, clientId)
  }

  @Patch(':id')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLineaNegocioDto,
    @Request() req: any
  ) {
    const clientId = this.resolveClientId(req, dto.clientId)
    const result = await this.lineaNegocioService.update(id, dto, clientId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'update_linea_negocio',
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
    const result = await this.lineaNegocioService.remove(id, clientId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'delete_linea_negocio',
      module: 'configuracion',
      entityId: id,
      clientId,
    })
    return result
  }
}
