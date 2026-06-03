import OpenAI from 'openai'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { buildSystemPrompt } from '../constants/system-prompt'
import {
  OPENAI_TOOLS,
  SkillsExecutor,
  UserContext,
} from '../skills/skills.registry'

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'done' | 'error'
  content?: string
  toolName?: string
}

@Injectable()
export class OpenAiAgentProvider {
  private readonly client: OpenAI
  private readonly logger = new Logger(OpenAiAgentProvider.name)
  readonly model = 'gpt-4o'

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')
    if (!apiKey) throw new Error('OPENAI_API_KEY no configurada')
    this.client = new OpenAI({ apiKey })
  }

  async *chat(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    context: UserContext,
    executor: SkillsExecutor
  ): AsyncGenerator<StreamChunk> {
    const system = buildSystemPrompt(context)
    const history: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      ...messages.map(
        m =>
          ({
            role: m.role,
            content: m.content,
          }) as OpenAI.ChatCompletionMessageParam
      ),
    ]

    let continueLoop = true
    while (continueLoop) {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: history,
        tools: OPENAI_TOOLS,
        tool_choice: 'auto',
      })

      const choice = response.choices[0]
      history.push(choice.message)

      if (choice.finish_reason === 'tool_calls') {
        const toolCalls = choice.message.tool_calls ?? []
        const toolResults: OpenAI.ChatCompletionToolMessageParam[] = []

        for (const tc of toolCalls) {
          yield { type: 'tool_call', toolName: tc.function.name }
          let args: Record<string, any> = {}
          try {
            args = JSON.parse(tc.function.arguments)
          } catch {
            /* empty args */
          }
          const result = await executor.execute(tc.function.name, args, context)
          toolResults.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result,
          })
        }

        history.push(...toolResults)
      } else {
        const content = choice.message.content ?? ''
        if (content) yield { type: 'text', content }
        continueLoop = false
      }
    }

    yield { type: 'done' }
  }
}
