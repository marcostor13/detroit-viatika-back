import { Test, TestingModule } from '@nestjs/testing'
import { AiService } from './ai.service'
import { AdvanceService } from '../advance/advance.service'
import { ExpenseReportService } from '../expense-report/expense-report.service'
import { ExpenseService } from '../expense/expense.service'
import { OpenAiAgentProvider } from './providers/openai.provider'

async function* makeStream(chunks: any[]) {
  for (const chunk of chunks) yield chunk
}

const mockOpenAiAgent = {
  chat: jest.fn(),
}

const mockAdvanceService = {}
const mockExpenseReportService = {}
const mockExpenseService = {}

describe('AiService', () => {
  let service: AiService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: OpenAiAgentProvider, useValue: mockOpenAiAgent },
        { provide: AdvanceService, useValue: mockAdvanceService },
        { provide: ExpenseReportService, useValue: mockExpenseReportService },
        { provide: ExpenseService, useValue: mockExpenseService },
      ],
    }).compile()
    service = module.get<AiService>(AiService)
  })

  describe('chat', () => {
    it('delega al openAiAgent con mensajes y contexto', async () => {
      const chunks = [{ type: 'content', content: 'Hola' }, { type: 'done' }]
      mockOpenAiAgent.chat.mockReturnValue(makeStream(chunks))

      const context = {
        userId: 'user1',
        clientId: 'client1',
        userRole: 'Colaborador',
        userName: 'Juan',
      }
      const messages = [
        { role: 'user' as const, content: '¿Qué anticipos tengo?' },
      ]

      const stream = service.chat(messages, context)

      const received: any[] = []
      for await (const chunk of stream) {
        received.push(chunk)
      }

      expect(mockOpenAiAgent.chat).toHaveBeenCalledWith(
        messages,
        context,
        expect.any(Object)
      )
      expect(received).toHaveLength(2)
      expect(received[0]).toEqual({ type: 'content', content: 'Hola' })
      expect(received[1]).toEqual({ type: 'done' })
    })

    it('retorna un AsyncGenerator', () => {
      mockOpenAiAgent.chat.mockReturnValue(makeStream([]))
      const result = service.chat([], {
        userId: 'u1',
        clientId: 'c1',
        userRole: 'Colaborador',
        userName: 'U',
      })
      expect(typeof result[Symbol.asyncIterator]).toBe('function')
    })
  })
})
