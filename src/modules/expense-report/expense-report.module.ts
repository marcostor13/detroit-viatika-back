import { Module, forwardRef } from '@nestjs/common'
import { ExpenseReportService } from './expense-report.service'
import { ExpenseReportController } from './expense-report.controller'
import { MongooseModule } from '@nestjs/mongoose'
import {
  ExpenseReport,
  ExpenseReportSchema,
} from './entities/expense-report.entity'
import { Expense, ExpenseSchema } from '../expense/entities/expense.entity'
import {
  CajaChicaReport,
  CajaChicaReportSchema,
} from '../caja-chica-report/entities/caja-chica-report.entity'
import { AuditLogModule } from '../audit-log/audit-log.module'
import { EmailModule } from '../email/email.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { UserModule } from '../user/user.module'
import { AdvanceModule } from '../advance/advance.module'
import { UploadModule } from '../upload/upload.module'
import { ProjectModule } from '../project/project.module'
import { CategoryModule } from '../category/category.module'
import { SaldoModule } from '../saldo/saldo.module'
import { ClientModule } from '../client/client.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExpenseReport.name, schema: ExpenseReportSchema },
      { name: Expense.name, schema: ExpenseSchema },
      { name: CajaChicaReport.name, schema: CajaChicaReportSchema },
    ]),
    AuditLogModule,
    EmailModule,
    NotificationsModule,
    UserModule,
    UploadModule,
    ProjectModule,
    CategoryModule,
    SaldoModule,
    ClientModule,
    forwardRef(() => AdvanceModule),
  ],
  controllers: [ExpenseReportController],
  providers: [ExpenseReportService],
  exports: [ExpenseReportService],
})
export class ExpenseReportModule {}
