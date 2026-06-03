import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { SchedulerService } from './scheduler.service'
import { Advance, AdvanceSchema } from '../advance/entities/advance.entity'
import { ExpenseReport, ExpenseReportSchema } from '../expense-report/entities/expense-report.entity'
import { Expense, ExpenseSchema } from '../expense/entities/expense.entity'
import { Client, ClientSchema } from '../client/entities/client.entity'
import { UserModule } from '../user/user.module'
import { EmailModule } from '../email/email.module'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Advance.name, schema: AdvanceSchema },
      { name: ExpenseReport.name, schema: ExpenseReportSchema },
      { name: Expense.name, schema: ExpenseSchema },
      { name: Client.name, schema: ClientSchema },
    ]),
    UserModule,
    EmailModule,
    NotificationsModule,
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}
