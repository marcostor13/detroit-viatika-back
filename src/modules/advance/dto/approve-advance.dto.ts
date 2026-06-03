import { IsString, IsOptional, MinLength } from 'class-validator'

export class ApproveAdvanceDto {
  @IsString()
  @IsOptional()
  notes?: string

  // Seteado desde el JWT
  approvedBy?: string
}

export class RejectAdvanceDto {
  @IsString()
  @MinLength(10, {
    message: 'La observación de rechazo debe tener al menos 10 caracteres.',
  })
  rejectionReason: string

  // Seteado desde el JWT
  rejectedBy?: string
}
