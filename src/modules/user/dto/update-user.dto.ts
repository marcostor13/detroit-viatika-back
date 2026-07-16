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

  /**
   * Centros de costo asignados. El orden ya no determina el principal de forma
   * implícita — ver `primaryProjectId`. Se mantiene `projectIds[0]` como
   * fallback si `primaryProjectId` no está definido (retrocompatibilidad).
   */
  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
  projectIds?: string[]

  /** Centro de costo principal explícito. Debe estar contenido en `projectIds`. */
  @IsMongoId()
  @IsOptional()
  primaryProjectId?: string
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

  /** Tipo de documento para pagos BBVA (R/L/P/E/M). Default L. */
  @IsEnum(['R', 'L', 'P', 'E', 'M'])
  @IsOptional()
  documentType?: 'R' | 'L' | 'P' | 'E' | 'M'

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

  /** @deprecated usar approverIds. Se conserva para migración. */
  @IsMongoId()
  @IsOptional()
  coordinatorId?: string | null

  /** Cadena ordenada de aprobadores (rol Coordinador) para anticipos/viáticos. */
  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
  approverIds?: string[]

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
