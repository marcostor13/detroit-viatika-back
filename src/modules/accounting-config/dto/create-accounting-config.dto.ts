import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  IsIn,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'
import { BankAccountDto } from './bank-account.dto'
import { IgvRateDto } from './igv-rate.dto'

export class CreateAccountingConfigDto {
  @IsString()
  @IsNotEmpty()
  clientId: string

  @IsOptional()
  @IsString()
  cuenta42?: string

  @IsOptional()
  @IsString()
  cuenta79?: string

  @IsOptional()
  @IsString()
  cuenta14Raiz?: string

  @IsOptional()
  @IsString()
  cuenta46?: string

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IgvRateDto)
  igvRates?: IgvRateDto[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  inafectoKeywords?: string[]

  @IsOptional()
  @IsString()
  codModulo?: string

  @IsOptional()
  @IsString()
  modulo?: string

  @IsOptional()
  @IsString()
  fuenteCompra?: string

  @IsOptional()
  @IsString()
  fuenteAplicacion?: string

  @IsOptional()
  @IsString()
  fuenteCajaBancos?: string

  @IsOptional()
  @IsString()
  monedaOrigen?: string

  @IsOptional()
  @IsString()
  monedaRegistro?: string

  @IsOptional()
  @IsString()
  identificadorCtrMda?: string

  @IsOptional()
  @IsString()
  conceptoFec?: string

  @IsOptional()
  @IsString()
  area?: string

  @IsOptional()
  @IsString()
  centroCosto?: string

  @IsOptional()
  @IsString()
  subCentroCosto?: string

  @IsOptional()
  @IsNumber()
  tipoCambio?: number

  @IsOptional()
  @IsIn(['14', '46'])
  cuentaReembolso?: '14' | '46'

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BankAccountDto)
  bankAccounts?: BankAccountDto[]
}
