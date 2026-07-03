import { PartialType } from '@nestjs/mapped-types'
import { CreateLineaNegocioDto } from './create-linea-negocio.dto'

export class UpdateLineaNegocioDto extends PartialType(CreateLineaNegocioDto) {}
