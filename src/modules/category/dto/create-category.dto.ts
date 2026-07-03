import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsBoolean,
  IsNumber,
  Min,
  IsArray,
} from 'class-validator'

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsString()
  @IsOptional()
  key?: string

  @IsString()
  @IsOptional()
  description?: string

  @IsString()
  @IsOptional()
  cuenta?: string

  @IsString()
  @IsOptional()
  cuentaDestino6x?: string

  @IsString()
  @IsOptional()
  observaciones?: string

  @IsBoolean()
  @IsOptional()
  isActive?: boolean

  @IsNumber()
  @Min(0)
  @IsOptional()
  limit?: number | null

  @IsString()
  @IsNotEmpty()
  clientId: string

  /** Perfiles de categoría a los que pertenece (M:N). */
  @IsArray()
  @IsOptional()
  perfilIds?: string[]
}
