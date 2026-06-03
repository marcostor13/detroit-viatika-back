import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { Types } from 'mongoose'
import { ExpenseReportService } from './expense-report.service'
import { ExpenseReport } from './entities/expense-report.entity'
import { Expense } from '../expense/entities/expense.entity'
import { EmailService } from '../email/email.service'
import { NotificationsService } from '../notifications/notifications.service'
import { UserService } from '../user/user.service'
import { AdvanceService } from '../advance/advance.service'
import { ROLES } from '../auth/enums/roles.enum'

const mockAdvanceService = {
  liquidateExpenseReport: jest.fn().mockResolvedValue(undefined),
  findPaymentReceiptsForCollaborator: jest.fn().mockResolvedValue([]),
}

const reportId = new Types.ObjectId().toString()
const expenseId1 = new Types.ObjectId().toString()
const expenseId2 = new Types.ObjectId().toString()
const clientId = new Types.ObjectId().toString()
const userId = new Types.ObjectId().toString()

const mockEmailService = {
  sendRendicionFullyApprovedEmail: jest.fn().mockResolvedValue(undefined),
  sendRendicionReembolsoPagado: jest.fn().mockResolvedValue(undefined),
  buildAppUrl: jest.fn().mockReturnValue('http://localhost:4200/app'),
}

const mockNotificationsService = {
  create: jest.fn().mockResolvedValue(undefined),
}

const mockUserService = {
  findAdminsByClient: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue({ name: 'Colaborador Test', email: 'c@test.com' }),
  findTransactionalProfile: jest.fn().mockResolvedValue(null),
  findEmailNameClient: jest.fn().mockResolvedValue(null),
  findContabilidadRecipients: jest.fn().mockResolvedValue([]),
  isEmailEnabled: jest.fn().mockResolvedValue(true),
}

