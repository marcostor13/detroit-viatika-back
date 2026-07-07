import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export interface OrdenTrabajoDocument extends Document {
  nombre: string
  costCenterId: Types.ObjectId
  isActive: boolean
  clientId: Types.ObjectId
}

@Schema({ timestamps: true })
export class OrdenTrabajo {
  /**
   * Nombre/código de la OT que teclea el usuario (ej. "Lim-Com-1"). Es el
   * identificador visible de la OT y es único por empresa (ver índice de
   * abajo): la misma empresa no puede repetirlo, pero otra empresa sí puede
   * tener una OT con el mismo nombre (plataforma multitenant).
   */
  @Prop({ required: true, trim: true })
  nombre: string

  /** Centro de costo (Project) al que pertenece la OT. Relación 1 CC → N OT. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'Project' })
  costCenterId: Types.ObjectId

  @Prop({ default: true })
  isActive: boolean

  @Prop({ required: true, type: Types.ObjectId, ref: 'Client' })
  clientId: Types.ObjectId
}

export const OrdenTrabajoSchema = SchemaFactory.createForClass(OrdenTrabajo)

/**
 * Unicidad del nombre POR EMPRESA. Incluir `clientId` en la clave es lo que
 * permite que dos empresas distintas tengan una OT con el mismo nombre
 * (ej. ambas pueden tener "Lim-Com-1"), pero una misma empresa no lo repita.
 */
OrdenTrabajoSchema.index({ nombre: 1, clientId: 1 }, { unique: true })

/** Búsquedas frecuentes: OTs de un centro de costo dentro de una empresa. */
OrdenTrabajoSchema.index({ clientId: 1, costCenterId: 1 })
