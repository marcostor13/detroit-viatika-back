import { Test, TestingModule } from '@nestjs/testing'
import { MailerService } from '@nestjs-modules/mailer'
import { EmailService } from './email.service'

describe('EmailService', () => {
  let service: EmailService
  let mailerService: { sendMail: jest.Mock }
  const originalNodeEnv = process.env.NODE_ENV
  const originalAppPublicUrl = process.env.APP_PUBLIC_URL
  const originalFrontendUrl = process.env.FRONTEND_URL

  beforeEach(async () => {
    mailerService = { sendMail: jest.fn().mockResolvedValue(undefined) }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: MailerService, useValue: mailerService },
      ],
    }).compile()
    service = module.get<EmailService>(EmailService)
  })

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv

    if (originalAppPublicUrl === undefined) {
      delete process.env.APP_PUBLIC_URL
    } else {
      process.env.APP_PUBLIC_URL = originalAppPublicUrl
    }

    if (originalFrontendUrl === undefined) {
      delete process.env.FRONTEND_URL
    } else {
      process.env.FRONTEND_URL = originalFrontendUrl
    }
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  it('generates a 6-digit code', () => {
    const code = service.getCode()
    expect(code).toMatch(/^\d{6}$/)
  })

  it('uses the corrected production fallback URL', () => {
    delete process.env.APP_PUBLIC_URL
    delete process.env.FRONTEND_URL
    process.env.NODE_ENV = 'production'

    expect(service.getPublicAppBaseUrl()).toBe(
      'https://app.viatika.tecdidata.com'
    )
  })

  it('normalizes the legacy viatica host from env', () => {
    process.env.APP_PUBLIC_URL = 'https://app.viatica.tecdidata.com/'

    expect(service.getPublicAppBaseUrl()).toBe(
      'https://app.viatika.tecdidata.com'
    )
  })

  it('sends viatico payment email with receipt attachment', async () => {
    await service.sendViaticoPagoRealizado('colab@test.com', {
      recipientName: 'Colaborador',
      collaboratorName: 'Colaborador',
      coordinatorName: 'Coordinador',
      projectLabel: '[CC-001 - Proyecto Demo]',
      amountFormatted: '120.50',
      transferDate: '2026-05-06',
      reference: 'REF001',
      paymentMethod: 'transferencia_bancaria',
      paymentReceiptUrl: 'https://files.example.com/receipts/viatico-001.pdf',
      paymentReceiptFileName: 'viatico-001.pdf',
      platformUrl: 'https://app.viatika.tecdidata.com',
    })

    expect(mailerService.sendMail).toHaveBeenCalledTimes(1)
    expect(mailerService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'colab@test.com',
        template: './viatico-pago-realizado',
        attachments: [
          expect.objectContaining({
            filename: 'viatico-001.pdf',
            path: 'https://files.example.com/receipts/viatico-001.pdf',
          }),
        ],
      })
    )
  })

  it('formats uploaded expense invoice amounts with the currency prefix', async () => {
    await service.sendInvoiceUploadedExpenseNotification('colab@test.com', {
      providerName: 'Ivan Ruiz',
      invoiceNumber: 'F001-00001234',
      date: '11-05-2026',
      type: 'Factura Electronica',
      status: 'PENDIENTE',
      montoTotal: 3,
      moneda: 'PEN',
      category: 'Combustible',
      projectName: 'OPERACION',
      razonSocial: 'Proveedor Demo SAC',
    })

    const [mailPayload] = mailerService.sendMail.mock.calls[0] as [
      {
        to: string
        template: string
        context: {
          montoTotalFormatted: string
          category: string
        }
      },
    ]

    expect(mailPayload.to).toBe('colab@test.com')
    expect(mailPayload.template).toBe('./invoice-notification')
    expect(mailPayload.context.montoTotalFormatted).toBe('S/ 3')
    expect(mailPayload.context.category).toBe('Combustible')
  })
})
