import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { ClientDocument } from '../../client/entities/client.entity'

export interface CategoryDocument extends Document {
  name: string
  key: string
  description?: string
  cuenta?: string
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
