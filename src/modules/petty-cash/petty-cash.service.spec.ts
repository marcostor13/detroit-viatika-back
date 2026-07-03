import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Types } from 'mongoose'
import { PettyCashService } from './petty-cash.service'
import { PettyCash } from './entities/petty-cash.entity'
import { EmailService } from '../email/email.service'
import { UserService } from '../user/user.service'

const mockEmailService = {
  sendCajaChicaCreada: jest.fn().mockResolvedValue(undefined),
  sendCajaChicaFondeada: jest.fn().mockResolvedValue(undefined),
}

const mockUserService = {
  findEmailNameClient: jest
    .fn()
    .mockResolvedValue({ name: 'Responsable', email: 'r@test.com' }),
  isEmailEnabled: jest.fn().mockResolvedValue(true),
}

const responsibleId = new Types.ObjectId().toString()
const clientId = new Types.ObjectId().toString()
const docId = new Types.ObjectId().toString()

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(docId),
    code: 'CCH-202605-001',
    responsibleId: new Types.ObjectId(responsibleId),
    clientId: new Types.ObjectId(clientId),
    period: '202605',
    fundAmount: 1000,
    spentAmount: 0,
    status: 'pending_funding',
    expenses: [],
    maxPerExpense: undefined,
    maxPerDay: undefined,
    allowedCategories: [],
    ...overrides,
  }
}

