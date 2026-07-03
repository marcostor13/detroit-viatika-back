import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { GetClientDocument } from '../../client/entities/client.entity'

export interface ProjectDocument extends Document {
  name: string
  code: string
  isActive: boolean
  clientId: Types.ObjectId
  clientName?: string
  /** Línea de negocio asignada al centro de costo (opcional). */
  lineaNegocioId?: Types.ObjectId
  /** Perfil de categoría asignado al centro de costo (opcional). */
  categoryGroupId?: Types.ObjectId
  /** Suma de montos de solicitudes aprobadas pendientes de pago (Fase 3 — compromiso). */
  committedAdvanceTotal?: number
  // --- Mapeo contable (asientos Contanet) ---
  /** Cuenta analítica clase 9 del proyecto/centro de costo (ej. 91.3.1.410). */
  cuentaAnalitica9x?: string
  /** Cuenta destino clase 6 (gasto por naturaleza) que recibe la analítica (ej. 63.1.4.100). */
  cuentaDestino6x?: string
  /** Centro de costo Contanet (col T), ej. SC. */
  centroCosto?: string
  /** Sub-centro de costo Contanet (col U/V), ej. 62747. */
  subCentroCosto?: string
  /** Área Contanet (col Y), ej. 010101. */
  area?: string
  /** Marca si el centro de costo es administrativo (usa su propia cuenta, no la de proyecto). */
  esAdministrativo?: boolean
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

  @Prop({ type: Types.ObjectId, ref: 'LineaNegocio', required: false })
  lineaNegocioId?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'CategoryGroup', required: false })
  categoryGroupId?: Types.ObjectId

  @Prop({ type: Number, default: 0 })
  committedAdvanceTotal: number

  // --- Mapeo contable (asientos Contanet) ---
  @Prop({ type: String, required: false })
  cuentaAnalitica9x?: string

  @Prop({ type: String, required: false })
  cuentaDestino6x?: string

  @Prop({ type: String, required: false })
  centroCosto?: string

  @Prop({ type: String, required: false })
  subCentroCosto?: string

  @Prop({ type: String, required: false })
  area?: string

  @Prop({ type: Boolean, default: false })
  esAdministrativo?: boolean
}

export const ProjectSchema = SchemaFactory.createForClass(Project)

ProjectSchema.index({ code: 1, clientId: 1 }, { unique: true })
