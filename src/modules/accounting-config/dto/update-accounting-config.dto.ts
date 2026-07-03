import { PartialType } from '@nestjs/mapped-types'
import { CreateAccountingConfigDto } from './create-accounting-config.dto'

export class UpdateAccountingConfigDto extends PartialType(
  CreateAccountingConfigDto
) {}
