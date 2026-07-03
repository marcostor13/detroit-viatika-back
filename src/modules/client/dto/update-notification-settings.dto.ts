import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, Max, Min } from 'class-validator'

export class UpdateNotificationSettingsDto {
  @IsBoolean()
  @IsNotEmpty()
  enabled: boolean

  @IsIn(['semanal', 'mensual'])
  @IsNotEmpty()
  frequency: 'semanal' | 'mensual'

  /** Día de la semana para las notificaciones semanales: 0=Dom … 6=Sáb (default 1=Lunes). */
  @IsInt()
  @Min(0)
  @Max(6)
  @IsOptional()
  notificationDay?: number
}
