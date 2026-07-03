import { IsOptional, IsString } from 'class-validator'

export class DashboardQueryDto {
  @IsOptional()
  @IsString()
  dateFrom?: string

  @IsOptional()
  @IsString()
  dateTo?: string

  @IsOptional()
  @IsString()
  projectId?: string

  @IsOptional()
  @IsString()
  categoryId?: string

  @IsOptional()
  @IsString()
  collaboratorId?: string
}
