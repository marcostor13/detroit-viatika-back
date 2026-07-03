import { IsString, IsOptional, IsMongoId } from 'class-validator'

export class CreateCajaChicaReportDto {
  @IsString()
  title: string

  @IsMongoId()
  @IsOptional()
  clientId?: string
}
