import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type CajaChicaReportStatus = 'draft' | 'finalized'

export interface SelectedReport {
  expenseReportId: Types.ObjectId
  colaboradorId: Types.ObjectId
  colaboradorName: string
}

export interface CajaChicaReportDocument extends Document {
  codigo: string
  title: string
  clientId: Types.ObjectId
  createdBy: Types.ObjectId
  status: CajaChicaReportStatus
  selectedReports: SelectedReport[]
  totalAmount: number
}

@Schema({ timestamps: true })
export class CajaChicaReport {
  @Prop({ required: true })
  codigo: string

  @Prop({ required: true })
  title: string

  @Prop({ required: true, type: Types.ObjectId, ref: 'Client' })
  clientId: Types.ObjectId

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId

  @Prop({ default: 'draft' })
  status: CajaChicaReportStatus

  @Prop({
    type: [
      {
        expenseReportId: {
          type: Types.ObjectId,
          ref: 'ExpenseReport',
          required: true,
        },
        colaboradorId: { type: Types.ObjectId, ref: 'User', required: true },
        colaboradorName: { type: String, required: true },
        _id: false,
      },
    ],
    default: [],
  })
  selectedReports: SelectedReport[]

  @Prop({ default: 0 })
  totalAmount: number
}

export const CajaChicaReportSchema =
  SchemaFactory.createForClass(CajaChicaReport)

CajaChicaReportSchema.index({ clientId: 1, codigo: 1 }, { unique: true })

// Para resolver rápido si una rendición está incluida en un reporte finalizado
// (bloqueo de "subir más gastos" cuando Contabilidad ya finalizó la caja chica).
CajaChicaReportSchema.index({ status: 1, 'selectedReports.expenseReportId': 1 })