describe('ExpenseReportService — Fase 5 (envío y aprobación final)', () => {
  let service: ExpenseReportService
  let mockExpenseReportModel: Record<string, jest.Mock>

  const fullReportDoc = () => ({
    _id: new Types.ObjectId(reportId),
    title: 'Rendición test',
    budget: 1000,
    clientId: new Types.ObjectId(clientId),
    userId: { _id: new Types.ObjectId(userId), name: 'Colaborador', email: 'u@test.com' },
    expenseIds: [],
    status: 'open',
  })

  beforeEach(async () => {
    jest.clearAllMocks()

    mockExpenseReportModel = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({}),
      }),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseReportService,
        { provide: getModelToken(ExpenseReport.name), useValue: mockExpenseReportModel },
        { provide: getModelToken(Expense.name), useValue: {} },
        { provide: EmailService, useValue: mockEmailService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: UserService, useValue: mockUserService },
        { provide: AdvanceService, useValue: mockAdvanceService },
      ],
    }).compile()

    service = module.get<ExpenseReportService>(ExpenseReportService)
  })

  function mockFindByIdSequence(opts: {
    existingStatus: string
    submitPopulateResult?: { expenseIds: unknown[] }
  }) {
    let call = 0
    mockExpenseReportModel.findById.mockImplementation(() => {
      call++
      if (call === 1) {
        return {
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue({ status: opts.existingStatus }),
            }),
          }),
        }
      }
      if (call === 2 && opts.submitPopulateResult !== undefined) {
        return {
          populate: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              lean: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(opts.submitPopulateResult),
              }),
            }),
          }),
        }
      }
      const chain: { populate: jest.Mock; exec: jest.Mock } = {
        populate: jest.fn(),
        exec: jest.fn(),
      }
      chain.populate.mockReturnValue(chain)
      chain.exec.mockResolvedValue(fullReportDoc())
      return chain
    })
  }

  it('update(submitted): rechaza si no hay gastos', async () => {
    mockFindByIdSequence({
      existingStatus: 'open',
      submitPopulateResult: { expenseIds: [] },
    })

    await expect(service.update(reportId, { status: 'submitted' })).rejects.toThrow(
      /al menos un gasto/
    )

    expect(mockExpenseReportModel.findByIdAndUpdate).not.toHaveBeenCalled()
  })

  it('update(submitted): rechaza si hay gasto rechazado', async () => {
    mockFindByIdSequence({
      existingStatus: 'open',
      submitPopulateResult: {
        expenseIds: [{ _id: expenseId1, status: 'rejected', file: '/f.pdf' }],
      },
    })

    await expect(service.update(reportId, { status: 'submitted' })).rejects.toThrow(/rechazados/)
    expect(mockExpenseReportModel.findByIdAndUpdate).not.toHaveBeenCalled()
  })

  it('update(submitted): persiste aunque algún gasto no tenga archivo adjunto', async () => {
    mockFindByIdSequence({
      existingStatus: 'open',
      submitPopulateResult: {
        expenseIds: [{ _id: expenseId1, status: 'approved', file: '' }],
      },
    })

    const result = await service.update(reportId, { status: 'submitted' })

    expect(mockExpenseReportModel.findByIdAndUpdate).toHaveBeenCalled()
    expect(result).toBeDefined()
    expect(mockNotificationsService.create).not.toHaveBeenCalled()
    mockUserService.findAdminsByClient.mockResolvedValueOnce([
      { _id: new Types.ObjectId(), email: 'admin@test.com' },
    ])
    mockFindByIdSequence({
      existingStatus: 'open',
      submitPopulateResult: {
        expenseIds: [{ _id: expenseId1, status: 'approved', file: '/ok.pdf' }],
      },
    })
    await service.update(reportId, { status: 'submitted' })
    expect(mockNotificationsService.create).toHaveBeenCalled()
  })

  it('update(approved): rechaza si la rendicion no está en pending_accounting', async () => {
    mockExpenseReportModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ status: 'submitted' }),
        }),
      }),
    })

    await expect(service.update(reportId, { status: 'approved' })).rejects.toThrow(
      /Solo se puede aprobar una rendicion pendiente de contabilidad/
    )
    expect(mockExpenseReportModel.findByIdAndUpdate).not.toHaveBeenCalled()
  })

  it('update(approved): persiste cuando la rendicion está en pending_accounting', async () => {
    let call = 0
    mockExpenseReportModel.findById.mockImplementation(() => {
      call++
      if (call === 1) {
        return {
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue({ status: 'pending_accounting' }),
            }),
          }),
        }
      }
      const chain: { populate: jest.Mock; exec: jest.Mock } = {
        populate: jest.fn(),
        exec: jest.fn(),
      }
      chain.populate.mockReturnValue(chain)
      chain.exec.mockResolvedValue({
        ...fullReportDoc(),
        expenseIds: [],
        status: 'approved',
      })
      return chain
    })

    await service.update(reportId, { status: 'approved' })

    expect(mockExpenseReportModel.findByIdAndUpdate).toHaveBeenCalled()
    expect(mockEmailService.sendRendicionFullyApprovedEmail).toHaveBeenCalled()
  })

  describe('registerAffidavit — Fase 5 declaración jurada', () => {
    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('rechaza si la rendición no está cerrada', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        ...fullReportDoc(),
        status: 'approved',
        expenseIds: [{ _id: expenseId1 }],
      } as never)

      await expect(
        service.registerAffidavit(
          reportId,
          { type: 'viaticos_nacionales', expenseIds: [expenseId1] },
          userId
        )
      ).rejects.toThrow(/cerrada/)
    })

    it('rechaza si un gasto no pertenece a la rendición', async () => {
      const foreignId = new Types.ObjectId().toString()
      jest.spyOn(service, 'findOne').mockResolvedValue({
        ...fullReportDoc(),
        status: 'closed',
        expenseIds: [{ _id: expenseId1 }],
      } as never)

      await expect(
        service.registerAffidavit(
          reportId,
          { type: 'viajes_exterior', expenseIds: [foreignId] },
          userId
        )
      ).rejects.toThrow(/no pertenecen/)
    })

    it('actualiza el reporte cuando es válido', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        ...fullReportDoc(),
        status: 'closed',
        expenseIds: [{ _id: expenseId1 }, { _id: expenseId2 }],
      } as never)

      const out = await service.registerAffidavit(
        reportId,
        { type: 'viaticos_nacionales', expenseIds: [expenseId1] },
        userId
      )

      expect(mockExpenseReportModel.findByIdAndUpdate).toHaveBeenCalledWith(
        reportId,
        expect.objectContaining({
          $push: expect.objectContaining({
            affidavits: expect.objectContaining({
              type: 'viaticos_nacionales',
            }),
          }),
        })
      )
      expect(out.reportId).toBe(reportId)
      expect(out.expenseIds).toEqual([expenseId1])
    })
  })
})

