import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class CreateLineaNegocioDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsString()
  @IsNotEmpty()
  code: string

  @IsBoolean()
  @IsOptional()
  isActive?: boolean

  @IsString()
  @IsOptional()
  clientId?: string
}
