import { IsNotEmpty, IsOptional, IsString, IsBoolean, IsNumber, Min } from 'class-validator'

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
}
