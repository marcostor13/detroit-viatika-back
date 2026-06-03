import { IsString, IsOptional, IsEnum, IsNumber, IsArray } from 'class-validator'
import { ExpenseStatus, MobilityRow } from '../entities/expense.entity'

export class UpdateExpenseDto {
  @IsString()
  @IsOptional()
  proyectId?: string

  @IsString()
  @IsOptional()
  categoryId?: string

  @IsString()
  @IsOptional()
  data?: string

  @IsNumber()
  @IsOptional()
  total?: number

  @IsString()
  @IsOptional()
  description?: string

  @IsString()
  @IsOptional()
  fechaEmision?: string

  @IsEnum([
    'pending',
    'approved',
    'rejected',
    'sunat_valid',
    'sunat_valid_not_ours',
    'sunat_not_found',
    'sunat_error',
  ])
  @IsOptional()
  status?: ExpenseStatus

  @IsString()
  @IsOptional()
  clientId?: string

  @IsString()
  @IsOptional()
  rejectionReason?: string

  @IsString()
  @IsOptional()
  approvedBy?: string

  @IsString()
  @IsOptional()
  rejectedBy?: string

  @IsOptional()
  statusDate?: Date

  @IsString()
  @IsOptional()
  comentario?: string

  @IsString()
  @IsOptional()
  placaVehiculo?: string

  @IsArray()
  @IsOptional()
  mobilityRows?: MobilityRow[]
}
