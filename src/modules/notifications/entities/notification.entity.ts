import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type NotificationType = 'success' | 'info' | 'warning' | 'error'

export interface NotificationDocument extends Document {
  userId: Types.ObjectId
  title: string
  message: string
  type: NotificationType
  isRead: boolean
  actionUrl?: string
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

@Schema({ timestamps: true })
export class Notification {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId

  @Prop({ required: true })
  title: string

  @Prop({ required: true })
  message: string

  @Prop({ required: true, default: 'info' })
  type: NotificationType

  @Prop({ required: true, default: false })
  isRead: boolean

  @Prop({ required: false })
  actionUrl?: string

  @Prop({ required: false, type: Object })
  metadata?: Record<string, any>
}

export const NotificationSchema = SchemaFactory.createForClass(Notification)
