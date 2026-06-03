import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export interface ClientLimits {
  movilidadDiario?: number
}

export interface ClientNotificationSettings {
  enabled: boolean
  frequency: 'semanal' | 'mensual'
}

export interface ClientDocument extends Document {
  codigo: string
  comercialName: string
  businessName: string
  businessId: string //ruc
  address: string
  phone: string
  email: string
  logo: string
  limits?: ClientLimits
  notificationSettings?: ClientNotificationSettings
}

export interface GetClientDocument extends ClientDocument {
  _id: Types.ObjectId
}

@Schema({ timestamps: true })
export class Client {
  @Prop({ required: true, unique: true, trim: true, uppercase: true })
  codigo: string

  @Prop({ required: true })
  comercialName: string

  @Prop({ required: true })
  businessName: string

  @Prop({ required: true })
  businessId: string //ruc

  @Prop({ default: '' })
  address: string

  @Prop({ default: '' })
  phone: string

  @Prop({ default: '' })
  email: string

  @Prop()
  logo: string

  @Prop({
    type: {
      movilidadDiario: { type: Number, default: null },
    },
    default: {},
  })
  limits: ClientLimits

  @Prop({
    type: {
      enabled: { type: Boolean, default: false },
      frequency: { type: String, enum: ['semanal', 'mensual'], default: 'semanal' },
      _id: false,
    },
    required: false,
  })
  notificationSettings?: ClientNotificationSettings
}

export const ClientSchema = SchemaFactory.createForClass(Client)
ClientSchema.index({ codigo: 1 }, { unique: true })
