import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
  HttpException,
  HttpStatus,
  Logger,
  Request,
} from '@nestjs/common'
import { AccountingConfigService } from './accounting-config.service'
import { CreateAccountingConfigDto } from './dto/create-accounting-config.dto'
import { UpdateAccountingConfigDto } from './dto/update-accounting-config.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { ROLES } from '../auth/enums/roles.enum'
import { Roles } from '../auth/decorators/roles.decorador'
import { AuditLogService } from '../audit-log/audit-log.service'

@Controller('accounting-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccountingConfigController {
  private readonly logger = new Logger(AccountingConfigController.name)

  constructor(
    private readonly accountingConfigService: AccountingConfigService,
    private readonly auditLogService: AuditLogService
  ) {}

  @Get(':clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  async findOne(@Param('clientId') clientId: string) {
    try {
      return await this.accountingConfigService.findByClient(clientId)
    } catch (error) {
      this.logger.error(
        `Error al obtener configuración contable: ${error.message}`,
        error.stack
      )
      throw new HttpException(
        error.message || 'Error al obtener la configuración contable',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  /** Upsert de la configuración contable de la empresa. */
  @Put(':clientId')
  @Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CONTABILIDAD)
  async upsert(
    @Param('clientId') clientId: string,
    @Body() dto: CreateAccountingConfigDto | UpdateAccountingConfigDto,
    @Request() req: any
  ) {
    try {
      const result = await this.accountingConfigService.upsert(clientId, dto)
      this.auditLogService.log({
        userId: req.user._id || req.user.sub,
        userName: req.user.name || req.user.email,
        action: 'upsert_accounting_config',
        module: 'configuracion',
        entityId: clientId,
        details: 'Actualización de plan de cuentas / bancos',
        clientId,
      })
      return result
    } catch (error) {
      this.logger.error(
        `Error al guardar configuración contable: ${error.message}`,
        error.stack
      )
      throw new HttpException(
        error.message || 'Error al guardar la configuración contable',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }
}
