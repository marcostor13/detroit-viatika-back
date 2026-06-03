import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Delete,
  Param,
  UseGuards,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { SunatConfigService } from './sunat-config.service'
import { CreateSunatConfigDto } from './dto/create-sunat-config.dto'
import { UpdateSunatConfigDto } from './dto/update-sunat-config.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { ROLES } from '../auth/enums/roles.enum'
import { Roles } from '../auth/decorators/roles.decorador'

@Controller('sunat-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SunatConfigController {
  private readonly logger = new Logger(SunatConfigController.name)

  constructor(private readonly sunatConfigService: SunatConfigService) {}

  @Post()
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  async create(@Body() createSunatConfigDto: CreateSunatConfigDto) {
    return this.sunatConfigService.create(createSunatConfigDto)
  }

  /** Ruta estática antes de `:clientId` para no interpretar "credentials" como clientId */
  @Get('credentials/:clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  async getCredentials(@Param('clientId') clientId: string) {
    try {
      this.logger.log('Recibida solicitud para obtener credenciales SUNAT')

      const credentials =
        await this.sunatConfigService.getActiveCredentials(clientId)

      this.logger.log('Credenciales SUNAT obtenidas exitosamente')
      return credentials
    } catch (error) {
      this.logger.error(
        `Error al obtener credenciales SUNAT: ${error.message}`,
        error.stack
      )
      throw new HttpException(
        error.message || 'Error al obtener las credenciales SUNAT',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  @Get(':clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  async findOne(@Param('clientId') clientId: string) {
    try {
      const config = await this.sunatConfigService.findOne(clientId)
      return config
    } catch (error) {
      this.logger.error(
        `Error al obtener configuración SUNAT: ${error.message}`,
        error.stack
      )
      throw new HttpException(
        error.message || 'Error al obtener la configuración SUNAT',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  @Patch(':id')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  async update(
    @Param('id') _id: string,
    @Body() updateSunatConfigDto: UpdateSunatConfigDto
  ) {
    try {
      this.logger.log('Recibida solicitud para actualizar configuración SUNAT')

      const config = await this.sunatConfigService.update(
        _id,
        updateSunatConfigDto
      )

      this.logger.log('Configuración SUNAT actualizada exitosamente')
      return config
    } catch (error) {
      this.logger.error(
        `Error al actualizar configuración SUNAT: ${error.message}`,
        error.stack
      )
      throw new HttpException(
        error.message || 'Error al actualizar la configuración SUNAT',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  @Delete(':id')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  async remove(@Param('id') _id: string) {
    try {
      this.logger.log('Recibida solicitud para eliminar configuración SUNAT')

      const config = await this.sunatConfigService.remove(_id)

      this.logger.log('Configuración SUNAT eliminada exitosamente')
      return config
    } catch (error) {
      this.logger.error(
        `Error al eliminar configuración SUNAT: ${error.message}`,
        error.stack
      )
      throw new HttpException(
        error.message || 'Error al eliminar la configuración SUNAT',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }
}
