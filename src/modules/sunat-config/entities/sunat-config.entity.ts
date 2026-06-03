import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export interface SunatConfigDocument extends Omit<Document, '_id'> {
  _id: string
  clientId: Types.ObjectId
  clientIdSunat: string
  clientSecret: string
  ruc: string
  isActive: boolean
}

@Schema({ timestamps: true })
export class SunatConfig {
  @Prop({ type: Types.ObjectId, ref: 'Client', required: true, unique: true })
  clientId: Types.ObjectId

  @Prop({ required: true })
  clientIdSunat: string

  @Prop({ required: true })
  clientSecret: string

  @Prop({ required: true })
  ruc: string

  @Prop({ default: true })
  isActive: boolean
}

export const SunatConfigSchema = SchemaFactory.createForClass(SunatConfig)
