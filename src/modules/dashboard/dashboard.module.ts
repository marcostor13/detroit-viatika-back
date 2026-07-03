import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { DashboardController } from './dashboard.controller'
import { DashboardService } from './dashboard.service'
import { Expense, ExpenseSchema } from '../expense/entities/expense.entity'
import { Advance, AdvanceSchema } from '../advance/entities/advance.entity'
import {
  ExpenseReport,
  ExpenseReportSchema,
} from '../expense-report/entities/expense-report.entity'
import { Project, ProjectSchema } from '../project/entities/project.entity'
import { Category, CategorySchema } from '../category/entities/category.entity'
import { User, UserSchema } from '../user/schemas/user.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Expense.name, schema: ExpenseSchema },
      { name: Advance.name, schema: AdvanceSchema },
      { name: ExpenseReport.name, schema: ExpenseReportSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Category.name, schema: CategorySchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
