import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsMongoId,
  IsArray,
  ValidateNested,
  IsDateString,
  MaxLength,
} from 'class-validator'
import { Type } from 'class-transformer'

export class CreateAdvanceLineDto {
  @IsMongoId()
  categoryId: string

  @IsString()
  @IsOptional()
  detalle?: string

  @IsNumber()
  @Min(0)
  importe: number

  @IsNumber()
  @Min(0)
  peopleCount: number

  @IsNumber()
  @Min(0)
  glpPerDay: number

  @IsNumber()
  @Min(0)
  days: number

  @IsNumber()
  @Min(0)
  lineTotal: number
}

export class CreateAdvanceDto {
  @IsNumber()
  @Min(1)
  amount: number

  @IsString()
  @IsNotEmpty()
  description: string

  @IsString()
  @IsOptional()
  expenseReportId?: string

  /** Lugar del viaje / destino (Fase 2) */
  @IsString()
  @IsOptional()
  place?: string

  @IsNumber()
  @Min(-90)
  @Max(90)
  @IsOptional()
  lat?: number

  @IsNumber()
  @Min(-180)
  @Max(180)
  @IsOptional()
  lng?: number

  @IsDateString()
  @IsOptional()
  startDate?: string

  @IsDateString()
  @IsOptional()
  endDate?: string

  @IsMongoId()
  @IsOptional()
  projectId?: string

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAdvanceLineDto)
  lines?: CreateAdvanceLineDto[]

  @IsString()
  @IsOptional()
  observations?: string

  /** Saldo trasladado desde una rendición anterior (nueva solicitud con saldo pendiente). */
  @IsMongoId()
  @IsOptional()
  pendingBalanceFromReportId?: string

  @IsNumber()
  @Min(0)
  @IsOptional()
  pendingBalanceAmount?: number

  @IsNumber()
  @Min(0)
  @IsOptional()
  additionalAmount?: number

  /** Saldos de la bolsa seleccionados para financiar esta solicitud (consumo completo, mismo centro de costo). */
  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
  saldoIds?: string[]

  /** Cuenta bancaria alternativa para el depósito (opcional). */
  @IsString()
  @IsOptional()
  @MaxLength(200)
  bankName?: string

  @IsString()
  @IsOptional()
  @MaxLength(50)
  accountNumber?: string

  @IsString()
  @IsOptional()
  @MaxLength(50)
  cci?: string

  /** Seteados desde el JWT en el controlador */
  userId?: string
  clientId?: string
}
