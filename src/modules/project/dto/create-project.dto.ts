import {
  ArrayNotEmpty,
  IsBoolean,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

export class ApproverLevelDto {
  @IsInt()
  @Min(1)
  level: number

  @IsMongoId({ each: true })
  @ArrayNotEmpty()
  userIds: string[]
}

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsString()
  @IsOptional()
  code?: string

  @IsBoolean()
  @IsOptional()
  isActive?: boolean

  @IsString()
  @IsNotEmpty()
  clientId: string

  @IsString()
  @IsOptional()
  clientName?: string

  @IsString()
  @IsOptional()
  lineaNegocioId?: string

  // --- Mapeo contable (asientos Contanet) ---
  @IsString()
  @IsOptional()
  cuentaAnalitica9x?: string

  @IsString()
  @IsOptional()
  cuentaDestino6x?: string

  @IsString()
  @IsOptional()
  centroCosto?: string

  @IsString()
  @IsOptional()
  subCentroCosto?: string

  @IsString()
  @IsOptional()
  area?: string

  @IsBoolean()
  @IsOptional()
  esAdministrativo?: boolean

  /** @deprecated usar approverLevels (nivel 2). */
  @IsMongoId()
  @IsOptional()
  approverId?: string

  /** Aprobadores por nivel explícito (N1, N2, N3…) de este centro de costo. */
  @ValidateNested({ each: true })
  @Type(() => ApproverLevelDto)
  @IsOptional()
  approverLevels?: ApproverLevelDto[]
}
