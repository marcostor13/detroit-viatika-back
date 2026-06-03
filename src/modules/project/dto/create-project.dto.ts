import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsString()
  @IsOptional()
  code?: string

  @IsBoolean()
  @IsOptional()
  isActive?: boolean

  @IsString()
  @IsNotEmpty()
  clientId: string

  @IsString()
  @IsOptional()
  clientName?: string
}
