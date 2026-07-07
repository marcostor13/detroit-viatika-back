import {
  IsBoolean,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator'

export class CreateOrdenTrabajoDto {
  /** Nombre/código de la OT (ej. "Lim-Com-1"). Único por empresa. */
  @IsString()
  @IsNotEmpty()
  nombre: string

  /** Centro de costo (Project) al que pertenece la OT. */
  @IsMongoId()
  @IsNotEmpty()
  costCenterId: string

  @IsBoolean()
  @IsOptional()
  isActive?: boolean

  @IsString()
  @IsOptional()
  clientId?: string
}
