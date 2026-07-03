import {
  IsString,
  IsEmail,
  IsOptional,
  IsBoolean,
  IsMongoId,
  IsArray,
  ValidateNested,
  IsEnum,
} from 'class-validator'
import { Type } from 'class-transformer'

class UpdateBankAccountDto {
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

export class UpdatePermissionsDto {
  @IsArray()
  @IsOptional()
  modules?: string[]

  @IsBoolean()
  @IsOptional()
  canApproveL1?: boolean

  @IsBoolean()
  @IsOptional()
  canApproveL2?: boolean

  @IsArray()
  @IsOptional()
  categoryIds?: string[]

  @IsString()
  @IsOptional()
  categoryProfileId?: string

  @IsArray()
  @IsOptional()
  categoryProfileIds?: string[]
}

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  name?: string

  @IsEmail()
  @IsOptional()
  email?: string

  @IsString()
  @IsOptional()
  password?: string

  @IsMongoId()
  @IsOptional()
  roleId?: string

  @IsBoolean()
  @IsOptional()
  isActive?: boolean

  @IsMongoId()
  @IsOptional()
  clientId?: string

  @IsString()
  @IsOptional()
  dni?: string

  @IsString()
  @IsOptional()
  employeeCode?: string

  @IsString()
  @IsOptional()
  subcuenta14?: string

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

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePermissionsDto)
  permissions?: UpdatePermissionsDto

  @IsString()
  @IsOptional()
  signature?: string

  @IsMongoId()
  @IsOptional()
  coordinatorId?: string | null

  @IsBoolean()
  @IsOptional()
  mustChangePassword?: boolean

  @IsString()
  @IsOptional()
  profilePic?: string

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateBankAccountDto)
  bankAccount?: UpdateBankAccountDto

  @IsBoolean()
  @IsOptional()
  emailNotificationsEnabled?: boolean
}
