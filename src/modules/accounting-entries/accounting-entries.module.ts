import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { MongooseModule } from '@nestjs/mongoose'
import { AccountingEntriesService } from './accounting-entries.service'
import { AccountingEntriesController } from './accounting-entries.controller'
import { AccountingConfigModule } from '../accounting-config/accounting-config.module'
import { AuditLogModule } from '../audit-log/audit-log.module'
import {
  ExpenseReport,
  ExpenseReportSchema,
} from '../expense-report/entities/expense-report.entity'
import { Expense, ExpenseSchema } from '../expense/entities/expense.entity'
import { Advance, AdvanceSchema } from '../advance/entities/advance.entity'
import { Project, ProjectSchema } from '../project/entities/project.entity'
import { User, UserSchema } from '../user/schemas/user.schema'
import { Category, CategorySchema } from '../category/entities/category.entity'
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module'
import {
  AccountingEntriesCache,
  AccountingEntriesCacheSchema,
} from './entities/accounting-entries-cache.entity'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExpenseReport.name, schema: ExpenseReportSchema },
      { name: Expense.name, schema: ExpenseSchema },
      { name: Advance.name, schema: AdvanceSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: User.name, schema: UserSchema },
      { name: Category.name, schema: CategorySchema },
      { name: AccountingEntriesCache.name, schema: AccountingEntriesCacheSchema },
    ]),
    ConfigModule,
    AccountingConfigModule,
    AuditLogModule,
    ExchangeRateModule,
  ],
  controllers: [AccountingEntriesController],
  providers: [AccountingEntriesService],
  exports: [AccountingEntriesService],
})
export class AccountingEntriesModule {}
