import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  ArrayMinSize,
} from 'class-validator'
import { Type } from 'class-transformer'

export class DeclaracionJuradaRowDto {
  @IsString()
  @IsNotEmpty()
  fecha: string

  @IsNumber()
  @Min(0.01)
  monto: number
}

export class DeclaracionJuradaSeccionDto {
  @IsString()
  @IsNotEmpty()
  categoryId: string

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DeclaracionJuradaRowDto)
  rows: DeclaracionJuradaRowDto[]
}

/**
 * Crea una Declaración Jurada (DJE: viáticos por alimentación y/o movilidad en
 * viaje al exterior, sin comprobante del proveedor). Genera un gasto por sección
 * presente (Alimentación / Movilidad), vinculados por `declaracionJuradaGroupId`.
 */
export class CreateDeclaracionJuradaDto {
  @IsString()
  @IsNotEmpty()
  proyectId: string

  @IsString()
  @IsOptional()
  clientId?: string

  @IsString()
  @IsOptional()
  userId?: string

  @IsString()
  @IsOptional()
  expenseReportId?: string

  @IsString()
  @IsNotEmpty()
  moneda: string

  @IsString()
  @IsOptional()
  destino?: string

  @IsString()
  @IsOptional()
  pais?: string

  @IsString()
  @IsOptional()
  lugarFirma?: string

  @IsString()
  @IsOptional()
  imageUrl?: string

  @ValidateNested()
  @Type(() => DeclaracionJuradaSeccionDto)
  @IsOptional()
  alimentacion?: DeclaracionJuradaSeccionDto

  @ValidateNested()
  @Type(() => DeclaracionJuradaSeccionDto)
  @IsOptional()
  movilidad?: DeclaracionJuradaSeccionDto
}