describe('ExpenseReportService — Fase 8 (cierre definitivo)', () => {
  let service: ExpenseReportService
  let mockExpenseReportModel: Record<string, jest.Mock>

  const mockEmailServicePhase8 = {
    sendRendicionFullyApprovedEmail: jest.fn().mockResolvedValue(undefined),
    sendRendicionReembolsoPagado: jest.fn().mockResolvedValue(undefined),
    sendRendicionCerrada: jest.fn().mockResolvedValue(undefined),
    buildAppUrl: jest.fn().mockReturnValue('http://localhost:4200/app'),
  }

  const mockUserServicePhase8 = {
    findAdminsByClient: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue({ name: 'Colaborador', email: 'c@test.com' }),
    findTransactionalProfile: jest.fn().mockResolvedValue(null),
    findEmailNameClient: jest.fn().mockResolvedValue({ name: 'Colaborador', email: 'c@test.com' }),
    findAccountingRecipientsWithIds: jest.fn().mockResolvedValue([]),
    isEmailEnabled: jest.fn().mockResolvedValue(true),
  }

  function makeReportDoc(overrides: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId(reportId),
      title: 'Rendición Test',
      status: 'approved',
      clientId: new Types.ObjectId(clientId),
      userId: new Types.ObjectId(userId),
      settlement: { type: 'reembolso' as const, difference: -50 },
      expenseIds: [],
      closureRecord: undefined,
      ...overrides,
    }
  }

  beforeEach(async () => {
    jest.clearAllMocks()

    mockExpenseReportModel = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(makeReportDoc({ status: 'closed' })),
      }),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseReportService,
        { provide: getModelToken(ExpenseReport.name), useValue: mockExpenseReportModel },
        { provide: getModelToken(Expense.name), useValue: {} },
        { provide: EmailService, useValue: mockEmailServicePhase8 },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: UserService, useValue: mockUserServicePhase8 },
        { provide: AdvanceService, useValue: mockAdvanceService },
      ],
    }).compile()

    service = module.get<ExpenseReportService>(ExpenseReportService)
  })

  describe('validateClosureConditions', () => {
    it('devuelve error si la rendición ya está cerrada', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(makeReportDoc({ status: 'closed' })),
        }),
      })
      const errors = await service.validateClosureConditions(reportId)
      expect(errors).toContain('La rendición ya está cerrada')
    })

    it('devuelve error si estado no es approved ni reimbursed', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(makeReportDoc({ status: 'submitted' })),
        }),
      })
      const errors = await service.validateClosureConditions(reportId)
      expect(errors.some(e => e.includes('submitted'))).toBe(true)
    })

    it('devuelve error si hay gasto con devolución pendiente sin validar', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(makeReportDoc({
            status: 'reimbursed',
            settlement: { type: 'reembolso' },
            returnRecord: { status: 'proof_uploaded' },
          })),
        }),
      })
      const errors = await service.validateClosureConditions(reportId)
      expect(errors.some(e => e.includes('Devolución pendiente'))).toBe(true)
    })

    it('devuelve lista vacía cuando todas las condiciones se cumplen', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(makeReportDoc({
            status: 'reimbursed',
            settlement: { type: 'reembolso' },
            reimbursementPaymentInfo: { method: 'transferencia_bancaria' },
            expenseIds: [],
          })),
        }),
      })
      const errors = await service.validateClosureConditions(reportId)
      expect(errors).toHaveLength(0)
    })
  })

  describe('close', () => {
    it('lanza BadRequestException si hay errores de validación', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(makeReportDoc({ status: 'submitted' })),
        }),
      })
      await expect(service.close(reportId, userId)).rejects.toThrow(BadRequestException)
    })

    it('cierra la rendición y envía email al colaborador', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(makeReportDoc({
            status: 'reimbursed',
            settlement: { type: 'reembolso' },
            reimbursementPaymentInfo: { method: 'transferencia_bancaria' },
          })),
        }),
      })
      const updatedDoc = makeReportDoc({ status: 'closed' })
      mockExpenseReportModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedDoc),
      })

      const result = await service.close(reportId, userId)

      expect(mockExpenseReportModel.findByIdAndUpdate).toHaveBeenCalledWith(
        reportId,
        expect.objectContaining({ $set: expect.objectContaining({ status: 'closed' }) }),
        { new: true }
      )
      expect(result.status).toBe('closed')
    })
  })

  describe('requestReopening', () => {
    it('lanza BadRequestException si la rendición no está cerrada', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(makeReportDoc({ status: 'approved' })),
      })
      const longReason = 'x'.repeat(200)
      await expect(service.requestReopening(reportId, userId, longReason)).rejects.toThrow(/cerradas/)
    })

    it('lanza BadRequestException si el motivo es menor a 200 caracteres', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(makeReportDoc({ status: 'closed' })),
      })
      await expect(service.requestReopening(reportId, userId, 'corto')).rejects.toThrow(/200 caracteres/)
    })

    it('persiste la solicitud de reapertura con motivo válido', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(makeReportDoc({ status: 'closed', closureRecord: { reopeningStatus: 'none' } })),
      })
      const updatedDoc = makeReportDoc({ status: 'closed' })
      mockExpenseReportModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedDoc),
      })

      const longReason = 'x'.repeat(200)
      await service.requestReopening(reportId, userId, longReason)

      expect(mockExpenseReportModel.findByIdAndUpdate).toHaveBeenCalledWith(
        reportId,
        expect.objectContaining({
          $set: expect.objectContaining({
            closureRecord: expect.objectContaining({ reopeningStatus: 'requested' }),
          }),
        }),
        { new: true }
      )
    })
  })

  describe('approveReopening', () => {
    it('lanza BadRequestException si no hay solicitud de reapertura pendiente', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(makeReportDoc({
          status: 'closed',
          closureRecord: { reopeningStatus: 'none' },
        })),
      })
      await expect(service.approveReopening(reportId, userId, true)).rejects.toThrow(/pendiente/)
    })

    it('aprueba la reapertura: vuelve a estado approved', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(makeReportDoc({
          status: 'closed',
          closureRecord: { reopeningStatus: 'requested', closedAt: new Date(), closedBy: userId },
        })),
      })
      const updatedDoc = makeReportDoc({ status: 'approved' })
      mockExpenseReportModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedDoc),
      })

      const result = await service.approveReopening(reportId, userId, true)

      expect(mockExpenseReportModel.findByIdAndUpdate).toHaveBeenCalledWith(
        reportId,
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'approved' }),
        }),
        { new: true }
      )
      expect(result.status).toBe('approved')
    })

    it('rechaza la reapertura: mantiene estado closed', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(makeReportDoc({
          status: 'closed',
          closureRecord: { reopeningStatus: 'requested', closedAt: new Date(), closedBy: userId },
        })),
      })
      const updatedDoc = makeReportDoc({ status: 'closed' })
      mockExpenseReportModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedDoc),
      })

      await service.approveReopening(reportId, userId, false)

      const updateCall = mockExpenseReportModel.findByIdAndUpdate.mock.calls[0][1]
      expect(updateCall.$set.closureRecord.reopeningStatus).toBe('none')
      expect(updateCall.$set.status).toBeUndefined()
    })
  })

  describe('assertNotClosed', () => {
    it('lanza ForbiddenException si la rendición está cerrada', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(makeReportDoc({ status: 'closed' })),
        }),
      })
      await expect(service.assertNotClosed(reportId)).rejects.toThrow(ForbiddenException)
    })

    it('no lanza si la rendición no está cerrada', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(makeReportDoc({ status: 'approved' })),
        }),
      })
      await expect(service.assertNotClosed(reportId)).resolves.toBeUndefined()
    })
  })
})

