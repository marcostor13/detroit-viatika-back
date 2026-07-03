import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Request,
  UseGuards,
  BadRequestException,
} from '@nestjs/common'
import { CajaChicaReportService } from './caja-chica-report.service'
import { CreateCajaChicaReportDto } from './dto/create-caja-chica-report.dto'
import { AddReportsDto } from './dto/add-reports.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorador'
import { ROLES } from '../auth/enums/roles.enum'
import { AuditLogService } from '../audit-log/audit-log.service'

@Controller('caja-chica-report')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.CONTABILIDAD, ROLES.ADMIN, ROLES.SUPER_ADMIN)
export class CajaChicaReportController {
  constructor(
    private readonly service: CajaChicaReportService,
    private readonly auditLogService: AuditLogService
  ) {}

  private resolveClientId(req: any): string {
    const raw = req?.user?.clientId
    if (raw && typeof raw === 'object' && '_id' in raw) return String(raw._id)
    return raw != null && raw !== '' ? String(raw) : ''
  }

  @Post()
  async create(@Body() dto: CreateCajaChicaReportDto, @Request() req: any) {
    const createdBy = String(req.user._id || req.user.sub)
    const clientId = this.resolveClientId(req)
    if (!clientId) {
      throw new BadRequestException('Cliente no identificado en la sesión.')
    }
    const result = await this.service.create(dto, createdBy, clientId)
    await this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'create_caja_chica_report',
      module: 'caja-chica-report',
      entityId: String(result._id),
      clientId: req.user.clientId,
    })
    return result
  }

  @Get()
  findAll(@Request() req: any) {
    const clientId = this.resolveClientId(req)
    return this.service.findAllByClient(clientId)
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  @Patch(':id/add-reports')
  async addReports(
    @Param('id') id: string,
    @Body() dto: AddReportsDto,
    @Request() req: any
  ) {
    const clientId = this.resolveClientId(req)
    const result = await this.service.addReports(id, dto.reportIds, clientId)
    await this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'add_reports_caja_chica',
      module: 'caja-chica-report',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }

  @Patch(':id/remove-report')
  async removeReport(
    @Param('id') id: string,
    @Body('expenseReportId') expenseReportId: string,
    @Request() req: any
  ) {
    const result = await this.service.removeReport(id, expenseReportId)
    await this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'remove_report_caja_chica',
      module: 'caja-chica-report',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }

  @Patch(':id/finalize')
  async finalize(@Param('id') id: string, @Request() req: any) {
    const result = await this.service.finalize(id)
    await this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'finalize_caja_chica_report',
      module: 'caja-chica-report',
      entityId: id,
      clientId: req.user.clientId,
    })
    return result
  }
}
