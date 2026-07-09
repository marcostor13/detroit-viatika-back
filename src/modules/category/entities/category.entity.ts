import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { ClientDocument } from '../../client/entities/client.entity'

export interface CategoryDocument extends Document {
  name: string
  key: string
  description?: string
  /** Cuenta analítica 9X del gasto (clase 9). Ej. 91.3.1.410 (alimentación). */
  cuenta?: string
  /** Cuenta destino 6X (gasto por naturaleza). Ej. 63.1.4.100 (alimentación). */
  cuentaDestino6x?: string
  observaciones?: string
  isActive: boolean
  limit: number | null
  clientId: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export interface GetCategoryDocument extends Omit<CategoryDocument, '_id'> {
  _id: string
  client: ClientDocument
}

@Schema({ timestamps: true })
export class Category {
  @Prop({ required: true })
  name: string

  @Prop()
  key: string

  @Prop()
  description?: string

  @Prop()
  cuenta?: string

  @Prop()
  cuentaDestino6x?: string

  @Prop()
  observaciones?: string

  @Prop({ default: true })
  isActive: boolean

  @Prop({ type: Number, default: null })
  limit: number | null

  @Prop({ required: true, type: Types.ObjectId, ref: 'Client' })
  clientId: Types.ObjectId
}

export const CategorySchema = SchemaFactory.createForClass(Category)

CategorySchema.index({ key: 1, clientId: 1 }, { unique: true, sparse: true })
