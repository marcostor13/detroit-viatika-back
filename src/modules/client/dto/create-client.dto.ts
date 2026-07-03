import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  ValidateNested,
  IsEmail,
  ValidateIf,
  IsArray,
} from 'class-validator'
import { Type } from 'class-transformer'

class ClientLimitsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  movilidadDiario?: number
}

export class CreateClientDto {
  @IsNotEmpty()
  @IsString()
  codigo: string

  @IsNotEmpty()
  @IsString()
  comercialName: string

  @IsString()
  businessName: string

  @IsString()
  businessId: string //ruc

  @IsOptional()
  @IsString()
  address?: string

  @IsOptional()
  @IsString()
  phone?: string

  @IsOptional()
  @ValidateIf(o => typeof o.email === 'string' && o.email.trim() !== '')
  @IsEmail()
  email?: string

  @IsOptional()
  @IsString()
  logo?: string

  @IsOptional()
  @ValidateNested()
  @Type(() => ClientLimitsDto)
  limits?: ClientLimitsDto

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  tesoreriaEmails?: string[]
}
