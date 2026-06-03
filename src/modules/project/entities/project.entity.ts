import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { GetClientDocument } from '../../client/entities/client.entity'

export interface ProjectDocument extends Document {
  name: string
  code: string
  isActive: boolean
  clientId: Types.ObjectId
  clientName?: string
  /** Suma de montos de solicitudes aprobadas pendientes de pago (Fase 3 — compromiso). */
  committedAdvanceTotal?: number
}

export interface GetProjectDocument {
  name: string
  client: GetClientDocument
  _id: string
  createdAt: Date
  updatedAt: Date
}

@Schema({ timestamps: true })
export class Project {
  @Prop({ required: true })
  name: string

  @Prop({ required: true })
  code: string

  @Prop({ default: true })
  isActive: boolean

  @Prop({ required: true, type: Types.ObjectId, ref: 'Client' })
  clientId: Types.ObjectId

  @Prop({ type: String })
  clientName?: string

  @Prop({ type: Number, default: 0 })
  committedAdvanceTotal: number
}

export const ProjectSchema = SchemaFactory.createForClass(Project)

ProjectSchema.index({ code: 1, clientId: 1 }, { unique: true })
