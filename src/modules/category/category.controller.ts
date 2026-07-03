import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import * as XLSX from 'xlsx'
import { CategoryService } from './category.service'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { ROLES } from '../auth/enums/roles.enum'
import { Roles } from '../auth/decorators/roles.decorador'
import { AuthGuard } from '@nestjs/passport'
import { AuditLogService } from '../audit-log/audit-log.service'
import { CategoryGroupService } from '../category-group/category-group.service'

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
@Controller('category')
export class CategoryController {
  constructor(
    private readonly categoryService: CategoryService,
    private readonly auditLogService: AuditLogService,
    private readonly categoryGroupService: CategoryGroupService
  ) {}

  /**
   * Categorías permitidas: las categorías asignadas directamente al usuario.
   * El perfil de categoría es solo una referencia (agrupa/deriva proyectos), no se asigna.
   * Sin categorías asignadas => no se filtra (compatibilidad).
   */
  private async resolveAllowedCategoryIds(
    req: any,
    _clientId: string
  ): Promise<string[] | undefined> {
    const ids: string[] = req.user?.permissions?.categoryIds ?? []
    return ids.length > 0 ? ids.map(String) : undefined
  }

  @Post()
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async create(
    @Body() createCategoryDto: CreateCategoryDto,
    @Request() req: any
  ) {
    const result = await this.categoryService.create(createCategoryDto)
    if (createCategoryDto.perfilIds !== undefined) {
      await this.categoryGroupService.setCategoryMembership(
        (result as any)?._id?.toString(),
        createCategoryDto.perfilIds,
        createCategoryDto.clientId
      )
    }
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'create_category',
      module: 'categorias',
      entityId: (result as any)?._id?.toString(),
      details: createCategoryDto.name,
      clientId: req.user.clientId,
    })
    return result
  }

  @Post('import')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'application/octet-stream', // algunos navegadores envían .xlsx así
        ]
        const nombre = (file.originalname || '').toLowerCase()
        const okExt = nombre.endsWith('.xlsx') || nombre.endsWith('.xls')
        if (allowed.includes(file.mimetype) || okExt) {
          cb(null, true)
        } else {
          cb(
            new BadRequestException('Solo se permiten archivos Excel (.xlsx)'),
            false
          )
        }
      },
    })
  )
  async importFromExcel(
    @UploadedFile() file: Express.Multer.File,
    @Body('clientId') clientId: string,
    @Request() req: any
  ) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo')
    if (!clientId) throw new BadRequestException('clientId es requerido')

    const workbook = XLSX.read(file.buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
      defval: '',
    })

    const mapped = rows.map(row => ({
      name: String(row['Nombre*'] || row['Nombre'] || '').trim(),
      cuenta: String(row['Cuenta'] || '').trim() || undefined,
      description:
        String(row['Descripción'] || row['Descripcion'] || '').trim() ||
        undefined,
      observaciones: String(row['Observaciones'] || '').trim() || undefined,
      limit:
        row['Límite'] != null && row['Límite'] !== ''
          ? parseFloat(String(row['Límite']))
          : null,
      perfil:
        String(
          row['Perfil de Categoría'] ||
            row['Perfil de Categoria'] ||
            row['Perfil'] ||
            ''
        ).trim() || undefined,
    }))

    const result = await this.categoryService.bulkCreate(mapped, clientId)

    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'import_categories',
      module: 'categorias',
      details: `Importadas: ${result.created}, Errores: ${result.errors.length}`,
      clientId: req.user.clientId,
    })

    return result
  }

  @Get(':clientId/flat-all')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  findAllFlatAdmin(@Param('clientId') clientId: string) {
    return this.categoryService.findAllFlat(clientId)
  }

  @Get(':clientId/flat')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  async findAllFlat(@Param('clientId') clientId: string, @Request() req: any) {
    const filter = await this.resolveAllowedCategoryIds(req, clientId)
    return this.categoryService.findAllFlat(clientId, filter)
  }

  @Get('flat/:clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  async findAllFlatLegacy(
    @Param('clientId') clientId: string,
    @Request() req: any
  ) {
    const filter = await this.resolveAllowedCategoryIds(req, clientId)
    return this.categoryService.findAllFlat(clientId, filter)
  }

  @Get(':clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  findAll(
    @Param('clientId') clientId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string
  ) {
    return this.categoryService.findAll(clientId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
    })
  }

  @Get(':id/:clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  @UseGuards(JwtAuthGuard, RolesGuard)
  findOne(@Param('id') id: string, @Param('clientId') clientId: string) {
    return this.categoryService.findOne(id, clientId)
  }

  @Get('key/:key/:clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COLABORADOR, ROLES.CONTABILIDAD)
  @UseGuards(JwtAuthGuard, RolesGuard)
  findByKey(@Param('key') key: string, @Param('clientId') clientId: string) {
    return this.categoryService.findByKey(key, clientId)
  }

  @Patch(':id/:clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async update(
    @Param('id') id: string,
    @Param('clientId') clientId: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
    @Request() req: any
  ) {
    const before = await this.categoryService
      .findOne(id, clientId)
      .catch(() => null)
    const result = await this.categoryService.update(
      id,
      updateCategoryDto,
      clientId
    )
    if (updateCategoryDto.perfilIds !== undefined) {
      await this.categoryGroupService.setCategoryMembership(
        id,
        updateCategoryDto.perfilIds,
        clientId
      )
    }
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'update_category',
      module: 'categorias',
      entityId: id,
      details: JSON.stringify({
        before: { limit: (before as any)?.limit },
        after: { limit: updateCategoryDto.limit },
      }),
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
    const result = await this.categoryService.remove(id, clientId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'delete_category',
      module: 'categorias',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }
}
