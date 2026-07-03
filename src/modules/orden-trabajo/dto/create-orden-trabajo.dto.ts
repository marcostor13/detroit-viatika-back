import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator'
import { OT_DEPARTAMENTO_CODES } from '../constants/orden-trabajo.constants'

export class CreateOrdenTrabajoDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(OT_DEPARTAMENTO_CODES)
  departamento: string

  @IsString()
  @IsOptional()
  descripcion?: string

  @IsBoolean()
  @IsOptional()
  isActive?: boolean

  @IsString()
  @IsOptional()
  clientId?: string
}
