import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export interface CategoryGroupDocument extends Document {
  name: string
  description?: string
  clientId: Types.ObjectId
  categoryIds: Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
}

@Schema({ timestamps: true })
export class CategoryGroup {
  @Prop({ required: true })
  name: string

  @Prop()
  description?: string

  @Prop({ required: true, type: Types.ObjectId, ref: 'Client' })
  clientId: Types.ObjectId

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Category' }], default: [] })
  categoryIds: Types.ObjectId[]
}

export const CategoryGroupSchema = SchemaFactory.createForClass(CategoryGroup)

CategoryGroupSchema.index({ name: 1, clientId: 1 }, { unique: true })
