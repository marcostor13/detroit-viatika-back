import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'

export type AuditLogDocument = AuditLog & Document

export type AuditAction =
  | 'login'
  | 'create_invoice'
  | 'approve_invoice'
  | 'reject_invoice'
  | 'delete_invoice'
  | 'create_mobility_sheet'
  | 'create_other_expense'
  | 'create_rendicion'
  | 'create_rendicion_directa_deposito'
  | 'create_saldo_pago'
  | 'delete_rendicion'
  | 'update_rendicion_status'
  | 'reopen_rendicion'
  | 'register_reimbursement_payment'
  | 'approve_advance_l1'
  | 'approve_advance_l2'
  | 'reject_advance'
  | 'resubmit_advance'
  | 'resend_coordinator_notification'
  | 'pay_advance'
  | 'create_user'
  | 'update_user'
  | 'update_permissions'
  | 'update_signature'
  | 'generate_affidavit'
  | 'reset_password'
  | 'create_project'
  | 'update_project'
  | 'delete_project'
  | 'bulk_import_projects'
  | 'bulk_import_users'
  | 'create_category'
  | 'update_category'
  | 'delete_category'
  | 'import_categories'
  | 'create_category_group'
  | 'update_category_group'
  | 'delete_category_group'
  | 'close_rendicion'
  | 'approve_reopen_rendicion'
  | 'reject_reopen_rendicion'
  | 'create_petty_cash'
  | 'fund_petty_cash'
  | 'close_petty_cash'
  | 'cancel_rendicion'
  | 'cancel_advance'
  | 'delete_advance'
  | 'update_email_notifications'
  | 'create_linea_negocio'
  | 'update_linea_negocio'
  | 'delete_linea_negocio'
  | 'create_caja_chica_report'
  | 'add_reports_caja_chica'
  | 'remove_report_caja_chica'
  | 'finalize_caja_chica_report'
  | 'upsert_accounting_config'
  | 'download_accounting_entries'
  | 'update_expense_desglose'
  | 'create_viatico'
  | 'approve_viatico_l1'
  | 'approve_viatico_l2'
  | 'reject_viatico'
  | 'resubmit_viatico'
  | 'register_viatico_payment'
  | 'cancel_viatico'

@Schema({ timestamps: true })
export class AuditLog {
  @Prop({ required: true })
  userId: string

  @Prop({ required: true })
  userName: string

  @Prop({ required: true })
  action: AuditAction

  @Prop({ required: true })
  module: string

  @Prop()
  entityId?: string

  @Prop()
  details?: string

  @Prop()
  clientId?: string

  @Prop()
  ip?: string

  createdAt: Date
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog)
