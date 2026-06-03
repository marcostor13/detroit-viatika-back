import { PartialType } from '@nestjs/mapped-types'
import { CreateSunatConfigDto } from './create-sunat-config.dto'

export class UpdateSunatConfigDto extends PartialType(CreateSunatConfigDto) {}