const validReimbursementDto = {
  method: 'transferencia_bancaria' as const,
  transferDate: '2025-01-15T00:00:00.000Z',
  paymentReceiptUrl: 'https://cdn.example.com/comprobante.pdf',
  paymentReceiptFileName: 'comprobante.pdf',
  paymentReceiptMimeType: 'application/pdf',
  paymentReceiptSizeBytes: 1024,
}

describe('ExpenseReportService — Fase 6 (reembolso: tenant y registro)', () => {
  let service: ExpenseReportService
  let mockExpenseReportModel: Record<string, jest.Mock>
  const clientA = new Types.ObjectId()
  const clientB = new Types.ObjectId()

  function reimbursementReportDoc(overrides: {
    clientId?: Types.ObjectId
    save?: jest.Mock
  }) {
    const save =
      overrides.save ?? jest.fn().mockImplementation(function mockSave(this: unknown) {
        return Promise.resolve(this)
      })
    return {
      _id: new Types.ObjectId(reportId),
      title: 'Rendición reembolso',
      clientId: overrides.clientId ?? clientA,
      userId: {
        _id: new Types.ObjectId(userId),
        name: 'Colaborador',
        email: 'col@test.com',
      },
      status: 'approved',
      settlement: { type: 'reembolso' as const, difference: 120.5 },
      reimbursementPaymentInfo: undefined,
      save,
    }
  }

  function populateChainExecResult() {
    return {
      _id: new Types.ObjectId(reportId),
      title: 'Rendición reembolso',
      clientId: clientA,
      userId: {
        _id: new Types.ObjectId(userId),
        name: 'Colaborador',
        email: 'col@test.com',
      },
      status: 'reimbursed',
      settlement: { type: 'reembolso', difference: 120.5 },
      reimbursementPaymentInfo: {
        method: 'transferencia_bancaria',
        paymentReceiptUrl: validReimbursementDto.paymentReceiptUrl,
        paymentReceiptFileName: validReimbursementDto.paymentReceiptFileName,
        paymentReceiptMimeType: validReimbursementDto.paymentReceiptMimeType,
        transferDate: new Date(validReimbursementDto.transferDate),
        reference: 'REF-1',
      },
      expenseIds: [],
    }
  }

  beforeEach(async () => {
    jest.clearAllMocks()

    mockExpenseReportModel = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({}),
      }),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseReportService,
        { provide: getModelToken(ExpenseReport.name), useValue: mockExpenseReportModel },
        { provide: getModelToken(Expense.name), useValue: {} },
        { provide: EmailService, useValue: mockEmailService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: UserService, useValue: mockUserService },
        { provide: AdvanceService, useValue: mockAdvanceService },
      ],
    }).compile()

    service = module.get<ExpenseReportService>(ExpenseReportService)
  })

  it('registerReimbursementPayment: Forbidden si tenant distinto al cliente de la rendición', async () => {
    const doc = reimbursementReportDoc({ clientId: clientA })
    mockExpenseReportModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    })

    await expect(
      service.registerReimbursementPayment(
        reportId,
        validReimbursementDto,
        ROLES.ADMIN,
        { canApproveL2: true },
        { requestClientId: clientB.toHexString(), isSuperAdmin: false }
      )
    ).rejects.toThrow(ForbiddenException)

    expect(doc.save).not.toHaveBeenCalled()
  })

  it('registerReimbursementPayment: Forbidden si requestClientId vacío', async () => {
    const doc = reimbursementReportDoc({ clientId: clientA })
    mockExpenseReportModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    })

    await expect(
      service.registerReimbursementPayment(
        reportId,
        validReimbursementDto,
        ROLES.ADMIN,
        { canApproveL2: true },
        { requestClientId: '', isSuperAdmin: false }
      )
    ).rejects.toThrow(ForbiddenException)

    expect(doc.save).not.toHaveBeenCalled()
  })

  it('registerReimbursementPayment: superadmin omite chequeo de tenant aunque clientId no coincida', async () => {
    const doc = reimbursementReportDoc({ clientId: clientA })
    const chain = {
      populate: jest.fn(),
      exec: jest.fn().mockResolvedValue(populateChainExecResult()),
    }
    chain.populate.mockReturnValue(chain)
    let findByIdCall = 0
    mockExpenseReportModel.findById.mockImplementation(() => {
      findByIdCall++
      if (findByIdCall === 1) {
        return { exec: jest.fn().mockResolvedValue(doc) }
      }
      return chain
    })

    await service.registerReimbursementPayment(
      reportId,
      validReimbursementDto,
      ROLES.SUPER_ADMIN,
      {},
      { requestClientId: clientB.toHexString(), isSuperAdmin: true }
    )

    expect(mockExpenseReportModel.findByIdAndUpdate).toHaveBeenCalled()
    expect(mockEmailService.sendRendicionReembolsoPagado).toHaveBeenCalled()
  })

  it('registerReimbursementPayment: persiste con tenant coincidente', async () => {
    const doc = reimbursementReportDoc({ clientId: clientA })
    const chain = {
      populate: jest.fn(),
      exec: jest.fn().mockResolvedValue(populateChainExecResult()),
    }
    chain.populate.mockReturnValue(chain)
    let findByIdCall = 0
    mockExpenseReportModel.findById.mockImplementation(() => {
      findByIdCall++
      if (findByIdCall === 1) {
        return { exec: jest.fn().mockResolvedValue(doc) }
      }
      return chain
    })

    const out = await service.registerReimbursementPayment(
      reportId,
      validReimbursementDto,
      ROLES.ADMIN,
      { canApproveL2: true },
      { requestClientId: clientA.toHexString(), isSuperAdmin: false }
    )

    expect(mockExpenseReportModel.findByIdAndUpdate).toHaveBeenCalled()
    expect(out.status).toBe('reimbursed')
    expect(mockEmailService.sendRendicionReembolsoPagado).toHaveBeenCalled()
  })
})
