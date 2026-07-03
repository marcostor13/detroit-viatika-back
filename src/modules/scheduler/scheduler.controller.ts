import {
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common'
import { SchedulerService } from './scheduler.service'

const TEST_EMAIL = 'marcostor13@gmail.com'

@Controller('scheduler')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  /**
   * Endpoint libre para probar las plantillas de correo de notificaciones.
   * Protegido por cabecera `x-test-key` que debe coincidir con la variable de
   * entorno `SCHEDULER_TEST_KEY`. Si la variable no está definida en el entorno,
   * el endpoint queda deshabilitado aunque se envíe la cabecera correcta.
   *
   * POST /api/scheduler/test-notifications
   * Headers: x-test-key: <valor de SCHEDULER_TEST_KEY>
   */
  @Post('test-notifications')
  @HttpCode(200)
  async testNotifications(
    @Headers('x-test-key') testKey: string
  ): Promise<{ ok: boolean; sentTo: string; types: string[] }> {
    const configuredKey = process.env.SCHEDULER_TEST_KEY?.trim()

    if (!configuredKey) {
      throw new ForbiddenException(
        'Test notifications are disabled (SCHEDULER_TEST_KEY not configured)'
      )
    }

    if (!testKey || testKey.trim() !== configuredKey) {
      throw new ForbiddenException('Invalid test key')
    }

    const types = await this.schedulerService.sendTestEmails(TEST_EMAIL)

    return { ok: true, sentTo: TEST_EMAIL, types }
  }
}
