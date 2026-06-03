import {
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsIn,
  IsBoolean,
  IsObject,
} from 'class-validator'
import { NotificationType } from '../entities/notification.entity'

export class CreateNotificationDto {
  @IsMongoId()
  @IsNotEmpty()
  userId: string

  @IsString()
  @IsNotEmpty()
  title: string

  @IsString()
  @IsNotEmpty()
  message: string

  @IsOptional()
  @IsIn(['success', 'info', 'warning', 'error'])
  type?: NotificationType

  @IsOptional()
  @IsString()
  actionUrl?: string

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>
}
