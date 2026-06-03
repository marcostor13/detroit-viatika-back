import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export enum InvoiceStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PAID = 'PAID',
}

@Schema()
export class Invoice extends Document {
  @Prop({ required: true })
  providerName: string

  @Prop({ required: true })
  invoiceNumber: string

  @Prop({ required: true })
  date: Date

  @Prop({ required: true })
  type: string

  @Prop({ required: true, enum: InvoiceStatus })
  status: InvoiceStatus

  @Prop({ required: false })
  rejectionReason?: string

  @Prop({ required: true, default: Date.now })
  createdAt: Date

  @Prop({ required: false })
  pdfUrl?: string

  @Prop({ required: false })
  xmlUrl?: string

  @Prop({ required: false })
  actaUrl?: string

  @Prop({ required: true, type: Types.ObjectId, ref: 'Client' })
  clientId: Types.ObjectId

  @Prop({ required: false, type: Date })
  fechaEmision?: Date
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice)
