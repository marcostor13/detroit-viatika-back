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
} from 'class-validator'
import { Type } from 'class-transformer'
import { CreateAdvanceLineDto } from './create-advance.dto'

/** Reenvío tras rechazo — mismos datos que solicitud viático (Fase 3). */
export class ResubmitAdvanceDto {
  @IsNumber()
  @Min(0.01)
  amount: number

  @IsString()
  @IsNotEmpty()
  description: string

  @IsString()
  place: string

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

  @IsString()
  @IsOptional()
  observations?: string
}
