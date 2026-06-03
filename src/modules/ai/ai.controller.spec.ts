import { Test, TestingModule } from '@nestjs/testing'
import { AiController } from './ai.controller'
import { AiService } from './ai.service'

async function* makeStream(chunks: any[]) {
  for (const chunk of chunks) yield chunk
}

const mockAiService = {
  chat: jest.fn(),
}

describe('AiController', () => {
  let controller: AiController

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [{ provide: AiService, useValue: mockAiService }],
    }).compile()
    controller = module.get<AiController>(AiController)
  })

  function makeRes() {
    return {
      setHeader: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    }
  }

  function makeReq(overrides: Record<string, unknown> = {}) {
    return {
      user: {
        _id: 'user1',
        clientId: 'client1',
        roles: ['Colaborador'],
        email: 'test@test.com',
        ...overrides,
      },
    }
  }

  describe('chat', () => {
    it('configura SSE headers y escribe los chunks del stream', async () => {
      const chunks = [
        { type: 'content', content: 'Respuesta' },
        { type: 'done' },
      ]
      mockAiService.chat.mockReturnValue(makeStream(chunks))

      const req = makeReq()
      const res = makeRes()
      const dto: any = { messages: [{ role: 'user', content: 'Hola' }] }

      await controller.chat(dto, req as never, res as never)

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache')
      expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive')
      expect(res.write).toHaveBeenCalledTimes(2)
      expect(res.write).toHaveBeenNthCalledWith(
        1,
        `data: ${JSON.stringify({ type: 'content', content: 'Respuesta' })}\n\n`
      )
      expect(res.end).toHaveBeenCalled()
    })

    it('detiene el stream cuando llega chunk de tipo done', async () => {
      const chunks = [
        { type: 'content', content: 'A' },
        { type: 'done' },
        { type: 'content', content: 'B' },
      ]
      mockAiService.chat.mockReturnValue(makeStream(chunks))

      const req = makeReq()
      const res = makeRes()
      const dto: any = { messages: [] }

      await controller.chat(dto, req as never, res as never)

      expect(res.write).toHaveBeenCalledTimes(2)
    })

    it('maneja errores del stream y escribe chunk de error', async () => {
      mockAiService.chat.mockImplementation(() => {
        throw new Error('Error en AI')
      })

      const req = makeReq()
      const res = makeRes()
      const dto: any = { messages: [] }

      await controller.chat(dto, req as never, res as never)

      expect(res.write).toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"')
      )
      expect(res.end).toHaveBeenCalled()
    })

    it('construye el contexto correcto desde el JWT', async () => {
      mockAiService.chat.mockReturnValue(makeStream([{ type: 'done' }]))

      const req = makeReq({ roles: ['Administrador'] })
      const res = makeRes()
      const dto: any = { messages: [] }

      await controller.chat(dto, req as never, res as never)

      expect(mockAiService.chat).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          userId: 'user1',
          clientId: 'client1',
          userRole: 'Administrador',
          userName: 'test@test.com',
        })
      )
    })
  })
})
