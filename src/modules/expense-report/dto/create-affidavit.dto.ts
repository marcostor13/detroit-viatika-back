import { IsArray, IsIn, IsMongoId, IsNotEmpty, IsString } from 'class-validator'

export class CreateAffidavitDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['viaticos_nacionales', 'viajes_exterior'])
  type: 'viaticos_nacionales' | 'viajes_exterior'

  @IsArray()
  @IsMongoId({ each: true })
  expenseIds: string[]
}
