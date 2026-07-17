import { Test, TestingModule } from '@nestjs/testing'
import { Types } from 'mongoose'
import { AdvanceController } from './advance.controller'
import { AdvanceService } from './advance.service'
import { PaymentBatchService } from './payment/payment-batch.service'
import { AuditLogService } from '../audit-log/audit-log.service'
import { ROLES } from '../auth/enums/roles.enum'

const advanceId = new Types.ObjectId().toHexString()
const clientId = new Types.ObjectId().toHexString()
const userId = new Types.ObjectId().toHexString()

const makeReq = (overrides: Record<string, unknown> = {}) => ({
  user: {
    _id: userId,
    sub: userId,
    name: 'Test User',
    email: 'test@test.com',
    clientId,
    roles: [ROLES.ADMIN],
    role: ROLES.ADMIN,
    permissions: { canApproveL1: true, canApproveL2: true },
    ...overrides,
  },
})

const mockAdvanceService = {
  findMyAdvances: jest.fn().mockResolvedValue([]),
  findAllByClient: jest.fn().mockResolvedValue([]),
  findPending: jest.fn().mockResolvedValue([]),
  getStats: jest.fn().mockResolvedValue({}),
  findOne: jest.fn().mockResolvedValue({ _id: advanceId }),
  approve: jest
    .fn()
    .mockResolvedValue({ _id: advanceId, status: 'approved' }),
  reject: jest.fn().mockResolvedValue({ _id: advanceId, status: 'rejected' }),
  resubmitRejected: jest
    .fn()
    .mockResolvedValue({ _id: advanceId, status: 'pending_l1' }),
  registerPayment: jest
    .fn()
    .mockResolvedValue({ _id: advanceId, status: 'paid' }),
  registerReturn: jest
    .fn()
    .mockResolvedValue({ _id: advanceId, status: 'returned' }),
  initiateReturnTracking: jest.fn().mockResolvedValue({ _id: advanceId }),
  uploadReturnProof: jest.fn().mockResolvedValue({ _id: advanceId }),
  validateReturn: jest.fn().mockResolvedValue({ _id: advanceId }),
  findPendingReturns: jest.fn().mockResolvedValue([]),
  cancelByCollaborator: jest
    .fn()
    .mockResolvedValue({ _id: advanceId, status: 'cancelled' }),
}

const mockAuditLogService = { log: jest.fn().mockResolvedValue(undefined) }

const mockPaymentBatchService = {
  generateTxt: jest.fn().mockResolvedValue({ count: 0, totalSoles: 0, excluded: [] }),
  reconcileFromPdf: jest
    .fn()
    .mockResolvedValue({ conciliados: [], sinConciliar: [], noAbonados: [] }),
  confirmManual: jest.fn().mockResolvedValue({ pagados: 0, errores: [] }),
}

