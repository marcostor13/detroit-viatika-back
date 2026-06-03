import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common'
import { CategoryGroupService } from './category-group.service'
import { CreateCategoryGroupDto } from './dto/create-category-group.dto'
import { UpdateCategoryGroupDto } from './dto/update-category-group.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { ROLES } from '../auth/enums/roles.enum'
import { Roles } from '../auth/decorators/roles.decorador'
import { AuthGuard } from '@nestjs/passport'
import { AuditLogService } from '../audit-log/audit-log.service'

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('category-group')
export class CategoryGroupController {
  constructor(
    private readonly groupService: CategoryGroupService,
    private readonly auditLogService: AuditLogService
  ) {}

  @Post()
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async create(@Body() dto: CreateCategoryGroupDto, @Request() req: any) {
    const result = await this.groupService.create(dto)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'create_category_group',
      module: 'categorias',
      entityId: (result as any)?._id?.toString(),
      details: dto.name,
      clientId: req.user.clientId,
    })
    return result
  }

  @Get(':clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  findAll(@Param('clientId') clientId: string) {
    return this.groupService.findAll(clientId)
  }

  @Patch(':id/:clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async update(
    @Param('id') id: string,
    @Param('clientId') clientId: string,
    @Body() dto: UpdateCategoryGroupDto,
    @Request() req: any
  ) {
    const result = await this.groupService.update(id, dto, clientId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'update_category_group',
      module: 'categorias',
      entityId: id,
      details: dto.name || id,
      clientId: req.user.clientId,
    })
    return result
  }

  @Delete(':id/:clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async remove(
    @Param('id') id: string,
    @Param('clientId') clientId: string,
    @Request() req: any
  ) {
    const result = await this.groupService.remove(id, clientId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'delete_category_group',
      module: 'categorias',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }
}
