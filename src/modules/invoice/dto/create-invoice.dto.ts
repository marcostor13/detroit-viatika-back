import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsDate,
  IsEnum,
  IsMongoId,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator'
import { Type } from 'class-transformer'

export enum InvoiceStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export class InvoiceItemDto {
  @IsString()
  @IsNotEmpty()
  description: string

  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  quantity: number

  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  unitPrice: number

  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  subtotal: number
}

export class CreateInvoiceDto {
  @IsOptional()
  @IsMongoId()
  clientId?: string

  @IsOptional()
  @IsMongoId()
  projectId?: string

  @IsString()
  @IsNotEmpty()
  invoiceNumber: string

  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  issueDate: Date

  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  dueDate: Date

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  @IsNotEmpty()
  items: InvoiceItemDto[]

  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  subtotal: number

  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  taxRate: number

  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  taxAmount: number

  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  total: number

  @IsEnum(['PENDING', 'APPROVED', 'REJECTED'])
  @IsOptional()
  status?: string

  @IsString()
  @IsOptional()
  notes?: string

  @IsBoolean()
  @IsOptional()
  isActive?: boolean
}
