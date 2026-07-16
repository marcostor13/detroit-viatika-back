import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

/**
 * Perfil de categoría (VD-38): agrupa un conjunto de categorías bajo un nombre.
 * Sirve para, en permisos, seleccionar de una vez todas las categorías del perfil.
 */
export interface CategoryProfileDocument extends Document {
  name: string
  description?: string
  categoryIds: Types.ObjectId[]
  clientId: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

@Schema({ timestamps: true })
export class CategoryProfile {
  @Prop({ required: true, trim: true })
  name: string

  @Prop({ required: false, trim: true })
  description?: string

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Category' }], default: [] })
  categoryIds: Types.ObjectId[]

  @Prop({ required: true, type: Types.ObjectId, ref: 'Client' })
  clientId: Types.ObjectId
}

export const CategoryProfileSchema =
  SchemaFactory.createForClass(CategoryProfile)

CategoryProfileSchema.index({ name: 1, clientId: 1 }, { unique: true })
