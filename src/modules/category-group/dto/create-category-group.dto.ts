import {
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator'

export class CreateCategoryGroupDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsString()
  @IsOptional()
  description?: string

  @IsString()
  @IsNotEmpty()
  clientId: string

  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
  categoryIds?: string[]
}
