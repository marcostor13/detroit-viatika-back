import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { AsientoTipo, CuadreError } from './accounting-entries.types'

/**
 * Caché de archivos de asientos contables ya generados.
 * Evita reejecutar IA + tipo de cambio + ExcelJS en descargas repetidas.
 * Se invalida por `fingerprint`: si cambia la rendición, sus gastos, los
 * anticipos o la configuración contable, el fingerprint cambia y se regenera.
 */
export interface AccountingEntriesCacheDocument extends Document {
  reportId: Types.ObjectId
  clientId: Types.ObjectId
  tipo: AsientoTipo
  /** Hash de invalidación (updatedAt de report/expenses/advances/config). */
  fingerprint: string
  filename: string
  /** Bytes del .xlsx (archivos de pocos KB, muy por debajo del límite de 16MB). */
  buffer: Buffer
  asientosCount: number
  cuadreErrors: CuadreError[]
}

@Schema({ timestamps: true })
export class AccountingEntriesCache {
  @Prop({ required: true, type: Types.ObjectId, ref: 'ExpenseReport', index: true })
  reportId: Types.ObjectId

  @Prop({ required: true, type: Types.ObjectId, ref: 'Client' })
  clientId: Types.ObjectId

  @Prop({ required: true })
  tipo: AsientoTipo

  @Prop({ required: true })
  fingerprint: string

  @Prop({ required: true })
  filename: string

  @Prop({ required: true, type: Buffer })
  buffer: Buffer

  @Prop({ required: true, default: 0 })
  asientosCount: number

  @Prop({ type: Array, default: [] })
  cuadreErrors: CuadreError[]
}

export const AccountingEntriesCacheSchema = SchemaFactory.createForClass(
  AccountingEntriesCache
)

// Una entrada por (rendición, tipo). El fingerprint se actualiza in-place.
AccountingEntriesCacheSchema.index({ reportId: 1, tipo: 1 }, { unique: true })
// Entradas expiradas se eliminan automáticamente después de 90 días.
AccountingEntriesCacheSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 })
