import {
  Controller,
  Post,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Get,
  Req,
  Body,
  Param,
  Patch,
  Delete,
  Query,
  UploadedFile,
  UseInterceptors,
  ForbiddenException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { UserService } from './user.service'
import { AuthGuard } from '@nestjs/passport'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorador'
import { ROLES } from '../auth/enums/roles.enum'
import { CreateUserDto } from './dto/create-user.dto'
import { Types } from 'mongoose'
import { UpdateUserDto, UpdatePermissionsDto } from './dto/update-user.dto'
import { ParseObjectIdPipe } from './pipes/parse-objectid.pipe'
import { AuditLogService } from '../audit-log/audit-log.service'

@Controller('user')
export class UserController {
  constructor(
    private userService: UserService,
    private auditLogService: AuditLogService
  ) {}

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  @Get()
  async findAllWithClient() {
    return await this.userService.findAllWithClient()
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  @Post()
  async create(@Body() createdUserDto: CreateUserDto, @Request() req: any) {
    const result = await this.userService.create(createdUserDto)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'create_user',
      module: 'usuarios',
      entityId: (result as any)?._id?.toString(),
      details: createdUserDto.email,
      clientId: req.user.clientId,
    })
    return result
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD, ROLES.COLABORADOR)
  @Get('client/:clientId')
  async findAll(
    @Param('clientId', ParseObjectIdPipe) clientId: Types.ObjectId,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('roleName') roleName?: string,
    @Req() req?: any
  ) {
    const role: string = req?.user?.roles?.[0] ?? ''

    if (role === ROLES.COLABORADOR) {
      const hasRendicionesPermission = req?.user?.permissions?.modules?.includes('rendiciones')
      if (!hasRendicionesPermission) {
        throw new ForbiddenException('No tienes permiso para ver usuarios de esta empresa')
      }
    }

    if (role !== ROLES.SUPER_ADMIN && role !== ROLES.CONTABILIDAD) {
      const tokenClientId = req?.user?.clientId?.toString()
      if (!tokenClientId || tokenClientId !== clientId.toString()) {
        throw new ForbiddenException('No tienes permiso para ver usuarios de esta empresa')
      }
    }

    if (page || limit || search || status || roleName) {
      return this.userService.findAllPaginated(clientId, {
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        search,
        status,
        roleName,
      })
    }
    return this.userService.findAll(clientId)
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  async getMe(@Request() req: any) {
    const userId = req.user._id || req.user.sub
    return await this.userService.findOne(userId.toString())
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  @Get('details/:id')
  async findOne(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    return await this.userService.findOne(id.toString())
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('profile')
  async updateOwnProfile(
    @Body() body: { name?: string; profilePic?: string },
    @Request() req: any
  ) {
    const userId = req.user._id || req.user.sub
    const updateData: UpdateUserDto = {}
    if (body.name?.trim()) updateData.name = body.name.trim()
    if (body.profilePic !== undefined) updateData.profilePic = body.profilePic
    return await this.userService.update(userId, updateData)
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  @Patch(':id')
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() updateUserDto: UpdateUserDto
  ) {
    return await this.userService.update(id.toString(), updateUserDto)
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  @Patch(':id/permissions')
  async updatePermissions(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() permissionsDto: UpdatePermissionsDto,
    @Request() req: any
  ) {
    const result = await this.userService.update(id.toString(), {
      permissions: permissionsDto,
    })
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'update_permissions',
      module: 'usuarios',
      entityId: id.toString(),
      details: JSON.stringify(permissionsDto),
      clientId: req.user.clientId,
    })
    return result
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  @Patch(':id/notifications')
  async updateEmailNotifications(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() body: { emailNotificationsEnabled: boolean },
    @Request() req: any
  ) {
    await this.userService.setEmailNotifications(id.toString(), !!body.emailNotificationsEnabled)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'update_email_notifications',
      module: 'usuarios',
      entityId: id.toString(),
      details: body.emailNotificationsEnabled ? 'activadas' : 'desactivadas',
      clientId: req.user.clientId,
    })
    return { emailNotificationsEnabled: !!body.emailNotificationsEnabled }
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  @Delete(':id')
  async delete(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    return await this.userService.delete(id.toString())
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  @Post(':id/reset-password')
  async resetPassword(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Request() req: any
  ) {
    const result = await this.userService.resetPassword(id.toString())
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'reset_password',
      module: 'usuarios',
      entityId: id.toString(),
      clientId: req.user.clientId,
    })
    return result
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  @Post('bulk-import')
  @UseInterceptors(FileInterceptor('file'))
  async bulkImport(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { clientId: string; roleId: string },
    @Request() req: any
  ) {
    if (!file) throw new Error('No se recibió archivo')
    const xlsx = await import('xlsx')
    const wb = xlsx.read(file.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows: any[] = xlsx.utils.sheet_to_json(ws)
    const clientId = body.clientId || req.user?.clientId
    const roleId = body.roleId
    const result = await this.userService.bulkImportUsers(rows, clientId, roleId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'bulk_import_users',
      module: 'usuarios',
      details: `Creados: ${result.created}, Omitidos: ${result.skipped.length}, Errores: ${result.errors.length}`,
      clientId,
    })
    return result
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
  @Get('bulk-import/template')
  async downloadTemplate(@Request() req: any) {
    const xlsx = await import('xlsx')
    const ws = xlsx.utils.aoa_to_sheet([
      ['name', 'email', 'password', 'roleId', 'coordinatorId'],
      ['Juan Pérez', 'juan@empresa.com', 'Pass123!', '', ''],
    ])
    const wb = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(wb, ws, 'Usuarios')
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' })
    return { file: buffer.toString('base64'), filename: 'plantilla_usuarios.xlsx' }
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('profile/password')
  async changeOwnPassword(
    @Body() body: { password: string },
    @Request() req: any
  ) {
    const userId = req.user._id || req.user.sub
    await this.userService.changeOwnPassword(userId, body.password)
    return { message: 'Contraseña actualizada correctamente' }
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('profile/signature')
  async updateSignature(
    @Body() body: { signature: string },
    @Request() req: any
  ) {
    const userId = req.user._id || req.user.sub
    const result = await this.userService.update(userId, {
      signature: body.signature,
    })
    this.auditLogService.log({
      userId: userId,
      userName: req.user.name || req.user.email,
      action: 'update_signature',
      module: 'usuarios',
      entityId: userId,
      details: 'El usuario actualizó su firma digital',
      clientId: req.user.clientId,
    })
    return result
  }
}
