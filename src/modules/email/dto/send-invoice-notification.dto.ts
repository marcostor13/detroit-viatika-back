import { IsString, IsNotEmpty, IsEmail } from 'class-validator'

export class SendInvoiceNotificationDto {
  @IsEmail()
  @IsNotEmpty()
  email: string

  @IsString()
  @IsNotEmpty()
  providerName: string

  @IsString()
  @IsNotEmpty()
  invoiceNumber: string

  @IsString()
  @IsNotEmpty()
  date: string

  @IsString()
  @IsNotEmpty()
  type: string
}
