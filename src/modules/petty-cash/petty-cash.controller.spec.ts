import { Test, TestingModule } from '@nestjs/testing'
import { Types } from 'mongoose'
import { PettyCashController } from './petty-cash.controller'
import { PettyCashService } from './petty-cash.service'
import { AuditLogService } from '../audit-log/audit-log.service'
import { ROLES } from '../auth/enums/roles.enum'

const boxId = new Types.ObjectId().toHexString()
const clientId = new Types.ObjectId().toHexString()
const userId = new Types.ObjectId().toHexString()

const makeReq = () => ({
  user: {
    _id: userId,
    sub: userId,
    name: 'Admin',
    email: 'admin@test.com',
    clientId,
    roles: [ROLES.ADMIN],
  },
})

const mockService = {
  create: jest.fn().mockResolvedValue({ _id: boxId, status: 'open' }),
  findAllByClient: jest.fn().mockResolvedValue([]),
  findByResponsible: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue({ _id: boxId }),
  registerFunding: jest
    .fn()
    .mockResolvedValue({ _id: boxId, status: 'funded' }),
  addExpense: jest.fn().mockResolvedValue({ _id: boxId }),
  close: jest.fn().mockResolvedValue({ _id: boxId, status: 'closed' }),
}

const mockAuditLogService = { log: jest.fn().mockResolvedValue(undefined) }

describe('PettyCashController', () => {
  let controller: PettyCashController

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PettyCashController],
      providers: [
        { provide: PettyCashService, useValue: mockService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile()
    controller = module.get<PettyCashController>(PettyCashController)
  })

  describe('create', () => {
    it('crea la caja chica y registra auditoria', async () => {
      const req = makeReq()
      const dto: any = {
        clientId,
        name: 'Caja Chica Operaciones',
        initialAmount: 500,
      }
      const result = await controller.create(dto, req as never)
      expect(mockService.create).toHaveBeenCalledWith(
        expect.objectContaining({ clientId }),
        userId
      )
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create_petty_cash',
          module: 'caja-chica',
        })
      )
      expect(result).toBeDefined()
    })
  })

  describe('findAllByClient', () => {
    it('delega al servicio con clientId', async () => {
      await controller.findAllByClient(clientId)
      expect(mockService.findAllByClient).toHaveBeenCalledWith(clientId)
    })
  })

  describe('findMine', () => {
    it('extrae responsibleId del JWT y delega al servicio', async () => {
      const req = makeReq()
      await controller.findMine(clientId, req as never)
      expect(mockService.findByResponsible).toHaveBeenCalledWith(
        userId,
        clientId
      )
    })
  })

  describe('findOne', () => {
    it('delega al servicio con el id', async () => {
      await controller.findOne(boxId)
      expect(mockService.findOne).toHaveBeenCalledWith(boxId)
    })
  })

  describe('registerFunding', () => {
    it('registra el fondeo y registra auditoria', async () => {
      const req = makeReq()
      const body = {
        transferDate: '2026-05-01',
        amount: 1000,
        operationNumber: 'OP-001',
        receiptUrl: 'https://cdn.example.com/receipt.pdf',
      }
      const result = await controller.registerFunding(boxId, body, req as never)
      expect(mockService.registerFunding).toHaveBeenCalledWith(
        boxId,
        body,
        userId
      )
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'fund_petty_cash' })
      )
      expect(result).toBeDefined()
    })
  })

  describe('addExpense', () => {
    it('agrega un gasto a la caja chica', async () => {
      const body = { expenseId: 'exp1', amount: 50, category: 'Alimentación' }
      await controller.addExpense(boxId, body)
      expect(mockService.addExpense).toHaveBeenCalledWith(
        boxId,
        'exp1',
        50,
        'Alimentación'
      )
    })
  })

  describe('close', () => {
    it('cierra la caja chica y registra auditoria', async () => {
      const req = makeReq()
      const result = await controller.close(boxId, req as never)
      expect(mockService.close).toHaveBeenCalledWith(boxId, userId)
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'close_petty_cash' })
      )
      expect(result).toBeDefined()
    })
  })
})
