import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { BadRequestException } from '@nestjs/common'
import { Types } from 'mongoose'
import { SaldoService } from './saldo.service'
import { Saldo } from './entities/saldo.entity'
import { NotificationsService } from '../notifications/notifications.service'

const userId = new Types.ObjectId().toString()
const clientId = new Types.ObjectId().toString()
const projectA = new Types.ObjectId().toString()
const projectB = new Types.ObjectId().toString()

function makeSaldoDoc(overrides: Record<string, unknown>) {
  return {
    _id: new Types.ObjectId(),
    status: 'available',
    amount: 100,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

const mockSaldoModel: any = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
}

const mockNotificationsService = {
  create: jest.fn().mockResolvedValue(undefined),
}

describe('SaldoService', () => {
  let service: SaldoService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaldoService,
        { provide: getModelToken(Saldo.name), useValue: mockSaldoModel },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile()
    service = module.get<SaldoService>(SaldoService)
  })

  describe('findEligible', () => {
    it('returns [] for viatico context without projectId', async () => {
      const res = await service.findEligible(userId, clientId, 'viatico')
      expect(res).toEqual([])
      expect(mockSaldoModel.find).not.toHaveBeenCalled()
    })
  })

  describe('consume', () => {
    it('returns 0 with no ids', async () => {
      expect(await service.consume([], { userId, clientId, context: 'rendicion_directa' })).toBe(0)
    })

    it('consumes eligible rendicion_directa + pago and returns sum', async () => {
      const s1 = makeSaldoDoc({ type: 'rendicion_directa', amount: 100 })
      const s2 = makeSaldoDoc({ type: 'pago', amount: 50 })
      mockSaldoModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([s1, s2]) })

      const reportId = new Types.ObjectId().toString()
      const total = await service.consume(
        [s1._id.toString(), s2._id.toString()],
        { userId, clientId, context: 'rendicion_directa', reportId }
      )

      expect(total).toBe(150)
      expect(s1.status).toBe('consumed')
      expect(s2.status).toBe('consumed')
      expect(s1.save).toHaveBeenCalled()
    })

    it('rejects a rendicion (viatico) saldo in rendicion_directa context', async () => {
      const s1 = makeSaldoDoc({ type: 'rendicion', amount: 100 })
      mockSaldoModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([s1]) })

      await expect(
        service.consume([s1._id.toString()], { userId, clientId, context: 'rendicion_directa' })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects a saldo from a different project in viatico context', async () => {
      const s1 = makeSaldoDoc({
        type: 'rendicion',
        amount: 100,
        projectId: new Types.ObjectId(projectB),
      })
      mockSaldoModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([s1]) })

      await expect(
        service.consume([s1._id.toString()], {
          userId,
          clientId,
          context: 'viatico',
          projectId: projectA,
        })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('consumes a same-project rendicion saldo in viatico context', async () => {
      const s1 = makeSaldoDoc({
        type: 'rendicion',
        amount: 80,
        projectId: new Types.ObjectId(projectA),
      })
      mockSaldoModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([s1]) })

      const advanceId = new Types.ObjectId().toString()
      const total = await service.consume([s1._id.toString()], {
        userId,
        clientId,
        context: 'viatico',
        projectId: projectA,
        advanceId,
      })

      expect(total).toBe(80)
      expect(s1.status).toBe('consumed')
    })

    it('rejects when a requested saldo is missing', async () => {
      mockSaldoModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) })
      await expect(
        service.consume([new Types.ObjectId().toString()], {
          userId,
          clientId,
          context: 'rendicion_directa',
        })
      ).rejects.toBeInstanceOf(BadRequestException)
    })
  })

  describe('createFromRemnant', () => {
    it('returns null for non-positive amount', async () => {
      const res = await service.createFromRemnant({
        userId,
        clientId,
        sourceReportId: new Types.ObjectId().toString(),
        amount: 0,
        type: 'rendicion',
      })
      expect(res).toBeNull()
      expect(mockSaldoModel.create).not.toHaveBeenCalled()
    })

    it('is idempotent: returns existing saldo for same sourceReportId', async () => {
      const existing = { _id: new Types.ObjectId() }
      mockSaldoModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) })
      const res = await service.createFromRemnant({
        userId,
        clientId,
        sourceReportId: new Types.ObjectId().toString(),
        amount: 100,
        type: 'rendicion_directa',
      })
      expect(res).toBe(existing)
      expect(mockSaldoModel.create).not.toHaveBeenCalled()
    })
  })
})
