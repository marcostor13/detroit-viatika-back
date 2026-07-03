import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator'

export class BankAccountDto {
  @IsString()
  @IsNotEmpty()
  banco: string

  @IsString()
  @IsNotEmpty()
  nroCuenta: string

  @IsString()
  @IsNotEmpty()
  cuentaContable: string

  @IsOptional()
  @IsString()
  moneda?: string

  @IsOptional()
  @IsString()
  cci?: string

  @IsOptional()
  @IsBoolean()
  activo?: boolean
}
