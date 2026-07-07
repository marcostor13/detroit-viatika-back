import { IsBoolean, IsMongoId, IsOptional, IsString } from 'class-validator'

/**
 * Todos los campos son opcionales: se puede renombrar la OT (se revalida la
 * unicidad por empresa), reasignarla a otro centro de costo o activarla /
 * desactivarla. No hay correlativo ni código autogenerado que preservar.
 */
export class UpdateOrdenTrabajoDto {
  @IsString()
  @IsOptional()
  nombre?: string

  @IsMongoId()
  @IsOptional()
  costCenterId?: string

  @IsBoolean()
  @IsOptional()
  isActive?: boolean
}
