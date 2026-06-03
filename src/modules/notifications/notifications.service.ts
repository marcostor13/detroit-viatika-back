import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import {
  Notification,
  NotificationDocument,
} from './entities/notification.entity'
import { CreateNotificationDto } from './dto/create-notification.dto'

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>
  ) {}

  private normalizeUserObjectId(userId: unknown): Types.ObjectId {
    if (userId instanceof Types.ObjectId) return userId

    let raw = ''
    if (typeof userId === 'string') {
      raw = userId
    } else if (
      typeof userId === 'object' &&
      userId !== null &&
      '_id' in (userId as Record<string, unknown>)
    ) {
      raw = String((userId as Record<string, unknown>)['_id'])
    }

    if (!Types.ObjectId.isValid(raw)) {
      throw new Error(`Invalid userId for notification: "${raw}"`)
    }

    return new Types.ObjectId(raw)
  }

  async create(
    createDto: CreateNotificationDto
  ): Promise<NotificationDocument> {
    try {
      const normalizedUserId = this.normalizeUserObjectId(createDto.userId)
      const created = new this.notificationModel({
        ...createDto,
        userId: normalizedUserId,
      })
      return await created.save()
    } catch (error) {
      this.logger.error('Error creating notification', error)
      throw error
    }
  }

  async findByUser(userId: string): Promise<NotificationDocument[]> {
    const normalizedUserId = this.normalizeUserObjectId(userId)
    const notifs = await this.notificationModel
      .find({ userId: normalizedUserId })
      .sort({ createdAt: -1 })
      .limit(50) // limit to recent 50
      .exec()
    return notifs
  }

  async getUnreadCount(userId: string): Promise<number> {
    const normalizedUserId = this.normalizeUserObjectId(userId)
    const count = await this.notificationModel
      .countDocuments({
        userId: normalizedUserId,
        isRead: false,
      })
      .exec()
    return count
  }

  async findOne(
    id: string,
    userId: string
  ): Promise<NotificationDocument | null> {
    const normalizedUserId = this.normalizeUserObjectId(userId)
    return this.notificationModel
      .findOne({
        _id: new Types.ObjectId(id),
        userId: normalizedUserId,
      })
      .exec()
  }

  async markAsRead(
    id: string,
    userId: string
  ): Promise<NotificationDocument | null> {
    const normalizedUserId = this.normalizeUserObjectId(userId)
    return this.notificationModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), userId: normalizedUserId },
        { $set: { isRead: true } },
        { new: true }
      )
      .exec()
  }

  async markAllAsRead(userId: string): Promise<{ modifiedCount: number }> {
    const normalizedUserId = this.normalizeUserObjectId(userId)
    const result = await this.notificationModel
      .updateMany(
        { userId: normalizedUserId, isRead: false },
        { $set: { isRead: true } }
      )
      .exec()
    return { modifiedCount: result.modifiedCount }
  }
}
