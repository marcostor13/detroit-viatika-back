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
import { CreateAdvanceLineDto } from '../../advance/dto/create-advance.dto'

export class ResubmitViaticoDto {
  @IsNumber()
  @Min(1)
  amount: number

  @IsString()
  @IsNotEmpty()
  place: string

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
  startDate: string

  @IsDateString()
  endDate: string

  @IsMongoId()
  projectId: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAdvanceLineDto)
  lines: CreateAdvanceLineDto[]

  @IsString()
  @IsOptional()
  observations?: string

  /** Saldos de la bolsa re-seleccionados al corregir (si el viático no tiene ya uno). */
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
}
