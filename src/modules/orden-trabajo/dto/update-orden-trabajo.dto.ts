import { IsBoolean, IsOptional, IsString } from 'class-validator'

/**
 * A propósito NO extiende CreateOrdenTrabajoDto: el departamento y el
 * correlativo (y por tanto el código) son inmutables una vez generada la OT,
 * para no romper la unicidad ni la estructura LIM-XXX-NNNNNN ya comunicada.
 */
export class UpdateOrdenTrabajoDto {
  @IsString()
  @IsOptional()
  descripcion?: string

  @IsBoolean()
  @IsOptional()
  isActive?: boolean
}
