import { IsArray, IsMongoId } from 'class-validator'

export class AddReportsDto {
  @IsArray()
  @IsMongoId({ each: true })
  reportIds: string[]
}
