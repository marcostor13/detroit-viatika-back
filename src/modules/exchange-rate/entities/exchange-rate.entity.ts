import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'

export interface ExchangeRateDocument extends Document {
  /** Fecha en formato YYYY-MM-DD. */
  fecha: string
  /** Soles (PEN) por 1 dólar (USD). Ej. 3.75. */
  tasa: number
  /** Origen de la tasa (api / fallback / manual). */
  source: string
}

@Schema({ timestamps: true })
export class ExchangeRate {
  @Prop({ required: true, unique: true })
  fecha: string

  @Prop({ required: true })
  tasa: number

  @Prop({ default: 'api' })
  source: string
}

export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate)
ExchangeRateSchema.index({ fecha: 1 }, { unique: true })
