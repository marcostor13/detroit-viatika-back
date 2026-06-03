import {
  Body,
  Controller,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { Response } from 'express'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { AiService } from './ai.service'
import { ChatRequestDto } from './dto/chat.dto'

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  private readonly logger = new Logger(AiController.name)

  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  async chat(
    @Body() dto: ChatRequestDto,
    @Req() req: any,
    @Res() res: Response
  ) {
    const user = req.user
    const context = {
      userId: String(user._id ?? ''),
      clientId: String(user.clientId ?? ''),
      userRole: Array.isArray(user.roles)
        ? (user.roles[0] ?? '')
        : String(user.roles ?? ''),
      userName: user.email ?? 'Usuario',
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    try {
      const stream = this.aiService.chat(dto.messages, context)
      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        if (chunk.type === 'done') break
      }
    } catch (error) {
      this.logger.error('Error en chat AI', error)
      res.write(
        `data: ${JSON.stringify({ type: 'error', content: 'Error interno del asistente' })}\n\n`
      )
    } finally {
      res.end()
    }
  }
}
