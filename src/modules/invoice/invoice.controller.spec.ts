import { Test, TestingModule } from '@nestjs/testing'
import { HttpException } from '@nestjs/common'
import { Types } from 'mongoose'
import { InvoiceController } from './invoice.controller'
import { InvoiceService } from './invoice.service'
import { AuditLogService } from '../audit-log/audit-log.service'
import { InvoiceStatus } from './dto/create-invoice.dto'

const invoiceId = new Types.ObjectId().toHexString()
const companyId = new Types.ObjectId().toHexString()
const clientId = new Types.ObjectId().toHexString()
const userId = new Types.ObjectId().toHexString()

const makeReq = (overrides: Record<string, unknown> = {}) => ({
  user: {
    _id: userId,
    sub: userId,
    name: 'Admin',
    email: 'admin@test.com',
    clientId,
    companyId,
    ...overrides,
  },
})

const makeInvoice = () => ({
  _id: invoiceId,
  companyId,
  serie: 'F001',
  correlativo: '00001',
  status: 'PENDING',
  pdfFile: null,
})

const mockService = {
  generateTokenSunat: jest.fn().mockResolvedValue({ access_token: 'token123' }),
  validateInvoiceFromImage: jest
    .fn()
    .mockResolvedValue({ rucEmisor: '12345678901' }),
  create: jest.fn().mockResolvedValue(makeInvoice()),
  findAll: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(makeInvoice()),
  findByClient: jest.fn().mockResolvedValue([makeInvoice()]),
  findByProject: jest.fn().mockResolvedValue([makeInvoice()]),
  update: jest.fn().mockResolvedValue(makeInvoice()),
  updateStatus: jest.fn().mockResolvedValue(makeInvoice()),
  remove: jest.fn().mockResolvedValue(undefined),
  uploadActaAceptacion: jest.fn().mockResolvedValue(makeInvoice()),
  downloadActaAceptacion: jest.fn().mockResolvedValue({
    buffer: Buffer.from('pdf'),
    filename: 'acta.pdf',
  }),
  uploadInvoiceAndActa: jest.fn().mockResolvedValue(makeInvoice()),
  rejectInvoice: jest.fn().mockResolvedValue(undefined),
  updatePaymentStatus: jest.fn().mockResolvedValue(undefined),
}

const mockAuditLogService = { log: jest.fn().mockResolvedValue(undefined) }

