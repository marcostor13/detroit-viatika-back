import {
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator'

export class CreateCategoryProfileDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsString()
  @IsOptional()
  description?: string

  @IsArray()
  @IsOptional()
  @IsMongoId({ each: true })
  categoryIds?: string[]

  @IsString()
  @IsNotEmpty()
  clientId: string
}
