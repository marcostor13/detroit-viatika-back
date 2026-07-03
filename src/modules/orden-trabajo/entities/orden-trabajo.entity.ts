import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { OT_DEPARTAMENTO_CODES } from '../constants/orden-trabajo.constants'

export interface OrdenTrabajoDocument extends Document {
  departamento: string
  correlativo: number
  codigo: string
  descripcion?: string
  isActive: boolean
  clientId: Types.ObjectId
}

@Schema({ timestamps: true })
export class OrdenTrabajo {
  @Prop({ required: true, uppercase: true, enum: OT_DEPARTAMENTO_CODES })
  departamento: string

  /** Correlativo secuencial por departamento y empresa. Nunca se reutiliza, ni al eliminar una OT. */
  @Prop({ required: true })
  correlativo: number

  /** Código completo pre-calculado: LIM-{departamento}-{correlativo con 6 dígitos}. */
  @Prop({ required: true, trim: true })
  codigo: string

  @Prop({ trim: true })
  descripcion?: string

  @Prop({ default: true })
  isActive: boolean

  @Prop({ required: true, type: Types.ObjectId, ref: 'Client' })
  clientId: Types.ObjectId
}

export const OrdenTrabajoSchema = SchemaFactory.createForClass(OrdenTrabajo)

OrdenTrabajoSchema.index({ codigo: 1, clientId: 1 }, { unique: true })
OrdenTrabajoSchema.index(
  { departamento: 1, correlativo: 1, clientId: 1 },
  { unique: true }
)

/**
 * Documento contador atómico, uno por (clientId, departamento). El correlativo
 * de cada OT se obtiene con un $inc atómico sobre este documento (patrón
 * estándar de secuencia de Mongo), evitando condiciones de carrera cuando dos
 * OT del mismo departamento se crean al mismo tiempo.
 */
export interface OrdenTrabajoCounterDocument extends Document {
  clientId: Types.ObjectId
  departamento: string
  seq: number
}

@Schema({ collection: 'ordentrabajocounters' })
export class OrdenTrabajoCounter {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Client' })
  clientId: Types.ObjectId

  @Prop({ required: true, uppercase: true, enum: OT_DEPARTAMENTO_CODES })
  departamento: string

  @Prop({ required: true, default: 0 })
  seq: number
}

export const OrdenTrabajoCounterSchema = SchemaFactory.createForClass(
  OrdenTrabajoCounter
)

OrdenTrabajoCounterSchema.index(
  { clientId: 1, departamento: 1 },
  { unique: true }
)
