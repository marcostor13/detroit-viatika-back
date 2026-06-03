import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsMongoId,
  MinLength,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsEnum,
} from 'class-validator'
import { Type } from 'class-transformer'

class CreateBankAccountDto {
  @IsString()
  @IsOptional()
  bankName?: string

  @IsString()
  @IsOptional()
  accountNumber?: string

  @IsString()
  @IsOptional()
  cci?: string

  @IsEnum(['ahorros', 'corriente'])
  @IsOptional()
  accountType?: 'ahorros' | 'corriente'
}

class CreatePermissionsDto {
  @IsArray()
  @IsOptional()
  modules?: string[]

  @IsBoolean()
  @IsOptional()
  canApproveL1?: boolean

  @IsBoolean()
  @IsOptional()
  canApproveL2?: boolean
}

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsNotEmpty()
  email: string

  @IsString()
  @MinLength(6)
  @IsOptional()
  password?: string

  @IsNotEmpty()
  roleId: string

  @IsString()
  @IsMongoId()
  @IsNotEmpty()
  clientId: string

  @IsBoolean()
  @IsOptional()
  isActive?: boolean

  @IsString()
  @IsOptional()
  dni?: string

  @IsString()
  @IsOptional()
  employeeCode?: string

  @IsString()
  @IsOptional()
  area?: string

  @IsString()
  @IsOptional()
  cargo?: string

  @IsString()
  @IsOptional()
  address?: string

  @IsString()
  @IsOptional()
  phone?: string

  @IsMongoId()
  @IsOptional()
  coordinatorId?: string

  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePermissionsDto)
  permissions?: CreatePermissionsDto

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateBankAccountDto)
  bankAccount?: CreateBankAccountDto

  @IsBoolean()
  @IsOptional()
  isCompanyAdmin?: boolean
}
