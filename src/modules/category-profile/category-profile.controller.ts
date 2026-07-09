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
import { CategoryProfileService } from './category-profile.service'
import { CreateCategoryProfileDto } from './dto/create-category-profile.dto'
import { UpdateCategoryProfileDto } from './dto/update-category-profile.dto'
import { RolesGuard } from '../auth/guards/roles.guard'
import { ROLES } from '../auth/enums/roles.enum'
import { Roles } from '../auth/decorators/roles.decorador'
import { AuditLogService } from '../audit-log/audit-log.service'

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
@Controller('category-profile')
export class CategoryProfileController {
  constructor(
    private readonly profileService: CategoryProfileService,
    private readonly auditLogService: AuditLogService
  ) {}

  @Post()
  async create(
    @Body() dto: CreateCategoryProfileDto,
    @Request() req: any
  ) {
    const result = await this.profileService.create(dto)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'create_category_group',
      module: 'categorias',
      entityId: String(result._id),
      clientId: req.user.clientId,
    })
    return result
  }

  @Get(':clientId')
  findAll(@Param('clientId') clientId: string) {
    return this.profileService.findAllByClient(clientId)
  }

  @Patch(':id/:clientId')
  async update(
    @Param('id') id: string,
    @Param('clientId') clientId: string,
    @Body() dto: UpdateCategoryProfileDto,
    @Request() req: any
  ) {
    const result = await this.profileService.update(id, dto, clientId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'update_category_group',
      module: 'categorias',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }

  @Delete(':id/:clientId')
  async remove(
    @Param('id') id: string,
    @Param('clientId') clientId: string,
    @Request() req: any
  ) {
    await this.profileService.remove(id, clientId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'delete_category_group',
      module: 'categorias',
      entityId: id,
      clientId: req.user.clientId,
    })
    return { success: true }
  }
}
