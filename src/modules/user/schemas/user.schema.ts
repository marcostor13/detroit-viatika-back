import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export interface BankAccount {
  bankName: string
  accountNumber: string
  cci: string
  accountType: 'ahorros' | 'corriente'
}

/** Tipo de documento para el archivo de pagos BBVA (VD-7). */
export type UserDocumentType = 'R' | 'L' | 'P' | 'E' | 'M'

export interface UserPermissions {
  modules: string[]
  canApproveL1: boolean
  canApproveL2: boolean
  /** Categorías sueltas asignadas directamente al usuario. */
  categoryIds: string[]
  /**
   * Centros de costo (Project) asignados al colaborador. `primaryProjectId`
   * es la marca explícita del principal; si no está definida, se usa
   * `projectIds[0]` como fallback (retrocompatibilidad).
   */
  projectIds: string[]
  /** Centro de costo principal explícito. Debe estar contenido en `projectIds`. */
  primaryProjectId?: string
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
  /** Tipo de documento para pagos BBVA (R=RUC, L=DNI, P=Pasaporte, E=C.Ext., M=C.Mil.). Default L. */
  documentType?: UserDocumentType
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
  /** @deprecated usar approverIds. Se conserva para migración. */
  coordinatorId?: Types.ObjectId
  /** Cadena ordenada de aprobadores (rol Coordinador) para anticipos/viáticos. */
  approverIds?: Types.ObjectId[]
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

  /** Tipo de documento para el archivo de pagos BBVA. Default L (DNI). */
  @Prop({ type: String, enum: ['R', 'L', 'P', 'E', 'M'], default: 'L' })
  documentType?: UserDocumentType

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
      projectIds: { type: [String], default: [] },
      primaryProjectId: { type: String, required: false },
      _id: false,
    },
    default: () => ({
      modules: [],
      canApproveL1: false,
      canApproveL2: false,
      categoryIds: [],
      projectIds: [],
    }),
  })
  permissions: UserPermissions

  @Prop()
  signature?: string

  /** @deprecated Coordinador único legacy. Usar approverIds. Se conserva para migración. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  coordinatorId?: Types.ObjectId

  /** Cadena ordenada de aprobadores (rol Coordinador) para anticipos/viáticos. */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: undefined })
  approverIds?: Types.ObjectId[]

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