describe('InvoiceController', () => {
  let controller: InvoiceController

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvoiceController],
      providers: [
        { provide: InvoiceService, useValue: mockService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile()
    controller = module.get<InvoiceController>(InvoiceController)
  })

  describe('getToken', () => {
    it('retorna el token de SUNAT', async () => {
      const result = await controller.getToken()
      expect(mockService.generateTokenSunat).toHaveBeenCalled()
      expect(result).toEqual({ access_token: 'token123' })
    })
  })

  describe('create', () => {
    it('crea la factura y registra auditoria', async () => {
      const req = makeReq()
      const dto: any = { rucEmisor: '12345678901' }
      const result = await controller.create(dto, req as never)
      expect(mockService.create).toHaveBeenCalledWith(dto, clientId)
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create_invoice',
          module: 'invoices',
        })
      )
      expect(result).toBeDefined()
    })
  })

  describe('findAll', () => {
    it('retorna todas las facturas del cliente', async () => {
      const req = makeReq()
      await controller.findAll(req as never, {})
      expect(mockService.findAll).toHaveBeenCalledWith(clientId, {})
    })
  })

  describe('findOne', () => {
    it('retorna una factura por id', async () => {
      const req = makeReq()
      await controller.findOne(invoiceId, req as never)
      expect(mockService.findOne).toHaveBeenCalledWith(invoiceId, clientId)
    })
  })

  describe('findByClient', () => {
    it('retorna facturas por cliente', async () => {
      await controller.findByClient(clientId)
      expect(mockService.findByClient).toHaveBeenCalledWith(clientId)
    })
  })

  describe('findByProject', () => {
    it('retorna facturas por proyecto', async () => {
      await controller.findByProject('proj1')
      expect(mockService.findByProject).toHaveBeenCalledWith('proj1')
    })
  })

  describe('update', () => {
    it('actualiza la factura', async () => {
      const req = makeReq()
      await controller.update(invoiceId, {} as any, req as never)
      expect(mockService.update).toHaveBeenCalledWith(invoiceId, {}, companyId)
    })
  })

  describe('updateStatus', () => {
    it('aprueba la factura y registra auditoria con approve_invoice', async () => {
      const req = makeReq()
      await controller.updateStatus(
        invoiceId,
        { status: InvoiceStatus.APPROVED },
        req as never
      )
      expect(mockService.updateStatus).toHaveBeenCalledWith(
        invoiceId,
        InvoiceStatus.APPROVED,
        companyId,
        undefined
      )
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'approve_invoice' })
      )
    })

    it('rechaza la factura y registra auditoria con reject_invoice', async () => {
      const req = makeReq()
      await controller.updateStatus(
        invoiceId,
        { status: InvoiceStatus.REJECTED, reason: 'Error en datos' },
        req as never
      )
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'reject_invoice' })
      )
    })
  })

  describe('remove', () => {
    it('elimina la factura y registra auditoria', async () => {
      const req = makeReq()
      await controller.remove(invoiceId, req as never)
      expect(mockService.remove).toHaveBeenCalledWith(invoiceId, companyId)
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete_invoice' })
      )
    })
  })

  describe('validateInvoice', () => {
    it('lanza HttpException si no se recibe archivo', async () => {
      await expect(
        controller.validateInvoice(undefined as any)
      ).rejects.toThrow(HttpException)
    })

    it('lanza HttpException si el buffer esta vacio', async () => {
      const file = { originalname: 'test.pdf', size: 0, buffer: null } as any
      await expect(controller.validateInvoice(file)).rejects.toThrow(
        HttpException
      )
    })

    it('procesa el archivo y retorna el resultado de validacion', async () => {
      const file = {
        originalname: 'factura.pdf',
        size: 1024,
        buffer: Buffer.from('pdf content'),
        mimetype: 'application/pdf',
      } as any
      const result = await controller.validateInvoice(file)
      expect(mockService.validateInvoiceFromImage).toHaveBeenCalledWith(
        file.buffer,
        file.mimetype
      )
      expect(result).toBeDefined()
    })

    it('relanza HttpException del servicio', async () => {
      mockService.validateInvoiceFromImage.mockRejectedValue(
        new HttpException('Error', 400)
      )
      const file = {
        originalname: 'f.pdf',
        size: 100,
        buffer: Buffer.from('content'),
        mimetype: 'application/pdf',
      } as any
      await expect(controller.validateInvoice(file)).rejects.toThrow(
        HttpException
      )
    })
  })

  describe('rejectInvoice', () => {
    it('rechaza la factura con razon', async () => {
      await controller.rejectInvoice(invoiceId, {
        rejectionReason: 'Datos incorrectos',
      })
      expect(mockService.rejectInvoice).toHaveBeenCalledWith(
        invoiceId,
        'Datos incorrectos'
      )
    })
  })

  describe('updatePaymentStatus', () => {
    it('actualiza el estado de pago', async () => {
      await controller.updatePaymentStatus(invoiceId, { status: 'APPROVED' })
      expect(mockService.updatePaymentStatus).toHaveBeenCalledWith(
        invoiceId,
        'APPROVED',
        undefined
      )
    })
  })

  describe('uploadInvoiceAndActa', () => {
    it('lanza HttpException si falla la subida', async () => {
      mockService.uploadInvoiceAndActa.mockRejectedValue(
        new Error('Upload error')
      )
      await expect(
        controller.uploadInvoiceAndActa([], makeReq() as never)
      ).rejects.toThrow(HttpException)
    })

    it('retorna resultado exitoso cuando la subida funciona', async () => {
      mockService.uploadInvoiceAndActa.mockResolvedValue(makeInvoice())
      const result = await controller.uploadInvoiceAndActa(
        [],
        makeReq() as never
      )
      expect(result).toEqual(expect.objectContaining({ success: true }))
    })
  })
})
