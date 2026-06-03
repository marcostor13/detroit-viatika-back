import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator'
import { ExpenseStatus } from '../entities/expense.entity'

export class ApprovalDto {
  @IsEnum(['pending', 'approved', 'rejected'])
  @IsNotEmpty()
  status: ExpenseStatus

  @IsString()
  @IsOptional()
  userId?: string

  @IsString()
  @IsOptional()
  reason?: string
}