describe('PettyCashService', () => {
  let service: PettyCashService
  let mockModel: Record<string, jest.Mock>

  beforeEach(async () => {
    jest.clearAllMocks()

    mockModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      find: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PettyCashService,
        { provide: getModelToken(PettyCash.name), useValue: mockModel },
        { provide: EmailService, useValue: mockEmailService },
        { provide: UserService, useValue: mockUserService },
      ],
    }).compile()

    service = module.get<PettyCashService>(PettyCashService)
  })

  describe('create', () => {
    it('lanza BadRequestException si monto es 0 o negativo', async () => {
      await expect(
        service.create(
          { responsibleId, clientId, period: '202605', fundAmount: 0 },
          'u1'
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('lanza BadRequestException si ya existe caja activa para el responsable y periodo', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(makeDoc()),
      })
      await expect(
        service.create(
          { responsibleId, clientId, period: '202605', fundAmount: 500 },
          'u1'
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('crea la caja y envía email al responsable', async () => {
      // First call: existing check -> null
      // Second call: generateCode sort/lean chain -> null
      let callIdx = 0
      mockModel.findOne.mockImplementation(() => {
        callIdx++
        if (callIdx === 1) {
          return { exec: jest.fn().mockResolvedValue(null) }
        }
        return {
          sort: jest.fn().mockReturnValue({
            lean: jest
              .fn()
              .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
          }),
        }
      })
      const doc = makeDoc()
      mockModel.create.mockResolvedValue(doc)

      const result = await service.create(
        { responsibleId, clientId, period: '202605', fundAmount: 500 },
        'u1'
      )

      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending_funding', fundAmount: 500 })
      )
      expect(result).toBeDefined()
    })
  })

  describe('registerFunding', () => {
    const fundingDto = {
      transferDate: '2026-05-07T00:00:00.000Z',
      amount: 1000,
      operationNumber: 'OP-001',
      receiptUrl: 'https://cdn.example.com/receipt.pdf',
    }

    it('lanza NotFoundException si la caja no existe', async () => {
      mockModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      })
      await expect(
        service.registerFunding(docId, fundingDto, 'u1')
      ).rejects.toThrow(NotFoundException)
    })

    it('lanza BadRequestException si el estado no es pending_funding', async () => {
      mockModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(makeDoc({ status: 'active' })),
      })
      await expect(
        service.registerFunding(docId, fundingDto, 'u1')
      ).rejects.toThrow(BadRequestException)
    })

    it('lanza BadRequestException si monto no coincide', async () => {
      mockModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(makeDoc({ fundAmount: 2000 })),
      })
      await expect(
        service.registerFunding(docId, { ...fundingDto, amount: 1000 }, 'u1')
      ).rejects.toThrow(/coincidir/)
    })

    it('activa la caja y envía email', async () => {
      mockModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(makeDoc()),
      })
      const updated = makeDoc({ status: 'active' })
      mockModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updated),
      })

      const result = await service.registerFunding(docId, fundingDto, 'u1')
      expect(result.status).toBe('active')
      expect(mockEmailService.sendCajaChicaFondeada).toHaveBeenCalled()
    })
  })

  describe('validateExpenseRules', () => {
    it('detecta saldo insuficiente', () => {
      const doc = makeDoc({ fundAmount: 100, spentAmount: 90 }) as any
      const errors = service.validateExpenseRules(doc, 50)
      expect(errors.some(e => e.includes('Saldo insuficiente'))).toBe(true)
    })

    it('detecta tope por comprobante', () => {
      const doc = makeDoc({ maxPerExpense: 200, spentAmount: 0 }) as any
      const errors = service.validateExpenseRules(doc, 300)
      expect(errors.some(e => e.includes('tope por comprobante'))).toBe(true)
    })

    it('detecta categoria no permitida', () => {
      const doc = makeDoc({
        allowedCategories: ['alimentacion'],
        spentAmount: 0,
      }) as any
      const errors = service.validateExpenseRules(doc, 50, 'combustible')
      expect(errors.some(e => e.includes('categor'))).toBe(true)
    })

    it('detecta tope diario superado', () => {
      const today = new Date()
      const doc = makeDoc({
        maxPerDay: 100,
        spentAmount: 0,
        expenses: [
          { amount: 80, registeredAt: today, expenseId: new Types.ObjectId() },
        ],
      }) as any
      const errors = service.validateExpenseRules(doc, 30)
      expect(errors.some(e => e.includes('Tope diario'))).toBe(true)
    })

    it('no devuelve errores cuando todo está dentro de los límites', () => {
      const doc = makeDoc({
        maxPerExpense: 200,
        maxPerDay: 500,
        allowedCategories: ['alimentacion'],
        spentAmount: 0,
      }) as any
      const errors = service.validateExpenseRules(doc, 100, 'alimentacion')
      expect(errors).toHaveLength(0)
    })
  })

  describe('addExpense', () => {
    it('lanza BadRequestException si la caja no está activa', async () => {
      mockModel.findById.mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue(makeDoc({ status: 'pending_funding' })),
      })
      await expect(
        service.addExpense(docId, new Types.ObjectId().toString(), 100)
      ).rejects.toThrow(BadRequestException)
    })

    it('lanza BadRequestException si viola reglas de validacion', async () => {
      mockModel.findById.mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue(
            makeDoc({ status: 'active', fundAmount: 50, spentAmount: 0 })
          ),
      })
      await expect(
        service.addExpense(docId, new Types.ObjectId().toString(), 100)
      ).rejects.toThrow(BadRequestException)
    })

    it('registra el gasto y actualiza saldo', async () => {
      const expenseId = new Types.ObjectId().toString()
      mockModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(makeDoc({ status: 'active' })),
      })
      const updated = makeDoc({ status: 'active', spentAmount: 150 })
      mockModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updated),
      })

      const result = await service.addExpense(docId, expenseId, 150)
      expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
        docId,
        expect.objectContaining({ $inc: { spentAmount: 150 } }),
        { new: true }
      )
      expect(result.spentAmount).toBe(150)
    })
  })

  describe('close', () => {
    it('lanza BadRequestException si la caja no está activa', async () => {
      mockModel.findById.mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue(makeDoc({ status: 'pending_funding' })),
      })
      await expect(service.close(docId, 'u1')).rejects.toThrow(
        BadRequestException
      )
    })

    it('cierra la caja', async () => {
      mockModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(makeDoc({ status: 'active' })),
      })
      const updated = makeDoc({ status: 'closed' })
      mockModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updated),
      })

      const result = await service.close(docId, 'u1')
      expect(result.status).toBe('closed')
    })
  })
})
