import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { Types } from 'mongoose'
import { AdvanceService } from './advance.service'
import { Advance, ADVANCE_THRESHOLDS } from './entities/advance.entity'
import { ExpenseReportService } from '../expense-report/expense-report.service'
import { ProjectService } from '../project/project.service'
import { CategoryService } from '../category/category.service'
import { UserService } from '../user/user.service'
import { EmailService } from '../email/email.service'
import { NotificationsService } from '../notifications/notifications.service'
import { SaldoService } from '../saldo/saldo.service'
import { ROLES } from '../auth/enums/roles.enum'

const advanceId = new Types.ObjectId().toString()
const userId = new Types.ObjectId().toString()
const clientId = new Types.ObjectId().toString()
const reportId = new Types.ObjectId().toString()

// Creates a mock advance document with a save() spy
const makeMockAdvance = (overrides: Record<string, any> = {}) => {
  const doc: any = {
    _id: new Types.ObjectId(advanceId),
    userId: new Types.ObjectId(userId),
    clientId: new Types.ObjectId(clientId),
    amount: 300,
    description: 'Test advance',
    status: 'pending_l1',
    approvalLevel: 0,
    requiredLevels: 1,
    approvalHistory: [],
    ...overrides,
  }
  doc.save = jest.fn().mockResolvedValue(doc)
  return doc
}

// Chainable query mock (for find/populate/sort/exec patterns)
const makeQuery = (resolvedValue: any) => {
  const q: any = {
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(resolvedValue),
    then: (res: any, rej: any) => Promise.resolve(resolvedValue).then(res, rej),
    catch: (rej: any) => Promise.resolve(resolvedValue).catch(rej),
  }
  return q
}

const mockAdvanceModel = {
  create: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  findByIdAndUpdate: jest
    .fn()
    .mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
  updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  countDocuments: jest.fn(),
  aggregate: jest.fn(),
}

const mockExpenseReportService = {
  addAdvanceToReport: jest.fn().mockResolvedValue(undefined),
  findOneWithAdvances: jest.fn(),
  updateSettlement: jest.fn().mockResolvedValue(undefined),
}

const mockProjectService = {
  findOne: jest.fn(),
  adjustCommittedAdvanceTotal: jest.fn().mockResolvedValue(undefined),
}

const mockCategoryService = {
  findOne: jest.fn(),
}

const mockUserService = {
  findTransactionalProfile: jest.fn(),
  findEmailNameClient: jest.fn(),
  findCollaboratorViaticoNotifyProfile: jest.fn().mockResolvedValue({
    name: 'Colaborador',
    dni: '12345678',
    employeeCode: 'EMP01',
  }),
  findViaticoAccountingNotifyRecipients: jest.fn().mockResolvedValue([]),
  isEmailEnabled: jest.fn().mockResolvedValue(true),
}

const mockNotificationsService = {
  create: jest.fn().mockResolvedValue(undefined),
}

const mockSaldoService = {
  createFromRemnant: jest.fn().mockResolvedValue(null),
  consume: jest.fn().mockResolvedValue(0),
  sumAmounts: jest.fn().mockResolvedValue(0),
}

const mockEmailService = {
  buildAppUrl: jest.fn().mockReturnValue('http://localhost:4200/app'),
  formatDateDDMMYYYY: jest.fn().mockReturnValue('01/01/2026'),
  sendViaticoSolicitudToCoordinator: jest.fn(),
  sendViaticoRechazoColaborador: jest.fn().mockResolvedValue(undefined),
  sendViaticoAprobacionContabilidad: jest.fn().mockResolvedValue(undefined),
  sendViaticoPagoRealizado: jest.fn().mockResolvedValue(undefined),
  sendDevolucionPendiente: jest.fn().mockResolvedValue(undefined),
  sendDevolucionValidada: jest.fn().mockResolvedValue(undefined),
  sendDevolucionRechazada: jest.fn().mockResolvedValue(undefined),
}

