import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Types } from 'mongoose'
import { InvoiceStatus } from '../dto/create-invoice.dto'
import { Document } from 'mongoose'

export interface InvoiceDocument extends Document {
  correlativo: string
  fechaEmision: string
  moneda: string
  montoTotal: number
  rucEmisor: string
  serie: string
  tipoComprobante: string
  state: string
  status: InvoiceStatus
  actaAceptacion?: string
  pdfFile?: string
  clientId: Types.ObjectId
  projectId: Types.ObjectId
  companyId: string
}

export interface GetInvoiceDocument extends Omit<InvoiceDocument, '_id'> {
  _id: string
}

@Schema({ timestamps: true })
export class Invoice {
  @Prop({ required: true })
  correlativo: string

  @Prop({ type: Date, required: false })
  fechaEmision?: Date

  @Prop({ required: true })
  moneda: string

  @Prop({ required: true })
  montoTotal: number

  @Prop({ required: true })
  rucEmisor: string

  @Prop({ required: true })
  serie: string

  @Prop({ required: true })
  tipoComprobante: string

  @Prop({
    required: true,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING',
  })
  status: string

  @Prop({
    required: true,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING',
  })
  paymentStatus: string

  @Prop({ required: true })
  state: string

  @Prop()
  actaAceptacion?: string

  @Prop()
  pdfFile?: string

  @Prop({ type: Types.ObjectId, ref: 'Client', required: false })
  clientId?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Project', required: false })
  projectId?: Types.ObjectId

  @Prop({ type: 'ObjectId', ref: 'Company', required: true })
  companyId: string
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice)

export interface Invoice {
  _id: string
  providerName: string
  invoiceNumber: string
  date: Date | string
  type: string
  status: string
  rejectionReason?: string
  createdAt: Date | string
  pdfUrl?: string
  xmlUrl?: string
  actaUrl?: string
}
