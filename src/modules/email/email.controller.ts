import { Controller, Get, Post, Body } from '@nestjs/common'
import { EmailService } from './email.service'
import { SendCodeDto } from './dto/send-code.dto'
import { SendInvoiceNotificationDto } from './dto/send-invoice-notification.dto'

@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post('send-code')
  sendCodeConfirmation(@Body() sendCodeDto: SendCodeDto) {
    return this.emailService.sendCodeConfirmation(sendCodeDto.email)
  }

  @Post('send-invoice-notification')
  sendInvoiceNotification(
    @Body() sendInvoiceNotificationDto: SendInvoiceNotificationDto
  ) {
    return this.emailService.sendInvoiceNotification(
      sendInvoiceNotificationDto.email,
      {
        providerName: sendInvoiceNotificationDto.providerName,
        invoiceNumber: sendInvoiceNotificationDto.invoiceNumber,
        date: sendInvoiceNotificationDto.date,
        type: sendInvoiceNotificationDto.type,
      }
    )
  }

  @Post('send-payment-scheduled')
  sendPaymentScheduledNotification(
    @Body() data: { email: string; invoiceNumber: string; paymentDate: string }
  ) {
    return this.emailService.sendPaymentScheduledNotification(
      data.email,
      data.invoiceNumber,
      data.paymentDate
    )
  }

  @Post('send-accounting-decision')
  sendAccountingDecisionNotification(
    @Body()
    data: {
      email: string
      providerName: string
      invoiceNumber: string
      date: string
      type: string
      status: 'APPROVED' | 'REJECTED'
      rejectionReason?: string
    }
  ) {
    return this.emailService.sendInvoiceDecisionNotification(data.email, {
      providerName: data.providerName,
      invoiceNumber: data.invoiceNumber,
      date: data.date,
      type: data.type,
      status: data.status,
      rejectionReason: data.rejectionReason,
    })
  }
}
