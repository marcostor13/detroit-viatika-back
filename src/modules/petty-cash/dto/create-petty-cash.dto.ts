import { IsString, IsNumber, IsMongoId, IsOptional, Min, Matches, IsArray } from 'class-validator'

export class CreatePettyCashDto {
  @IsMongoId()
  responsibleId: string

  @IsMongoId()
  clientId: string

  /** AAAAMM format, e.g. 202605 */
  @IsString()
  @Matches(/^\d{6}$/, { message: 'El período debe tener formato AAAAMM (ej: 202605)' })
  period: string

  @IsNumber()
  @Min(1)
  fundAmount: number

  @IsNumber()
  @IsOptional()
  @Min(0)
  maxPerExpense?: number

  @IsNumber()
  @IsOptional()
  @Min(0)
  maxPerDay?: number

  @IsArray()
  @IsOptional()
  allowedCategories?: string[]
}
