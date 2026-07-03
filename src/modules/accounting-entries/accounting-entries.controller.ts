import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { AccountingEntriesService } from './accounting-entries.service'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { ROLES } from '../auth/enums/roles.enum'
import { Roles } from '../auth/decorators/roles.decorador'
import { AuditLogService } from '../audit-log/audit-log.service'
import { AsientoTipo } from './entities/accounting-entries.types'
import { TimeoutInterceptor } from '../../common/interceptors/timeout.interceptor'

/** 295 s (5 min − 5 s de margen) — configurable vía REQUEST_TIMEOUT_MS en .env. */
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 295_000

const ALL_TIPOS: AsientoTipo[] = [
  'solicitud',
  'compra',
  'aplicacion',
  'devolucion',
  'reembolso',
]

@Controller('accounting-entries')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(new TimeoutInterceptor(REQUEST_TIMEOUT_MS))
export class AccountingEntriesController {
  private readonly logger = new Logger(AccountingEntriesController.name)

  constructor(
    private readonly service: AccountingEntriesService,
    private readonly auditLogService: AuditLogService
  ) {}

  /**
   * Genera los archivos de asientos de una rendición. Solo Contabilidad (y Super).
   * `tipos` opcional: lista separada por coma (compra,aplicacion,devolucion,reembolso,solicitud).
   */
  /** Forma con clientId explícito en la ruta (convención del resto del app). */
  @Get(':reportId/:clientId')
  @Roles(ROLES.CONTABILIDAD, ROLES.SUPER_ADMIN)
  async downloadWithClient(
    @Param('reportId') reportId: string,
    @Param('clientId') clientId: string,
    @Query('tipos') tipos: string | undefined,
    @Request() req: any
  ) {
    return this.handleDownload(reportId, clientId, tipos, req)
  }

  /** Limpia la caché de asientos de una rendición (fuerza regeneración). */
  @Delete('cache/:reportId')
  @Roles(ROLES.CONTABILIDAD, ROLES.SUPER_ADMIN)
  async clearCache(@Param('reportId') reportId: string) {
    return this.service.clearCache(reportId)
  }

  /** Forma corta: el clientId se toma del JWT. */
  @Get(':reportId')
  @Roles(ROLES.CONTABILIDAD, ROLES.SUPER_ADMIN)
  async download(
    @Param('reportId') reportId: string,
    @Query('tipos') tipos: string | undefined,
    @Request() req: any
  ) {
    return this.handleDownload(reportId, undefined, tipos, req)
  }

  private async handleDownload(
    reportId: string,
    pathClientId: string | undefined,
    tipos: string | undefined,
    req: any
  ) {
    try {
      // Prioriza el clientId del JWT; usa el de la ruta solo como respaldo.
      const clientId = req.user?.clientId || pathClientId
      if (!clientId) {
        throw new HttpException(
          'No se pudo determinar la empresa del usuario',
          HttpStatus.BAD_REQUEST
        )
      }
      const tipoList = (
        tipos ? tipos.split(',').map(t => t.trim()) : ALL_TIPOS
      ).filter((t): t is AsientoTipo => (ALL_TIPOS as string[]).includes(t))

      const files = await this.service.generateForReport(
        reportId,
        clientId,
        tipoList.length ? tipoList : ALL_TIPOS
      )

      this.auditLogService.log({
        userId: req.user._id || req.user.sub,
        userName: req.user.name || req.user.email,
        action: 'download_accounting_entries',
        module: 'facturas',
        entityId: reportId,
        details: `Asientos: ${files.map(f => f.tipo).join(', ')}`,
        clientId,
      })

      return { files }
    } catch (error) {
      this.logger.error(
        `Error al generar asientos: ${error.message}`,
        error.stack
      )
      throw new HttpException(
        error.message || 'Error al generar los asientos contables',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }
}
