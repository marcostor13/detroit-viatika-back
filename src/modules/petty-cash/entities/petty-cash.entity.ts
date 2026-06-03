import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type PettyCashStatus =
  | 'pending_funding'
  | 'active'
  | 'closed'

export interface PettyCashFunding {
  transferDate: Date
  amount: number
  operationNumber: string
  receiptUrl: string
  registeredBy: string
  registeredAt: Date
}

export interface PettyCashExpenseEntry {
  expenseId: Types.ObjectId
  amount: number
  registeredAt: Date
  category?: string
}

export interface PettyCashDocument extends Document {
  code: string
  responsibleId: Types.ObjectId
  clientId: Types.ObjectId
  period: string
  fundAmount: number
  spentAmount: number
  maxPerExpense?: number
  maxPerDay?: number
  allowedCategories?: string[]
  status: PettyCashStatus
  funding?: PettyCashFunding
  expenses: PettyCashExpenseEntry[]
  closedAt?: Date
  closedBy?: string
}

@Schema({ timestamps: true })
export class PettyCash {
  @Prop({ required: true, unique: true })
  code: string

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  responsibleId: Types.ObjectId

  @Prop({ required: true, type: Types.ObjectId, ref: 'Client' })
  clientId: Types.ObjectId

  /** Format: AAAAMM, e.g. 202605 */
  @Prop({ required: true })
  period: string

  @Prop({ required: true })
  fundAmount: number

  @Prop({ default: 0 })
  spentAmount: number

  @Prop({ required: false })
  maxPerExpense?: number

  @Prop({ required: false })
  maxPerDay?: number

  @Prop({ type: [String], default: [] })
  allowedCategories?: string[]

  @Prop({ default: 'pending_funding' })
  status: PettyCashStatus

  @Prop({ type: Object, required: false })
  funding?: PettyCashFunding

  @Prop({
    type: [
      {
        expenseId: { type: Types.ObjectId, ref: 'Expense', required: true },
        amount: { type: Number, required: true },
        registeredAt: { type: Date, required: true },
        category: { type: String },
        _id: false,
      },
    ],
    default: [],
  })
  expenses: PettyCashExpenseEntry[]

  @Prop({ type: Date, required: false })
  closedAt?: Date

  @Prop({ required: false })
  closedBy?: string
}

export const PettyCashSchema = SchemaFactory.createForClass(PettyCash)
