import { IsString, IsNotEmpty, IsNumber } from 'class-validator'

export class IgvRateDto {
  @IsNumber()
  tasa: number

  @IsString()
  @IsNotEmpty()
  cuenta40: string
}
