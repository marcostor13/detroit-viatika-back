import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { HttpException, NotFoundException } from '@nestjs/common'
import { Types } from 'mongoose'

// Mock fs before importing InvoiceService to avoid constructor side-effects
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}))

jest.mock('pdf-parse', () => jest.fn())
jest.mock('tesseract.js', () => ({
  createWorker: jest.fn().mockResolvedValue({
    recognize: jest.fn().mockResolvedValue({ data: { text: '' } }),
    terminate: jest.fn(),
  }),
}))

import { InvoiceService } from './invoice.service'
import { Invoice } from './entities/invoice.entity'
import { EmailService } from '../email/email.service'
import { UserService } from '../user/user.service'
import { HttpService } from '@nestjs/axios'

const companyId = new Types.ObjectId().toHexString()
const invoiceId = new Types.ObjectId().toHexString()

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    _id: invoiceId,
    companyId,
    serie: 'F001',
    correlativo: '00001',
    status: 'PENDING',
    ...overrides,
  }
}

const mockEmailService = {
  sendInvoiceNotification: jest.fn().mockResolvedValue(undefined),
  sendActaNotification: jest.fn().mockResolvedValue(undefined),
}

const mockUserService = {}
const mockHttpService = { post: jest.fn() }

describe('InvoiceService', () => {
  let service: InvoiceService
  let mockModel: any
  let MockInvoiceModel: jest.Mock

  beforeEach(async () => {
    jest.clearAllMocks()

    const savedInvoice = makeInvoice()
    savedInvoice['save'] = jest.fn().mockResolvedValue(savedInvoice)
    MockInvoiceModel = jest.fn().mockImplementation(() => savedInvoice)

    mockModel = Object.assign(MockInvoiceModel, {
      find: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findOneAndDelete: jest.fn(),
    })

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceService,
        { provide: getModelToken(Invoice.name), useValue: mockModel },
        { provide: HttpService, useValue: mockHttpService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: UserService, useValue: mockUserService },
      ],
    }).compile()

    service = module.get<InvoiceService>(InvoiceService)
  })

  describe('create', () => {
    it('crea una factura con companyId y estado PENDING', async () => {
      const dto: any = { rucEmisor: '12345678901', serie: 'F001', correlativo: '00001' }
      const result = await service.create(dto, companyId)
      expect(MockInvoiceModel).toHaveBeenCalledWith(
        expect.objectContaining({ companyId, status: 'PENDING' })
      )
      expect(result).toBeDefined()
    })

    it('parsea fechaEmision si viene en el DTO', async () => {
      const dto: any = { rucEmisor: '12345678901', fechaEmision: '2026-05-01' }
      await service.create(dto, companyId)
      expect(MockInvoiceModel).toHaveBeenCalledWith(
        expect.objectContaining({ fechaEmision: expect.any(Date) })
      )
    })
  })

  describe('findAll', () => {
    it('retorna facturas filtradas por companyId', async () => {
      const invoices = [makeInvoice()]
      mockModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(invoices),
      })
      const result = await service.findAll(companyId)
      expect(mockModel.find).toHaveBeenCalledWith(expect.objectContaining({ companyId }))
      expect(result).toHaveLength(1)
    })

    it('aplica filtros opcionales', async () => {
      mockModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      })
      await service.findAll(companyId, { status: 'PENDING', projectId: 'proj1' })
      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PENDING', projectId: 'proj1' })
      )
    })
  })

  describe('findOne', () => {
    it('retorna la factura por id y companyId', async () => {
      const invoice = makeInvoice()
      mockModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(invoice),
      })
      const result = await service.findOne(invoiceId, companyId)
      expect(result).toEqual(invoice)
    })

    it('lanza NotFoundException si no existe', async () => {
      mockModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      })
      await expect(service.findOne(invoiceId, companyId)).rejects.toThrow(NotFoundException)
    })
  })

  describe('findByClient', () => {
    it('retorna facturas del cliente', async () => {
      const invoices = [makeInvoice()]
      mockModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(invoices),
      })
      const result = await service.findByClient(companyId)
      expect(result).toHaveLength(1)
    })

    it('lanza NotFoundException si no hay facturas', async () => {
      mockModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      })
      await expect(service.findByClient(companyId)).rejects.toThrow(NotFoundException)
    })
  })

  describe('findByProject', () => {
    it('retorna facturas del proyecto', async () => {
      const invoices = [makeInvoice()]
      mockModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(invoices),
      })
      const result = await service.findByProject('proj1')
      expect(result).toHaveLength(1)
    })

    it('lanza NotFoundException si no hay facturas', async () => {
      mockModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      })
      await expect(service.findByProject('proj1')).rejects.toThrow(NotFoundException)
    })
  })

  describe('update', () => {
    it('actualiza la factura y la retorna', async () => {
      const updated = makeInvoice({ status: 'APPROVED' })
      mockModel.findOneAndUpdate.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(updated),
      })
      const result = await service.update(invoiceId, { status: 'APPROVED' } as any, companyId)
      expect(result.status).toBe('APPROVED')
    })

    it('lanza NotFoundException si no existe', async () => {
      mockModel.findOneAndUpdate.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      })
      await expect(service.update(invoiceId, {} as any, companyId)).rejects.toThrow(NotFoundException)
    })
  })

  describe('uploadActaAceptacion', () => {
    it('convierte el buffer a base64 y actualiza la factura', async () => {
      const invoice = makeInvoice()
      mockModel.findById.mockReturnValue({ ...invoice })
      const updated = makeInvoice({ actaAceptacion: 'base64data' })
      mockModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updated),
      })
      const buffer = Buffer.from('pdf content')
      const result = await service.uploadActaAceptacion(invoiceId, buffer)
      expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
        invoiceId,
        { actaAceptacion: buffer.toString('base64') },
        { new: true }
      )
      expect(result).toBeDefined()
    })

    it('lanza NotFoundException si la factura no existe', async () => {
      mockModel.findById.mockReturnValue(null)
      await expect(
        service.uploadActaAceptacion(invoiceId, Buffer.from('test'))
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('downloadActaAceptacion', () => {
    it('retorna el buffer y nombre del archivo', async () => {
      const acta = Buffer.from('acta pdf').toString('base64')
      mockModel.findById.mockReturnValue(makeInvoice({ actaAceptacion: acta }))
      const result = await service.downloadActaAceptacion(invoiceId)
      expect(result.filename).toContain('acta-aceptacion')
      expect(Buffer.isBuffer(result.buffer)).toBe(true)
    })

    it('lanza NotFoundException si no existe la factura', async () => {
      mockModel.findById.mockReturnValue(null)
      await expect(service.downloadActaAceptacion(invoiceId)).rejects.toThrow(NotFoundException)
    })

    it('lanza NotFoundException si no hay acta adjunta', async () => {
      mockModel.findById.mockReturnValue(makeInvoice({ actaAceptacion: null }))
      await expect(service.downloadActaAceptacion(invoiceId)).rejects.toThrow(NotFoundException)
    })
  })

  describe('remove', () => {
    it('elimina la factura por id y companyId', async () => {
      mockModel.findOneAndDelete.mockReturnValue({
        exec: jest.fn().mockResolvedValue(makeInvoice()),
      })
      await expect(service.remove(invoiceId, companyId)).resolves.toBeUndefined()
    })

    it('lanza NotFoundException si no existe', async () => {
      mockModel.findOneAndDelete.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      })
      await expect(service.remove(invoiceId, companyId)).rejects.toThrow(NotFoundException)
    })
  })

  describe('generateTokenSunat', () => {
    it('retorna un token de acceso', async () => {
      const result = await service.generateTokenSunat()
      expect(result).toHaveProperty('access_token')
    })
  })

  describe('sendInvoiceUploadedNotification', () => {
    it('envia notificacion de factura subida', async () => {
      const result = await service.sendInvoiceUploadedNotification(
        'test@test.com',
        'F001-00001',
        'Proveedor S.A.'
      )
      expect(mockEmailService.sendInvoiceNotification).toHaveBeenCalledWith(
        'test@test.com',
        expect.objectContaining({ invoiceNumber: 'F001-00001', providerName: 'Proveedor S.A.' })
      )
      expect(result).toEqual({ success: true, message: 'Notificación enviada exitosamente' })
    })

    it('lanza HttpException si el envio falla', async () => {
      mockEmailService.sendInvoiceNotification.mockRejectedValue(new Error('SMTP error'))
      await expect(
        service.sendInvoiceUploadedNotification('test@test.com', 'F001-00001', 'Proveedor')
      ).rejects.toThrow(HttpException)
    })
  })

  describe('sendActaUploadedNotification', () => {
    it('envia notificacion de acta subida', async () => {
      const result = await service.sendActaUploadedNotification(
        'test@test.com',
        'F001-00001',
        'Proveedor S.A.'
      )
      expect(mockEmailService.sendActaNotification).toHaveBeenCalled()
      expect(result).toEqual({ success: true, message: 'Notificación enviada exitosamente' })
    })
  })

  describe('validateInvoiceFromImage', () => {
    it('lanza HttpException si el buffer esta vacio', async () => {
      await expect(
        service.validateInvoiceFromImage(Buffer.alloc(0), 'image/png')
      ).rejects.toThrow(HttpException)
    })

    it('lanza HttpException para tipo XML no implementado', async () => {
      await expect(
        service.validateInvoiceFromImage(Buffer.from('xml'), 'application/xml')
      ).rejects.toThrow(HttpException)
    })
  })
})
