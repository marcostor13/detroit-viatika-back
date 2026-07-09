import { PartialType } from '@nestjs/mapped-types'
import { CreateCategoryProfileDto } from './create-category-profile.dto'

export class UpdateCategoryProfileDto extends PartialType(
  CreateCategoryProfileDto
) {}
