import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export interface BankAccount {
  bankName: string
  accountNumber: string
  cci: string
  accountType: 'ahorros' | 'corriente'
}

export interface UserPermissions {
  modules: string[]
  canApproveL1: boolean
  canApproveL2: boolean
  /** Categorías sueltas asignadas directamente (independientes de los perfiles). */
  categoryIds: string[]
  /** @deprecated usar categoryProfileIds. Se conserva para migración. */
  categoryProfileId?: string
  /** Perfiles de categoría asignados (deriva centros de costo y categorías visibles). */
  categoryProfileIds?: string[]
}

export interface UserDocument extends Document {
  _id: Types.ObjectId
  email: string
  name: string
  password: string
  clientId: Types.ObjectId
  roleId: Types.ObjectId
  isActive: boolean
  dni?: string
  employeeCode?: string
  /** Subcuenta contable 14 del colaborador (asientos Contanet). Si vacío, se usa el DNI en cols AN-AS. */
  subcuenta14?: string
  /** Área organizacional (notificaciones viáticos Fase 3). */
  area?: string
  /** Cargo del colaborador (notificaciones viáticos Fase 3). */
  cargo?: string
  address?: string
  phone?: string
  bankAccount?: BankAccount
  permissions?: UserPermissions
  signature?: string
  coordinatorId?: Types.ObjectId
  mustChangePassword?: boolean
  profilePic?: string
  isCompanyAdmin?: boolean
  emailNotificationsEnabled?: boolean
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  email: string

  @Prop({ required: true })
  name: string

  @Prop({ required: true })
  password: string

  @Prop({ ref: 'Client', alias: 'client' })
  clientId: Types.ObjectId

  @Prop({ required: true, ref: 'Role', alias: 'role' })
  roleId: Types.ObjectId

  @Prop({ default: true })
  isActive: boolean

  @Prop()
  dni?: string

  @Prop()
  employeeCode?: string

  @Prop()
  subcuenta14?: string

  @Prop()
  area?: string

  @Prop()
  cargo?: string

  @Prop()
  address?: string

  @Prop()
  phone?: string

  @Prop({
    type: {
      bankName: { type: String },
      accountNumber: { type: String },
      cci: { type: String },
      accountType: { type: String, enum: ['ahorros', 'corriente'] },
      _id: false,
    },
  })
  bankAccount?: BankAccount

  @Prop({
    type: {
      modules: { type: [String], default: [] },
      canApproveL1: { type: Boolean, default: false },
      canApproveL2: { type: Boolean, default: false },
      categoryIds: { type: [String], default: [] },
      categoryProfileId: { type: String, default: null },
      categoryProfileIds: { type: [String], default: [] },
      _id: false,
    },
    default: () => ({
      modules: [],
      canApproveL1: false,
      canApproveL2: false,
      categoryIds: [],
    }),
  })
  permissions: UserPermissions

  @Prop()
  signature?: string

  /** Coordinador / aprobador asignado (Fase 2 — solicitud de viáticos) */
  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  coordinatorId?: Types.ObjectId

  @Prop({ type: Boolean, default: false })
  mustChangePassword?: boolean

  @Prop({ type: String, required: false })
  profilePic?: string

  @Prop({ type: Boolean, default: false })
  isCompanyAdmin?: boolean

  @Prop({ type: Boolean, default: false })
  emailNotificationsEnabled?: boolean
}

export const UserSchema = SchemaFactory.createForClass(User)
// Unique per (email, clientId) — allows same email across different companies
UserSchema.index({ email: 1, clientId: 1 }, { unique: true })