describe('AdvanceService', () => {
  let service: AdvanceService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdvanceService,
        { provide: getModelToken(Advance.name), useValue: mockAdvanceModel },
        { provide: ExpenseReportService, useValue: mockExpenseReportService },
        { provide: ProjectService, useValue: mockProjectService },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: UserService, useValue: mockUserService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: SaldoService, useValue: mockSaldoService },
      ],
    }).compile()
    service = module.get<AdvanceService>(AdvanceService)
  })

  // ── create ────────────────────────────────────────────────────────────
  describe('create', () => {
    it('creates an advance and sets requiredLevels=1 for amount <= threshold', async () => {
      const advance = makeMockAdvance({ amount: ADVANCE_THRESHOLDS.L1_MAX })
      mockAdvanceModel.create.mockResolvedValue(advance)
      const result = await service.create({
        userId,
        clientId,
        amount: ADVANCE_THRESHOLDS.L1_MAX,
        description: 'Test',
      })
      expect(result.requiredLevels).toBe(1)
    })

    it('sets requiredLevels=2 for amount > threshold', async () => {
      const advance = makeMockAdvance({ amount: 501, requiredLevels: 2 })
      mockAdvanceModel.create.mockResolvedValue(advance)
      const result = await service.create({
        userId,
        clientId,
        amount: 501,
        description: 'Test',
      })
      expect(result.requiredLevels).toBe(2)
    })

    it('links to expense report when expenseReportId is provided', async () => {
      const advance = makeMockAdvance()
      mockAdvanceModel.create.mockResolvedValue(advance)
      await service.create({
        userId,
        clientId,
        amount: 100,
        description: 'Test',
        expenseReportId: reportId,
      })
      expect(mockExpenseReportService.addAdvanceToReport).toHaveBeenCalledWith(
        reportId,
        advanceId
      )
    })

    it('throws BadRequestException when clientId is missing', async () => {
      await expect(
        service.create({
          userId,
          clientId: '',
          amount: 100,
          description: 'Test',
        })
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when userId is missing', async () => {
      await expect(
        service.create({
          userId: '',
          clientId,
          amount: 100,
          description: 'Test',
        })
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ── findOne ───────────────────────────────────────────────────────────
  describe('findOne', () => {
    it('returns the advance when found', async () => {
      const advance = makeMockAdvance()
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      const result = await service.findOne(advanceId)
      expect(result).toEqual(advance)
    })

    it('throws NotFoundException when advance not found', async () => {
      mockAdvanceModel.findById.mockReturnValue(makeQuery(null))
      await expect(service.findOne(advanceId)).rejects.toThrow(
        NotFoundException
      )
    })
  })

  // ── approveL1 ─────────────────────────────────────────────────────────
  describe('approveL1', () => {
    const dto = { approvedBy: 'admin@test.com', notes: 'OK' }

    it('approves at L1 and sets status=approved when requiredLevels=1', async () => {
      const advance = makeMockAdvance({ requiredLevels: 1 })
      advance.save.mockResolvedValue(advance)
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      const result = await service.approveL1(advanceId, dto, ROLES.ADMIN)
      expect(advance.status).toBe('approved')
      expect(advance.approvalHistory).toHaveLength(1)
      expect(advance.approvalHistory[0].action).toBe('approved')
      expect(advance.save).toHaveBeenCalled()
    })

    it('sets status=pending_l2 when requiredLevels=2', async () => {
      const advance = makeMockAdvance({ requiredLevels: 2 })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await service.approveL1(advanceId, dto, ROLES.ADMIN)
      expect(advance.status).toBe('pending_l2')
    })

    it('throws ForbiddenException for Colaborador without canApproveL1', async () => {
      const advance = makeMockAdvance()
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(
        service.approveL1(advanceId, dto, ROLES.COLABORADOR)
      ).rejects.toThrow(ForbiddenException)
    })

    it('allows approval via canApproveL1 permission', async () => {
      const advance = makeMockAdvance({ requiredLevels: 1 })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await service.approveL1(advanceId, dto, ROLES.COLABORADOR, {
        canApproveL1: true,
      })
      expect(advance.status).toBe('approved')
    })

    it('throws BadRequestException when status is not pending_l1', async () => {
      const advance = makeMockAdvance({ status: 'approved' })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(
        service.approveL1(advanceId, dto, ROLES.ADMIN)
      ).rejects.toThrow(BadRequestException)
    })

    it('throws NotFoundException when advance not found', async () => {
      mockAdvanceModel.findById.mockReturnValue(makeQuery(null))
      await expect(
        service.approveL1(advanceId, dto, ROLES.ADMIN)
      ).rejects.toThrow(NotFoundException)
    })
  })

  // ── approveL2 ─────────────────────────────────────────────────────────
  describe('approveL2', () => {
    const dto = { approvedBy: 'super@test.com', notes: 'Approved L2' }

    it('approves at L2 and sets status=approved', async () => {
      const advance = makeMockAdvance({
        status: 'pending_l2',
        requiredLevels: 2,
      })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await service.approveL2(advanceId, dto, ROLES.SUPER_ADMIN)
      expect(advance.status).toBe('approved')
      expect(advance.approvalLevel).toBe(2)
    })

    it('throws ForbiddenException for Admin without canApproveL2', async () => {
      const advance = makeMockAdvance({ status: 'pending_l2' })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(
        service.approveL2(advanceId, dto, ROLES.ADMIN)
      ).rejects.toThrow(ForbiddenException)
    })

    it('allows approval via canApproveL2 permission', async () => {
      const advance = makeMockAdvance({ status: 'pending_l2' })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await service.approveL2(advanceId, dto, ROLES.COLABORADOR, {
        canApproveL2: true,
      })
      expect(advance.status).toBe('approved')
    })

    it('throws BadRequestException when status is not pending_l2', async () => {
      const advance = makeMockAdvance({ status: 'pending_l1' })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(
        service.approveL2(advanceId, dto, ROLES.SUPER_ADMIN)
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ── reject ────────────────────────────────────────────────────────────
  describe('reject', () => {
    const dto = {
      rejectedBy: 'admin@test.com',
      rejectionReason:
        'El monto solicitado no está justificado según la política interna.',
    }

    it('rejects a pending_l1 advance', async () => {
      const advance = makeMockAdvance({ status: 'pending_l1' })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await service.reject(advanceId, dto, ROLES.ADMIN)
      expect(advance.status).toBe('rejected')
      expect(advance.rejectionReason).toBe(dto.rejectionReason)
    })

    it('rejects a pending_l2 advance', async () => {
      const advance = makeMockAdvance({ status: 'pending_l2' })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await service.reject(advanceId, dto, ROLES.ADMIN)
      expect(advance.status).toBe('rejected')
    })

    it('throws BadRequestException for non-rejectable status', async () => {
      const advance = makeMockAdvance({ status: 'approved' })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(service.reject(advanceId, dto, ROLES.ADMIN)).rejects.toThrow(
        BadRequestException
      )
    })

    it('throws ForbiddenException for Colaborador without reject permissions', async () => {
      const advance = makeMockAdvance({ status: 'pending_l1' })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(
        service.reject(advanceId, dto, ROLES.COLABORADOR)
      ).rejects.toThrow(ForbiddenException)
    })
  })

  // ── registerPayment ───────────────────────────────────────────────────
  describe('registerPayment', () => {
    const dto = {
      method: 'transferencia_bancaria' as const,
      bankName: 'BCP',
      accountNumber: '1234',
      cci: '00212341234',
      transferDate: new Date().toISOString(),
      reference: 'REF001',
      paymentReceiptUrl: 'https://files.example.com/receipts/viatico-001.pdf',
      paymentReceiptFileName: 'viatico-001.pdf',
      paymentReceiptMimeType: 'application/pdf',
      paymentReceiptSizeBytes: 1024,
    }

    it('registers payment with receipt, sets status=paid and notifies collaborator/coordinator', async () => {
      const advance = makeMockAdvance({
        status: 'approved',
        projectId: new Types.ObjectId().toString(),
      })
      mockUserService.findEmailNameClient
        .mockResolvedValueOnce({
          name: 'Colaborador Test',
          email: 'colab@test.com',
          clientId: new Types.ObjectId(clientId),
        })
        .mockResolvedValueOnce({
          name: 'Coordinador Test',
          email: 'coord@test.com',
          clientId: new Types.ObjectId(clientId),
        })
      mockUserService.findTransactionalProfile.mockResolvedValue({
        coordinatorId: new Types.ObjectId(),
      })
      mockProjectService.findOne.mockResolvedValue({
        code: 'CC-001',
        name: 'Proyecto Demo',
      })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await service.registerPayment(advanceId, dto, ROLES.SUPER_ADMIN)
      await new Promise(resolve => setImmediate(resolve))
      expect(advance.status).toBe('paid')
      expect(advance.paymentInfo).toMatchObject({
        method: 'transferencia_bancaria',
        bankName: 'BCP',
        paymentReceiptUrl: dto.paymentReceiptUrl,
      })
      expect(mockEmailService.sendViaticoPagoRealizado).toHaveBeenCalledTimes(2)
    })

    it('registers payment from pending_l2 (L2 approval + payment in one step)', async () => {
      const advance = makeMockAdvance({ status: 'pending_l2' })
      mockUserService.findEmailNameClient.mockResolvedValue({
        name: 'Colaborador Test',
        email: 'colab@test.com',
        clientId: new Types.ObjectId(clientId),
      })
      mockUserService.findTransactionalProfile.mockResolvedValue({
        coordinatorId: undefined,
      })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await service.registerPayment(advanceId, dto, ROLES.CONTABILIDAD)
      expect(advance.status).toBe('paid')
    })

    it('throws BadRequestException when advance is in a non-payable state (e.g. pending_l1)', async () => {
      const advance = makeMockAdvance({ status: 'pending_l1' })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(
        service.registerPayment(advanceId, dto, ROLES.SUPER_ADMIN)
      ).rejects.toThrow(BadRequestException)
    })

    it('throws ForbiddenException for Admin without canApproveL2', async () => {
      const advance = makeMockAdvance({ status: 'approved' })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(
        service.registerPayment(advanceId, dto, ROLES.ADMIN)
      ).rejects.toThrow(ForbiddenException)
    })

    it('throws BadRequestException when receipt format is invalid', async () => {
      const advance = makeMockAdvance({ status: 'approved' })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(
        service.registerPayment(
          advanceId,
          {
            ...dto,
            paymentReceiptUrl:
              'https://files.example.com/receipts/viatico-001.exe',
            paymentReceiptFileName: 'viatico-001.exe',
            paymentReceiptMimeType: 'application/x-msdownload',
          },
          ROLES.SUPER_ADMIN
        )
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ── registerReturn ────────────────────────────────────────────────────
  describe('registerReturn', () => {
    it('sets status=returned and records returned amount', async () => {
      const advance = makeMockAdvance({ status: 'settled' })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await service.registerReturn(advanceId, 100)
      expect(advance.status).toBe('returned')
      expect(advance.returnedAmount).toBe(100)
    })

    it('allows return from paid status', async () => {
      const advance = makeMockAdvance({ status: 'paid' })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await service.registerReturn(advanceId, 50)
      expect(advance.status).toBe('returned')
    })

    it('throws BadRequestException for invalid status', async () => {
      const advance = makeMockAdvance({ status: 'pending_l1' })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(service.registerReturn(advanceId, 100)).rejects.toThrow(
        BadRequestException
      )
    })
  })

  // ── Fase 7 — initiateReturnTracking ──────────────────────────────────
  describe('initiateReturnTracking', () => {
    it('creates returnRecord and sends email when advance is settled with devolucion', async () => {
      const advance = makeMockAdvance({
        status: 'settled',
        settlement: {
          difference: 200,
          type: 'devolucion',
          advanceAmount: 500,
          expenseTotal: 300,
          settledAt: new Date(),
        },
      })
      mockAdvanceModel.findById
        .mockReturnValueOnce(makeQuery(advance))
        .mockReturnValueOnce(
          makeQuery({
            ...advance,
            returnRecord: { status: 'pending', amountDue: 200 },
          })
        )
      mockAdvanceModel.findByIdAndUpdate = jest.fn().mockResolvedValue({})
      mockUserService.findEmailNameClient.mockResolvedValue({
        email: 'test@test.com',
        name: 'Test User',
      })
      mockEmailService.sendDevolucionPendiente = jest
        .fn()
        .mockResolvedValue(undefined)
      await service.initiateReturnTracking(advanceId)
      expect(mockAdvanceModel.findByIdAndUpdate).toHaveBeenCalledWith(
        advanceId,
        expect.objectContaining({
          $set: expect.objectContaining({
            returnRecord: expect.objectContaining({ status: 'pending' }),
          }),
        })
      )
    })

    it('throws BadRequestException if advance is not settled', async () => {
      const advance = makeMockAdvance({ status: 'paid' })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(service.initiateReturnTracking(advanceId)).rejects.toThrow(
        BadRequestException
      )
    })

    it('throws BadRequestException if settlement type is not devolucion', async () => {
      const advance = makeMockAdvance({
        status: 'settled',
        settlement: {
          difference: 0,
          type: 'equilibrado',
          advanceAmount: 300,
          expenseTotal: 300,
          settledAt: new Date(),
        },
      })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(service.initiateReturnTracking(advanceId)).rejects.toThrow(
        BadRequestException
      )
    })
  })

  // ── Fase 7 — uploadReturnProof ────────────────────────────────────────
  describe('uploadReturnProof', () => {
    const proofData = {
      depositDate: new Date('2025-01-15'),
      amountReturned: 200,
      bankOrigin: 'BCP',
      operationNumber: 'OP-12345',
      fileUrl: 'https://s3.example.com/proof.pdf',
    }

    it('updates returnRecord to proof_uploaded status', async () => {
      const advance = makeMockAdvance({
        status: 'settled',
        returnRecord: {
          status: 'pending',
          amountDue: 150,
          dueDate: new Date(),
          isOverdue: false,
          remindersSent: 0,
        },
      })
      const updatedAdvance = {
        ...advance,
        returnRecord: { ...advance.returnRecord, status: 'proof_uploaded' },
      }
      mockAdvanceModel.findById
        .mockReturnValueOnce(makeQuery(advance))
        .mockReturnValueOnce(makeQuery(updatedAdvance))
      mockAdvanceModel.findByIdAndUpdate = jest.fn().mockResolvedValue({})
      const result = await service.uploadReturnProof(advanceId, proofData)
      expect(mockAdvanceModel.findByIdAndUpdate).toHaveBeenCalledWith(
        advanceId,
        expect.objectContaining({
          $set: expect.objectContaining({
            returnRecord: expect.objectContaining({ status: 'proof_uploaded' }),
          }),
        })
      )
    })

    it('throws BadRequestException if amountReturned < amountDue', async () => {
      const advance = makeMockAdvance({
        returnRecord: {
          status: 'pending',
          amountDue: 300,
          dueDate: new Date(),
          isOverdue: false,
          remindersSent: 0,
        },
      })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(
        service.uploadReturnProof(advanceId, {
          ...proofData,
          amountReturned: 100,
        })
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException if returnRecord status is not pending', async () => {
      const advance = makeMockAdvance({
        returnRecord: {
          status: 'proof_uploaded',
          amountDue: 200,
          dueDate: new Date(),
          isOverdue: false,
          remindersSent: 0,
        },
      })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(
        service.uploadReturnProof(advanceId, proofData)
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ── Fase 7 — validateReturn ───────────────────────────────────────────
  describe('validateReturn', () => {
    it('approves the return and sets advance status to returned', async () => {
      const advance = makeMockAdvance({
        userId: new Types.ObjectId(userId),
        returnRecord: {
          status: 'proof_uploaded',
          amountDue: 200,
          proof: {
            amountReturned: 200,
            depositDate: new Date(),
            bankOrigin: 'BCP',
            operationNumber: 'OP1',
            fileUrl: 'url',
            uploadedAt: new Date(),
          },
          dueDate: new Date(),
          isOverdue: false,
          remindersSent: 0,
        },
      })
      const updatedAdvance = {
        ...advance,
        status: 'returned',
        returnRecord: { ...advance.returnRecord, status: 'validated' },
      }
      mockAdvanceModel.findById
        .mockReturnValueOnce(makeQuery(advance))
        .mockReturnValueOnce(makeQuery(updatedAdvance))
      mockAdvanceModel.findByIdAndUpdate = jest.fn().mockResolvedValue({})
      mockUserService.findEmailNameClient.mockResolvedValue({
        email: 'c@c.com',
        name: 'Colaborador',
      })
      mockEmailService.sendDevolucionValidada = jest
        .fn()
        .mockResolvedValue(undefined)
      const result = await service.validateReturn(
        advanceId,
        true,
        'accountant-id'
      )
      expect(mockAdvanceModel.findByIdAndUpdate).toHaveBeenCalledWith(
        advanceId,
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'returned' }),
        })
      )
    })

    it('rejects the return and requires rejectionReason >= 50 chars', async () => {
      const advance = makeMockAdvance({
        returnRecord: {
          status: 'proof_uploaded',
          amountDue: 200,
          dueDate: new Date(),
          isOverdue: false,
          remindersSent: 0,
          proof: {
            amountReturned: 200,
            depositDate: new Date(),
            bankOrigin: 'BCP',
            operationNumber: 'OP1',
            fileUrl: 'url',
            uploadedAt: new Date(),
          },
        },
      })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(
        service.validateReturn(advanceId, false, 'acc-id', 'short')
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException if no proof_uploaded record exists', async () => {
      const advance = makeMockAdvance({
        returnRecord: {
          status: 'pending',
          amountDue: 200,
          dueDate: new Date(),
          isOverdue: false,
          remindersSent: 0,
        },
      })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(
        service.validateReturn(advanceId, true, 'acc-id')
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ── Fase 7 — markOverdueReturns ───────────────────────────────────────
  describe('markOverdueReturns', () => {
    it('updates overdue returns and returns modified count', async () => {
      mockAdvanceModel.updateMany = jest
        .fn()
        .mockResolvedValue({ modifiedCount: 3 })
      const result = await service.markOverdueReturns()
      expect(result).toBe(3)
      expect(mockAdvanceModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          'returnRecord.status': 'pending',
          'returnRecord.isOverdue': false,
        }),
        expect.any(Object)
      )
    })
  })

  // ── getStats ──────────────────────────────────────────────────────────
  describe('getStats', () => {
    it('returns counts and total amount', async () => {
      mockAdvanceModel.countDocuments
        .mockResolvedValueOnce(2) // pending_l1
        .mockResolvedValueOnce(1) // pending_l2
        .mockResolvedValueOnce(3) // approved
        .mockResolvedValueOnce(4) // paid
        .mockResolvedValueOnce(5) // settled
      mockAdvanceModel.aggregate.mockResolvedValue([{ total: 10000 }])
      const result = await service.getStats(clientId)
      expect(result).toMatchObject({
        pending_l1: 2,
        pending_l2: 1,
        approved: 3,
        paid: 4,
        settled: 5,
      })
    })
  })

  // ── findAllByClient ───────────────────────────────────────────────────
  describe('findAllByClient', () => {
    it('returns advances filtered by clientId', async () => {
      const advances = [makeMockAdvance()]
      mockAdvanceModel.find.mockReturnValue(makeQuery(advances))
      const result = await service.findAllByClient(clientId)
      expect(mockAdvanceModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: expect.any(Types.ObjectId) })
      )
      expect(result).toEqual(advances)
    })
  })

  // ── findMyAdvances ────────────────────────────────────────────────────
  describe('findMyAdvances', () => {
    it('returns advances filtered by userId and clientId', async () => {
      const advances = [makeMockAdvance()]
      mockAdvanceModel.find.mockReturnValue(makeQuery(advances))
      const result = await service.findMyAdvances(userId, clientId)
      expect(mockAdvanceModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.any(Types.ObjectId),
          clientId: expect.any(Types.ObjectId),
        })
      )
      expect(result).toEqual(advances)
    })
  })

  // ── findPending ───────────────────────────────────────────────────────
  describe('findPending', () => {
    it('returns advances in pending_l1, pending_l2, or approved status', async () => {
      const advances = [
        makeMockAdvance({ status: 'pending_l1' }),
        makeMockAdvance({ status: 'approved' }),
      ]
      mockAdvanceModel.find.mockReturnValue(makeQuery(advances))
      const result = await service.findPending(clientId)
      const findCall = mockAdvanceModel.find.mock.calls[0][0]
      expect(findCall.status.$in).toEqual(
        expect.arrayContaining(['pending_l1', 'pending_l2', 'approved'])
      )
      expect(result).toEqual(advances)
    })
  })

  // ── findForViaticosPage ───────────────────────────────────────────────
  describe('findForViaticosPage', () => {
    it('returns all client advances for admin role', async () => {
      const advances = [makeMockAdvance()]
      mockAdvanceModel.find.mockReturnValue(makeQuery(advances))
      await service.findForViaticosPage({
        requesterId: userId,
        requesterRole: 'Administrador',
        clientId,
      })
      const findCall = mockAdvanceModel.find.mock.calls[0][0]
      expect(findCall.coordinatorId).toBeUndefined()
    })

    it('filters by coordinatorId for non-admin with canApproveL1', async () => {
      const advances = [makeMockAdvance()]
      mockAdvanceModel.find.mockReturnValue(makeQuery(advances))
      await service.findForViaticosPage({
        requesterId: userId,
        requesterRole: 'Colaborador',
        requesterPermissions: { canApproveL1: true },
        clientId,
      })
      const findCall = mockAdvanceModel.find.mock.calls[0][0]
      expect(findCall.coordinatorId).toBeDefined()
    })

    it('filters by own userId for collaborator with viaticos module but no canApproveL1', async () => {
      const advances = [makeMockAdvance()]
      mockAdvanceModel.find.mockReturnValue(makeQuery(advances))
      await service.findForViaticosPage({
        requesterId: userId,
        requesterRole: 'Colaborador',
        requesterPermissions: { canApproveL1: false, modules: ['viaticos'] },
        clientId,
      })
      const findCall = mockAdvanceModel.find.mock.calls[0][0]
      expect(findCall.coordinatorId).toBeUndefined()
      expect(findCall.userId).toBeDefined()
    })

    it('applies status filter when provided', async () => {
      mockAdvanceModel.find.mockReturnValue(makeQuery([]))
      await service.findForViaticosPage({
        requesterId: userId,
        requesterRole: 'Administrador',
        clientId,
        status: 'approved',
      })
      const findCall = mockAdvanceModel.find.mock.calls[0][0]
      expect(findCall.status).toBe('approved')
    })

    it('does not apply status filter when status is "all"', async () => {
      mockAdvanceModel.find.mockReturnValue(makeQuery([]))
      await service.findForViaticosPage({
        requesterId: userId,
        requesterRole: 'Administrador',
        clientId,
        status: 'all',
      })
      const findCall = mockAdvanceModel.find.mock.calls[0][0]
      expect(findCall.status).toBeUndefined()
    })
  })

  // ── findPaymentReceiptsForCollaborator ────────────────────────────────
  describe('findPaymentReceiptsForCollaborator', () => {
    it('filters by userId, clientId and receipt status', async () => {
      const leanQuery = {
        ...makeQuery([]),
        lean: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
      }
      mockAdvanceModel.find.mockReturnValue(leanQuery)
      await service.findPaymentReceiptsForCollaborator(userId, clientId)
      expect(mockAdvanceModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.objectContaining({
            $in: expect.arrayContaining(['paid', 'settled']),
          }),
        })
      )
    })
  })

  // ── findByExpenseReportId ─────────────────────────────────────────────
  describe('findByExpenseReportId', () => {
    it('queries by expenseReportId when no advanceIds provided', async () => {
      mockAdvanceModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      })
      await service.findByExpenseReportId(reportId)
      const findCall = mockAdvanceModel.find.mock.calls[0][0]
      expect(findCall.expenseReportId).toBeDefined()
    })

    it('queries by $or when advanceIds are provided', async () => {
      mockAdvanceModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      })
      await service.findByExpenseReportId(reportId, [advanceId])
      const findCall = mockAdvanceModel.find.mock.calls[0][0]
      expect(findCall.$or).toBeDefined()
    })
  })

  // ── findPendingReturns ────────────────────────────────────────────────
  describe('findPendingReturns', () => {
    it('queries for pending/proof_uploaded/rejected returnRecord status', async () => {
      mockAdvanceModel.find.mockReturnValue(makeQuery([]))
      await service.findPendingReturns(clientId)
      const findCall = mockAdvanceModel.find.mock.calls[0][0]
      expect(findCall['returnRecord.status'].$in).toEqual(
        expect.arrayContaining(['pending', 'proof_uploaded', 'rejected'])
      )
    })
  })

  // ── liquidateExpenseReport ────────────────────────────────────────────
  describe('liquidateExpenseReport', () => {
    it('returns early when report is not in approved status', async () => {
      mockExpenseReportService.findOneWithAdvances.mockResolvedValue({
        status: 'open',
        clientId,
        advanceIds: [],
        expenseIds: [],
      })
      await service.liquidateExpenseReport(reportId)
      expect(mockAdvanceModel.find).not.toHaveBeenCalled()
    })

    it('returns early when report is not found', async () => {
      mockExpenseReportService.findOneWithAdvances.mockResolvedValue(null)
      await service.liquidateExpenseReport(reportId)
      expect(mockAdvanceModel.find).not.toHaveBeenCalled()
    })

    it('marks paid advances as settled and saves settlement', async () => {
      const paidAdvance = makeMockAdvance({ status: 'paid', amount: 500 })
      mockExpenseReportService.findOneWithAdvances.mockResolvedValue({
        status: 'approved',
        clientId: new Types.ObjectId(clientId),
        advanceIds: [],
        expenseIds: [{ status: 'approved', total: 300 }],
      })
      mockAdvanceModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([paidAdvance]),
      })
      await service.liquidateExpenseReport(reportId)
      expect(paidAdvance.status).toBe('settled')
      expect(paidAdvance.save).toHaveBeenCalled()
      expect(mockExpenseReportService.updateSettlement).toHaveBeenCalledWith(
        reportId,
        expect.objectContaining({ type: 'devolucion' })
      )
    })
  })

  // ── resubmitRejected ─────────────────────────────────────────────────
  describe('resubmitRejected', () => {
    const validDto: any = {
      place: 'Lima',
      startDate: '2026-01-01',
      endDate: '2026-01-05',
      projectId: new Types.ObjectId().toString(),
      lines: [],
      amount: 100,
    }

    it('throws NotFoundException when advance is not found', async () => {
      mockAdvanceModel.findById.mockReturnValue(null)
      await expect(
        service.resubmitRejected(advanceId, validDto, userId, clientId)
      ).rejects.toThrow(NotFoundException)
    })

    it('throws BadRequestException when advance is in invalid state', async () => {
      const advance = makeMockAdvance({ status: 'approved' })
      mockAdvanceModel.findById.mockResolvedValue(advance)
      await expect(
        service.resubmitRejected(advanceId, validDto, userId, clientId)
      ).rejects.toThrow(BadRequestException)
    })

    it('throws ForbiddenException when acting user is not the owner', async () => {
      const advance = makeMockAdvance({
        status: 'rejected',
        userId: new Types.ObjectId(),
      })
      mockAdvanceModel.findById.mockResolvedValue(advance)
      await expect(
        service.resubmitRejected(advanceId, validDto, userId, clientId)
      ).rejects.toThrow(ForbiddenException)
    })

    it('throws ForbiddenException when clientId does not match', async () => {
      const advance = makeMockAdvance({
        status: 'rejected',
        userId: new Types.ObjectId(userId),
        clientId: new Types.ObjectId(),
      })
      mockAdvanceModel.findById.mockResolvedValue(advance)
      await expect(
        service.resubmitRejected(advanceId, validDto, userId, clientId)
      ).rejects.toThrow(ForbiddenException)
    })

    it('throws ForbiddenException when user has no signature', async () => {
      const advance = makeMockAdvance({
        status: 'rejected',
        userId: new Types.ObjectId(userId),
        clientId: new Types.ObjectId(clientId),
      })
      mockAdvanceModel.findById.mockResolvedValue(advance)
      mockUserService.findTransactionalProfile.mockResolvedValue({
        signature: '',
      })
      await expect(
        service.resubmitRejected(advanceId, validDto, userId, clientId)
      ).rejects.toThrow(ForbiddenException)
    })
  })

  // ── cancelByCollaborator ──────────────────────────────────────────────
  describe('cancelByCollaborator', () => {
    it('throws NotFoundException when advance is not found', async () => {
      mockAdvanceModel.findById.mockResolvedValue(null)
      await expect(
        service.cancelByCollaborator(advanceId, userId)
      ).rejects.toThrow(NotFoundException)
    })

    it('throws ForbiddenException when user is not the owner', async () => {
      const advance = makeMockAdvance({
        status: 'pending_l1',
        userId: new Types.ObjectId(),
      })
      mockAdvanceModel.findById.mockResolvedValue(advance)
      await expect(
        service.cancelByCollaborator(advanceId, userId)
      ).rejects.toThrow(ForbiddenException)
    })

    it('throws BadRequestException when advance is not in pending_l1 status', async () => {
      const advance = makeMockAdvance({
        status: 'approved',
        userId: new Types.ObjectId(userId),
      })
      mockAdvanceModel.findById.mockResolvedValue(advance)
      await expect(
        service.cancelByCollaborator(advanceId, userId)
      ).rejects.toThrow(BadRequestException)
    })

    it('cancels advance and sets status to cancelled', async () => {
      const advance = makeMockAdvance({
        status: 'pending_l1',
        userId: new Types.ObjectId(userId),
      })
      mockAdvanceModel.findById.mockResolvedValue(advance)
      mockUserService.findTransactionalProfile.mockResolvedValue({
        coordinatorId: null,
      })
      const result = await service.cancelByCollaborator(advanceId, userId)
      expect(advance.status).toBe('cancelled')
      expect(advance.save).toHaveBeenCalled()
    })
  })

  // ── resendCoordinatorNotification ─────────────────────────────────────
  describe('resendCoordinatorNotification', () => {
    it('throws ForbiddenException when advance clientId does not match', async () => {
      const advance = makeMockAdvance({
        clientId: new Types.ObjectId(),
        userId: new Types.ObjectId(userId),
      })
      mockAdvanceModel.findById.mockReturnValue(makeQuery(advance))
      await expect(
        service.resendCoordinatorNotification(advanceId, clientId)
      ).rejects.toThrow(ForbiddenException)
    })
  })
})
