import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator'

export class CreateSunatConfigDto {
  @IsString()
  @IsNotEmpty()
  clientId: string

  @IsString()
  @IsNotEmpty()
  clientIdSunat: string

  @IsString()
  @IsNotEmpty()
  clientSecret: string

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}
