import { Module } from '@nestjs/common'
import { AdvanceModule } from '../advance/advance.module'
import { ExpenseModule } from '../expense/expense.module'
import { ExpenseReportModule } from '../expense-report/expense-report.module'
import { AiController } from './ai.controller'
import { AiService } from './ai.service'
import { OpenAiAgentProvider } from './providers/openai.provider'

@Module({
  imports: [AdvanceModule, ExpenseReportModule, ExpenseModule],
  controllers: [AiController],
  providers: [AiService, OpenAiAgentProvider],
})
export class AiModule {}
