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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ProjectService } from './project.service'
import { CreateProjectDto } from './dto/create-project.dto'
import { UpdateProjectDto } from './dto/update-project.dto'
import { Roles } from '../auth/decorators/roles.decorador'
import { ROLES } from '../auth/enums/roles.enum'
import { AuthGuard } from '@nestjs/passport'
import { RolesGuard } from '../auth/guards/roles.guard'
import { AuditLogService } from '../audit-log/audit-log.service'
import { CategoryGroupService } from '../category-group/category-group.service'

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
@Controller('project')
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly auditLogService: AuditLogService,
    private readonly categoryGroupService: CategoryGroupService
  ) {}

  @Post()
  async create(
    @Body() createProjectDto: CreateProjectDto,
    @Request() req: any
  ) {
    const result = await this.projectService.create(createProjectDto)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'create_project',
      module: 'proyectos',
      entityId: (result as any)?._id?.toString(),
      details: createProjectDto.name,
      clientId: req.user.clientId,
    })
    return result
  }

  @Post('bulk-import')
  @UseInterceptors(FileInterceptor('file'))
  async bulkImport(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { clientId: string },
    @Request() req: any
  ) {
    if (!file) throw new Error('No se recibió archivo')
    const clientId = body.clientId || req.user?.clientId
    const xlsx = await import('xlsx')
    const wb = xlsx.read(file.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows: any[] = xlsx.utils.sheet_to_json(ws)
    const result = await this.projectService.bulkImport(rows, clientId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'bulk_import_projects',
      module: 'proyectos',
      details: `Creados: ${result.created}, Omitidos: ${result.skipped.length}, Errores: ${result.errors.length}`,
      clientId,
    })
    return result
  }

  @Get('bulk-import/template')
  async downloadTemplate() {
    const xlsx = await import('xlsx')
    const ws = xlsx.utils.aoa_to_sheet([
      ['Código', 'Nombre Proyecto', 'Nombre Cliente'],
    ])
    const wb = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(wb, ws, 'Proyectos')
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' })
    return {
      file: buffer.toString('base64'),
      filename: 'plantilla_proyectos.xlsx',
    }
  }

  @Get(':clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  async findAll(
    @Param('clientId') clientId: string,
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string
  ) {
    // El colaborador solo ve los centros de costo de sus perfiles efectivos.
    const roles: string[] = req?.user?.roles ?? []
    const isColaborador =
      roles.includes(ROLES.COLABORADOR) &&
      !roles.includes(ROLES.ADMIN) &&
      !roles.includes(ROLES.SUPER_ADMIN) &&
      !roles.includes(ROLES.CONTABILIDAD)

    let categoryGroupIds: string[] | undefined
    if (isColaborador) {
      // El perfil se deriva de las categorías asignadas al usuario (perfil = referencia).
      const categorias: string[] = req?.user?.permissions?.categoryIds ?? []
      const perfiles = categorias.length
        ? await this.categoryGroupService
            .findIdsContainingAnyCategory(categorias, clientId)
            .catch(() => [])
        : []
      // Solo filtra si hay perfiles derivados; si no, conserva el comportamiento previo (todos).
      categoryGroupIds = perfiles.length ? perfiles : undefined
    }

    return this.projectService.findAll(clientId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      isActive: isActive === undefined ? undefined : isActive !== 'false',
      categoryGroupIds,
    })
  }

  @Get(':id/:clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  findOne(@Param('id') id: string, @Param('clientId') clientId: string) {
    return this.projectService.findOne(id, clientId)
  }

  @Patch(':id/:clientId')
  async update(
    @Param('id') id: string,
    @Param('clientId') clientId: string,
    @Body() updateProjectDto: UpdateProjectDto,
    @Request() req: any
  ) {
    const before = await this.projectService
      .findOne(id, clientId)
      .catch(() => null)
    const result = await this.projectService.update(
      id,
      updateProjectDto,
      clientId
    )
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'update_project',
      module: 'proyectos',
      entityId: id,
      details: JSON.stringify({ before, after: updateProjectDto }),
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
    const result = await this.projectService.remove(id, clientId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'delete_project',
      module: 'proyectos',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }
}
