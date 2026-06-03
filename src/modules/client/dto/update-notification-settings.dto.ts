import { IsBoolean, IsIn, IsNotEmpty } from 'class-validator'

export class UpdateNotificationSettingsDto {
  @IsBoolean()
  @IsNotEmpty()
  enabled: boolean

  @IsIn(['semanal', 'mensual'])
  @IsNotEmpty()
  frequency: 'semanal' | 'mensual'
}
