import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export interface LineaNegocioDocument extends Document {
  name: string
  code: string
  isActive: boolean
  clientId: Types.ObjectId
}

@Schema({ timestamps: true })
export class LineaNegocio {
  @Prop({ required: true, trim: true })
  name: string

  @Prop({ required: true, trim: true })
  code: string

  @Prop({ default: true })
  isActive: boolean

  @Prop({ required: true, type: Types.ObjectId, ref: 'Client' })
  clientId: Types.ObjectId
}

export const LineaNegocioSchema = SchemaFactory.createForClass(LineaNegocio)

LineaNegocioSchema.index({ code: 1, clientId: 1 }, { unique: true })