describe('AdvanceController', () => {
  let controller: AdvanceController

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdvanceController],
      providers: [
        { provide: AdvanceService, useValue: mockAdvanceService },
        { provide: PaymentBatchService, useValue: mockPaymentBatchService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile()
    controller = module.get<AdvanceController>(AdvanceController)
  })

  describe('findMy', () => {
    it('delega al servicio con userId y clientId de la ruta', async () => {
      await controller.findMy(userId, clientId)
      expect(mockAdvanceService.findMyAdvances).toHaveBeenCalledWith(
        userId,
        clientId
      )
    })
  })

  describe('findAll', () => {
    it('delega al servicio con clientId de la ruta', async () => {
      await controller.findAll(clientId)
      expect(mockAdvanceService.findAllByClient).toHaveBeenCalledWith(clientId)
    })
  })

  describe('findPending', () => {
    it('delega al servicio', async () => {
      await controller.findPending(clientId)
      expect(mockAdvanceService.findPending).toHaveBeenCalledWith(clientId)
    })
  })

  describe('getStats', () => {
    it('delega al servicio', async () => {
      await controller.getStats(clientId)
      expect(mockAdvanceService.getStats).toHaveBeenCalledWith(clientId)
    })
  })

  describe('findOne', () => {
    it('delega al servicio con el id', async () => {
      await controller.findOne(advanceId)
      expect(mockAdvanceService.findOne).toHaveBeenCalledWith(advanceId)
    })
  })

  describe('approve', () => {
    it('asigna approvedBy del JWT y registra auditoria', async () => {
      const req = makeReq({ roles: [ROLES.COORDINADOR], role: ROLES.COORDINADOR })
      const dto: any = {}
      const result = await controller.approve(advanceId, dto, req as never)
      expect(dto.approvedBy).toBe(userId)
      expect(mockAdvanceService.approve).toHaveBeenCalledWith(
        advanceId,
        dto,
        userId,
        ROLES.COORDINADOR
      )
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'approve_advance',
          entityId: advanceId,
        })
      )
      expect(result).toBeDefined()
    })
  })

  describe('reject', () => {
    it('asigna rejectedBy del JWT y registra auditoria', async () => {
      const req = makeReq({ roles: [ROLES.COORDINADOR], role: ROLES.COORDINADOR })
      const dto: any = { rejectionReason: 'No corresponde' }
      await controller.reject(advanceId, dto, req as never)
      expect(dto.rejectedBy).toBe(userId)
      expect(mockAdvanceService.reject).toHaveBeenCalledWith(
        advanceId,
        dto,
        userId,
        ROLES.COORDINADOR
      )
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'reject_advance' })
      )
    })
  })

  describe('resubmit', () => {
    it('delega al servicio con userId y clientId del JWT', async () => {
      const req = makeReq()
      const dto: any = {}
      await controller.resubmit(advanceId, dto, req as never)
      expect(mockAdvanceService.resubmitRejected).toHaveBeenCalledWith(
        advanceId,
        dto,
        userId,
        clientId
      )
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'resubmit_advance' })
      )
    })
  })

  describe('registerPayment', () => {
    it('delega al servicio con rol y permisos del JWT', async () => {
      const req = makeReq()
      const dto: any = { method: 'transfer', amount: 500 }
      const result = await controller.registerPayment(
        advanceId,
        dto,
        req as never
      )
      expect(mockAdvanceService.registerPayment).toHaveBeenCalledWith(
        advanceId,
        dto,
        ROLES.ADMIN,
        expect.any(Object)
      )
      expect(result).toBeDefined()
    })
  })

  describe('registerReturn', () => {
    it('delega al servicio con id y monto', async () => {
      await controller.registerReturn(advanceId, { returnedAmount: 200 })
      expect(mockAdvanceService.registerReturn).toHaveBeenCalledWith(
        advanceId,
        200
      )
    })
  })

  describe('initiateReturn', () => {
    it('delega al servicio', async () => {
      await controller.initiateReturn(advanceId)
      expect(mockAdvanceService.initiateReturnTracking).toHaveBeenCalledWith(
        advanceId
      )
    })
  })

  describe('uploadReturnProof', () => {
    it('convierte depositDate a Date y delega al servicio', async () => {
      const body = {
        depositDate: '2026-05-01',
        amountReturned: 100,
        bankOrigin: 'BCP',
        operationNumber: 'OP-001',
        fileUrl: 'https://cdn.example.com/proof.pdf',
      }
      await controller.uploadReturnProof(advanceId, body)
      expect(mockAdvanceService.uploadReturnProof).toHaveBeenCalledWith(
        advanceId,
        expect.objectContaining({ depositDate: expect.any(Date) })
      )
    })
  })

  describe('validateReturn', () => {
    it('delega aprobacion al servicio', async () => {
      const req = makeReq()
      await controller.validateReturn(
        advanceId,
        { approved: true },
        req as never
      )
      expect(mockAdvanceService.validateReturn).toHaveBeenCalledWith(
        advanceId,
        true,
        userId,
        undefined
      )
    })
  })

  describe('findPendingReturns', () => {
    it('delega al servicio con clientId', async () => {
      await controller.findPendingReturns(clientId)
      expect(mockAdvanceService.findPendingReturns).toHaveBeenCalledWith(
        clientId
      )
    })
  })

  describe('cancelByCollaborator', () => {
    it('cancela el anticipo y registra auditoria', async () => {
      const req = makeReq()
      const result = await controller.cancelByCollaborator(
        advanceId,
        req as never
      )
      expect(mockAdvanceService.cancelByCollaborator).toHaveBeenCalledWith(
        advanceId,
        userId
      )
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'cancel_advance' })
      )
      expect(result).toBeDefined()
    })
  })
})
