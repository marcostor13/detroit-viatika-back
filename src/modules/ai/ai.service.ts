import { Injectable } from '@nestjs/common'
import { AdvanceService } from '../advance/advance.service'
import { ExpenseReportService } from '../expense-report/expense-report.service'
import { ExpenseService } from '../expense/expense.service'
import { OpenAiAgentProvider, StreamChunk } from './providers/openai.provider'
import { SkillsExecutor, UserContext } from './skills/skills.registry'

@Injectable()
export class AiService {
  constructor(
    private readonly openAiAgent: OpenAiAgentProvider,
    private readonly advanceService: AdvanceService,
    private readonly expenseReportService: ExpenseReportService,
    private readonly expenseService: ExpenseService
  ) {}

  chat(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    context: UserContext
  ): AsyncGenerator<StreamChunk> {
    const executor = new SkillsExecutor(
      this.advanceService,
      this.expenseReportService,
      this.expenseService
    )
    return this.openAiAgent.chat(messages, context, executor)
  }
}
