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

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
@Controller('project')
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly auditLogService: AuditLogService
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

  /**
   * ¿El usuario autenticado es aprobador (cualquier nivel) de algún centro de
   * costo de su empresa? Reemplaza el chequeo por rol "Coordinador" en el
   * frontend (sidebar, dashboard, detalle de rendición) — no cubre el
   * anticipo genérico legacy (`Advance.approverIds`), fuera de alcance.
   */
  @Get('me/am-i-approver')
  @Roles(
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.COORDINADOR,
    ROLES.COLABORADOR,
    ROLES.CONTABILIDAD,
    ROLES.TESORERIA
  )
  async amIApprover(@Request() req: any) {
    const userId = req.user._id || req.user.sub
    const rawClient = req.user?.clientId
    const clientId =
      rawClient?._id?.toString?.() ?? rawClient?.toString?.() ?? String(rawClient ?? '')
    const isApprover = await this.projectService.isApproverForClient(userId, clientId)
    return { isApprover }
  }

  @Get('bulk-import/template')
  async downloadTemplate() {
    const xlsx = await import('xlsx')
    const ws = xlsx.utils.aoa_to_sheet([
      [
        'Código',
        'Nombre Proyecto',
        'Nombre Cliente',
        'Línea de Negocio',
        'Cuenta Analítica 9x',
        'Cuenta Destino 6x',
        'Centro de Costo Contanet',
        'Sub Centro de Costo',
        'Área',
        'Es Administrativo',
        'Activo',
        'Aprobador N1',
        'Aprobador N2',
        'Aprobador N3',
      ],
    ])
    const wb = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(wb, ws, 'Proyectos')

    const instrWs = xlsx.utils.aoa_to_sheet([
      ['Campo', 'Requerido', 'Descripción'],
      ['Código', 'No', 'Se genera automáticamente desde el nombre si se deja vacío'],
      ['Nombre Proyecto', 'Sí', 'Nombre del centro de costo'],
      ['Nombre Cliente', 'No', 'Texto libre, solo informativo'],
      ['Línea de Negocio', 'No', 'Debe coincidir con el nombre de una línea de negocio existente en la empresa'],
      ['Cuenta Analítica 9x', 'No', 'Cuenta contable clase 9 (asientos Contanet)'],
      ['Cuenta Destino 6x', 'No', 'Cuenta contable clase 6 destino (asientos Contanet)'],
      ['Centro de Costo Contanet', 'No', 'Código Contanet del centro de costo (col. T), distinto del "Código" del proyecto'],
      ['Sub Centro de Costo', 'No', 'Sub-centro de costo Contanet (col. U/V)'],
      ['Área', 'No', 'Área Contanet (col. Y)'],
      ['Es Administrativo', 'No', '"Sí" o "No" (vacío = No)'],
      ['Activo', 'No', '"Sí" o "No" (vacío = Sí)'],
      ['Aprobador N1', 'No', 'Email(s) de aprobador de nivel 1, separados por coma. Deben ser usuarios existentes en la empresa'],
      ['Aprobador N2', 'No', 'Email(s) de aprobador de nivel 2, separados por coma'],
      ['Aprobador N3', 'No', 'Email(s) de aprobador de nivel 3, separados por coma'],
    ])
    xlsx.utils.book_append_sheet(wb, instrWs, 'Instrucciones')

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' })
    return {
      file: buffer.toString('base64'),
      filename: 'plantilla_proyectos.xlsx',
    }
  }

  @Get(':clientId')
  @Roles(
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.COLABORADOR,
    ROLES.CONTABILIDAD,
    ROLES.TESORERIA
  )
  async findAll(
    @Param('clientId') clientId: string,
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string
  ) {
    return this.projectService.findAll(clientId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      isActive: isActive === undefined ? undefined : isActive !== 'false',
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
