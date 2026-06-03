import { PartialType } from '@nestjs/mapped-types'
import { CreateExpenseReportDto } from './create-expense-report.dto'
import {
  IsOptional,
  IsMongoId,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator'
import { ExpenseReportStatus } from '../entities/expense-report.entity'

export class UpdateExpenseReportDto extends PartialType(
  CreateExpenseReportDto
) {
  @IsOptional()
  @IsIn([
    'solicited',
    'open',
    'submitted',
    'approved',
    'rejected',
    'closed',
    'cancelled',
  ])
  status?: ExpenseReportStatus

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rejectionReason?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancelReason?: string

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  expenseIds?: string[]
}
