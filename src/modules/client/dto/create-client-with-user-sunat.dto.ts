import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { CreateClientDto } from './create-client.dto'

export class CreateClientAdminUserDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsEmail()
  @IsNotEmpty()
  email: string
}

export class CreateClientWithUserDto {
  @ValidateNested()
  @Type(() => CreateClientDto)
  @IsNotEmpty()
  client: CreateClientDto

  @ValidateNested()
  @Type(() => CreateClientAdminUserDto)
  @IsNotEmpty()
  adminUser: CreateClientAdminUserDto
}
