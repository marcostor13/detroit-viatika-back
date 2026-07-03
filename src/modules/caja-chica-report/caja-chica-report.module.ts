import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { CajaChicaReportService } from './caja-chica-report.service'
import { CajaChicaReportController } from './caja-chica-report.controller'
import {
  CajaChicaReport,
  CajaChicaReportSchema,
} from './entities/caja-chica-report.entity'
import {
  ExpenseReport,
  ExpenseReportSchema,
} from '../expense-report/entities/expense-report.entity'
import { AuditLogModule } from '../audit-log/audit-log.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CajaChicaReport.name, schema: CajaChicaReportSchema },
      { name: ExpenseReport.name, schema: ExpenseReportSchema },
    ]),
    AuditLogModule,
  ],
  controllers: [CajaChicaReportController],
  providers: [CajaChicaReportService],
  exports: [CajaChicaReportService],
})
export class CajaChicaReportModule {}
