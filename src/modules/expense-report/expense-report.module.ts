import { Module, forwardRef } from '@nestjs/common'
import { ExpenseReportService } from './expense-report.service'
import { ExpenseReportController } from './expense-report.controller'
import { MongooseModule } from '@nestjs/mongoose'
import {
  ExpenseReport,
  ExpenseReportSchema,
} from './entities/expense-report.entity'
import { Expense, ExpenseSchema } from '../expense/entities/expense.entity'
import { AuditLogModule } from '../audit-log/audit-log.module'
import { EmailModule } from '../email/email.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { UserModule } from '../user/user.module'
import { AdvanceModule } from '../advance/advance.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExpenseReport.name, schema: ExpenseReportSchema },
      { name: Expense.name, schema: ExpenseSchema },
    ]),
    AuditLogModule,
    EmailModule,
    NotificationsModule,
    UserModule,
    forwardRef(() => AdvanceModule),
  ],
  controllers: [ExpenseReportController],
  providers: [ExpenseReportService],
  exports: [ExpenseReportService],
})
export class ExpenseReportModule {}
