import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
  Req,
  UnauthorizedException,
} from '@nestjs/common'
import { NotificationsService } from './notifications.service'
import { CreateNotificationDto } from './dto/create-notification.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  private extractUserId(req: any): string {
    const user = req?.user ?? {}
    const raw =
      user?.userId ??
      user?._id ??
      user?.id ??
      user?.sub ??
      (typeof user === 'string' ? user : undefined)

    const resolved = typeof raw === 'string' ? raw : raw?.toString?.()
    if (!resolved) {
      throw new UnauthorizedException(
        'No se pudo identificar el usuario autenticado para notificaciones.'
      )
    }
    return resolved
  }

  @Post()
  create(@Body() createNotificationDto: CreateNotificationDto) {
    return this.notificationsService.create(createNotificationDto)
  }

  @Get()
  findAll(@Req() req: any) {
    const userId = this.extractUserId(req)
    return this.notificationsService.findByUser(userId)
  }

  @Get('unread-count')
  getUnreadCount(@Req() req: any) {
    const userId = this.extractUserId(req)
    return this.notificationsService
      .getUnreadCount(userId)
      .then(count => ({ count }))
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    const userId = this.extractUserId(req)
    return this.notificationsService.findOne(id, userId)
  }

  @Patch('read-all')
  markAllAsRead(@Req() req: any) {
    const userId = this.extractUserId(req)
    return this.notificationsService.markAllAsRead(userId)
  }

  @Patch(':id/read')
  markAsRead(@Param('id') id: string, @Req() req: any) {
    const userId = this.extractUserId(req)
    return this.notificationsService.markAsRead(id, userId)
  }
}
