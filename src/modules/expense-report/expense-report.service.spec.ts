import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { Types } from 'mongoose'
import { ExpenseReportService } from './expense-report.service'
import { ExpenseReport } from './entities/expense-report.entity'
import { Expense } from '../expense/entities/expense.entity'
import { CajaChicaReport } from '../caja-chica-report/entities/caja-chica-report.entity'
import { EmailService } from '../email/email.service'
import { NotificationsService } from '../notifications/notifications.service'
import { UserService } from '../user/user.service'
import { AdvanceService } from '../advance/advance.service'
import { UploadService } from '../upload/upload.service'
import { ProjectService } from '../project/project.service'
import { CategoryService } from '../category/category.service'
import { ROLES } from '../auth/enums/roles.enum'
import { ChainStep } from '../advance/approval-chain.util'

const mockAdvanceService = {
  liquidateExpenseReport: jest.fn().mockResolvedValue(undefined),
  findPaymentReceiptsForCollaborator: jest.fn().mockResolvedValue([]),
  findByExpenseReportId: jest.fn().mockResolvedValue([]),
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
  formatDateDDMMYYYY: jest.fn().mockReturnValue('01/01/2026'),
}

const mockNotificationsService = {
  create: jest.fn().mockResolvedValue(undefined),
}

const mockUserService = {
  findAdminsByClient: jest.fn().mockResolvedValue([]),
  findOne: jest
    .fn()
    .mockResolvedValue({ name: 'Colaborador Test', email: 'c@test.com' }),
  findTransactionalProfile: jest.fn().mockResolvedValue(null),
  findEmailNameClient: jest.fn().mockResolvedValue(null),
  findContabilidadRecipients: jest.fn().mockResolvedValue([]),
  findTesoreriaNotifyRecipients: jest.fn().mockResolvedValue([]),
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
    userId: {
      _id: new Types.ObjectId(userId),
      name: 'Colaborador',
      email: 'u@test.com',
    },
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
        {
          provide: getModelToken(ExpenseReport.name),
          useValue: mockExpenseReportModel,
        },
        { provide: getModelToken(Expense.name), useValue: {} },
        {
          provide: getModelToken(CajaChicaReport.name),
          useValue: {
            countDocuments: jest
              .fn()
              .mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
          },
        },
        { provide: EmailService, useValue: mockEmailService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: UserService, useValue: mockUserService },
        { provide: AdvanceService, useValue: mockAdvanceService },
        { provide: UploadService, useValue: {} },
        { provide: ProjectService, useValue: {} },
        { provide: CategoryService, useValue: {} },
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
              exec: jest
                .fn()
                .mockResolvedValue({ status: opts.existingStatus }),
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

    await expect(
      service.update(reportId, { status: 'submitted' })
    ).rejects.toThrow(/al menos un gasto/)

    expect(mockExpenseReportModel.findByIdAndUpdate).not.toHaveBeenCalled()
  })

  it('update(submitted): rechaza si hay gasto rechazado', async () => {
    mockFindByIdSequence({
      existingStatus: 'open',
      submitPopulateResult: {
        expenseIds: [{ _id: expenseId1, status: 'rejected', file: '/f.pdf' }],
      },
    })

    await expect(
      service.update(reportId, { status: 'submitted' })
    ).rejects.toThrow(/rechazados/)
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

    await expect(
      service.update(reportId, { status: 'approved' })
    ).rejects.toThrow(
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
              exec: jest
                .fn()
                .mockResolvedValue({ status: 'pending_accounting' }),
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
    formatDateDDMMYYYY: jest.fn().mockReturnValue('01/01/2026'),
  }

  const mockUserServicePhase8 = {
    findAdminsByClient: jest.fn().mockResolvedValue([]),
    findOne: jest
      .fn()
      .mockResolvedValue({ name: 'Colaborador', email: 'c@test.com' }),
    findTransactionalProfile: jest.fn().mockResolvedValue(null),
    findEmailNameClient: jest
      .fn()
      .mockResolvedValue({ name: 'Colaborador', email: 'c@test.com' }),
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
        {
          provide: getModelToken(ExpenseReport.name),
          useValue: mockExpenseReportModel,
        },
        { provide: getModelToken(Expense.name), useValue: {} },
        {
          provide: getModelToken(CajaChicaReport.name),
          useValue: {
            countDocuments: jest
              .fn()
              .mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
          },
        },
        { provide: EmailService, useValue: mockEmailServicePhase8 },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: UserService, useValue: mockUserServicePhase8 },
        { provide: AdvanceService, useValue: mockAdvanceService },
        { provide: UploadService, useValue: {} },
        { provide: ProjectService, useValue: {} },
        { provide: CategoryService, useValue: {} },
      ],
    }).compile()

    service = module.get<ExpenseReportService>(ExpenseReportService)
  })

  describe('validateClosureConditions', () => {
    it('devuelve error si la rendición ya está cerrada', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest
            .fn()
            .mockResolvedValue(makeReportDoc({ status: 'closed' })),
        }),
      })
      const errors = await service.validateClosureConditions(reportId)
      expect(errors).toContain('La rendición ya está cerrada')
    })

    it('devuelve error si estado no es approved ni reimbursed', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest
            .fn()
            .mockResolvedValue(makeReportDoc({ status: 'submitted' })),
        }),
      })
      const errors = await service.validateClosureConditions(reportId)
      expect(errors.some(e => e.includes('submitted'))).toBe(true)
    })

    it('devuelve error si hay gasto con devolución pendiente sin validar', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(
            makeReportDoc({
              status: 'reimbursed',
              settlement: { type: 'reembolso' },
              returnRecord: { status: 'proof_uploaded' },
            })
          ),
        }),
      })
      const errors = await service.validateClosureConditions(reportId)
      expect(errors.some(e => e.includes('Devolución pendiente'))).toBe(true)
    })

    it('devuelve lista vacía cuando todas las condiciones se cumplen', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(
            makeReportDoc({
              status: 'reimbursed',
              settlement: { type: 'reembolso' },
              reimbursementPaymentInfo: { method: 'transferencia_bancaria' },
              expenseIds: [],
            })
          ),
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
          exec: jest
            .fn()
            .mockResolvedValue(makeReportDoc({ status: 'submitted' })),
        }),
      })
      await expect(service.close(reportId, userId)).rejects.toThrow(
        BadRequestException
      )
    })

    it('cierra la rendición y envía email al colaborador', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(
            makeReportDoc({
              status: 'reimbursed',
              settlement: { type: 'reembolso' },
              reimbursementPaymentInfo: { method: 'transferencia_bancaria' },
            })
          ),
        }),
      })
      const updatedDoc = makeReportDoc({ status: 'closed' })
      mockExpenseReportModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedDoc),
      })

      const result = await service.close(reportId, userId)

      expect(mockExpenseReportModel.findByIdAndUpdate).toHaveBeenCalledWith(
        reportId,
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'closed' }),
        }),
        { new: true }
      )
      expect(result.status).toBe('closed')
    })
  })

  describe('requestReopening', () => {
    it('lanza BadRequestException si la rendición no está cerrada', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue(makeReportDoc({ status: 'approved' })),
      })
      const longReason = 'x'.repeat(200)
      await expect(
        service.requestReopening(reportId, userId, longReason)
      ).rejects.toThrow(/cerradas/)
    })

    it('lanza BadRequestException si el motivo es menor a 200 caracteres', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(makeReportDoc({ status: 'closed' })),
      })
      await expect(
        service.requestReopening(reportId, userId, 'corto')
      ).rejects.toThrow(/200 caracteres/)
    })

    it('persiste la solicitud de reapertura con motivo válido', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(
          makeReportDoc({
            status: 'closed',
            closureRecord: { reopeningStatus: 'none' },
          })
        ),
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
            closureRecord: expect.objectContaining({
              reopeningStatus: 'requested',
            }),
          }),
        }),
        { new: true }
      )
    })
  })

  describe('approveReopening', () => {
    it('lanza BadRequestException si no hay solicitud de reapertura pendiente', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(
          makeReportDoc({
            status: 'closed',
            closureRecord: { reopeningStatus: 'none' },
          })
        ),
      })
      await expect(
        service.approveReopening(reportId, userId, true)
      ).rejects.toThrow(/pendiente/)
    })

    it('aprueba la reapertura: vuelve a estado approved', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(
          makeReportDoc({
            status: 'closed',
            closureRecord: {
              reopeningStatus: 'requested',
              closedAt: new Date(),
              closedBy: userId,
            },
          })
        ),
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
        exec: jest.fn().mockResolvedValue(
          makeReportDoc({
            status: 'closed',
            closureRecord: {
              reopeningStatus: 'requested',
              closedAt: new Date(),
              closedBy: userId,
            },
          })
        ),
      })
      const updatedDoc = makeReportDoc({ status: 'closed' })
      mockExpenseReportModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedDoc),
      })

      await service.approveReopening(reportId, userId, false)

      const updateCall =
        mockExpenseReportModel.findByIdAndUpdate.mock.calls[0][1]
      expect(updateCall.$set.closureRecord.reopeningStatus).toBe('none')
      expect(updateCall.$set.status).toBeUndefined()
    })
  })

  describe('assertNotClosed', () => {
    it('lanza ForbiddenException si la rendición está cerrada', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest
            .fn()
            .mockResolvedValue(makeReportDoc({ status: 'closed' })),
        }),
      })
      await expect(service.assertNotClosed(reportId)).rejects.toThrow(
        ForbiddenException
      )
    })

    it('no lanza si la rendición no está cerrada', async () => {
      mockExpenseReportModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest
            .fn()
            .mockResolvedValue(makeReportDoc({ status: 'approved' })),
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
      overrides.save ??
      jest.fn().mockImplementation(function mockSave(this: unknown) {
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
        {
          provide: getModelToken(ExpenseReport.name),
          useValue: mockExpenseReportModel,
        },
        { provide: getModelToken(Expense.name), useValue: {} },
        {
          provide: getModelToken(CajaChicaReport.name),
          useValue: {
            countDocuments: jest
              .fn()
              .mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
          },
        },
        { provide: EmailService, useValue: mockEmailService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: UserService, useValue: mockUserService },
        { provide: AdvanceService, useValue: mockAdvanceService },
        { provide: UploadService, useValue: {} },
        { provide: ProjectService, useValue: {} },
        { provide: CategoryService, useValue: {} },
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

describe('ExpenseReportService — aprobación de SOLICITUD de viático (regla 1.3, en paralelo entre niveles)', () => {
  let service: ExpenseReportService
  let mockExpenseReportModel: Record<string, jest.Mock>

  const n1Id = new Types.ObjectId()
  const n2Id = new Types.ObjectId()
  const projectId = new Types.ObjectId()
  const solicitudReportId = new Types.ObjectId().toString()
  const solicitudUserId = new Types.ObjectId().toString()
  const solicitudClientId = new Types.ObjectId().toString()

  const mockUserServiceLocal = {
    findEmailNameClient: jest.fn().mockResolvedValue(null),
    findViaticoAccountingNotifyRecipients: jest.fn().mockResolvedValue([]),
    isEmailEnabled: jest.fn().mockResolvedValue(false),
  }
  const mockNotificationsServiceLocal = { create: jest.fn().mockResolvedValue(undefined) }
  const mockAdvanceServiceLocal = {}

  function makeChain(): ChainStep[] {
    return [
      { level: 2, projectId, projectRole: 'seleccionado', approverIds: [n1Id] },
    ]
  }

  function makeTwoStepChain(): ChainStep[] {
    return [
      { level: 2, projectId, projectRole: 'principal', approverIds: [n1Id] },
      { level: 2, projectId, projectRole: 'seleccionado', approverIds: [n2Id] },
    ]
  }

  function reportDoc(overrides: Record<string, unknown> = {}) {
    return {
      _id: solicitudReportId,
      type: 'viatico',
      status: 'pending_l1',
      userId: solicitudUserId,
      clientId: solicitudClientId,
      viaticoApproverChain: makeChain(),
      viaticoApprovalLevel: 0,
      viaticoRequiredLevels: 1,
      viaticoApprovalHistory: [],
      viaticoAmount: 100,
      viaticoMoneda: '01',
      viaticoRejectedByRole: undefined as 'centro_costo' | 'contabilidad' | undefined,
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    }
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    mockUserServiceLocal.findEmailNameClient.mockResolvedValue(null)
    mockUserServiceLocal.findViaticoAccountingNotifyRecipients.mockResolvedValue([])

    mockExpenseReportModel = {
      findById: jest.fn(),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseReportService,
        { provide: getModelToken(ExpenseReport.name), useValue: mockExpenseReportModel },
        { provide: getModelToken(Expense.name), useValue: {} },
        { provide: getModelToken(CajaChicaReport.name), useValue: { countDocuments: jest.fn() } },
        { provide: EmailService, useValue: {} },
        { provide: NotificationsService, useValue: mockNotificationsServiceLocal },
        { provide: UserService, useValue: mockUserServiceLocal },
        { provide: AdvanceService, useValue: mockAdvanceServiceLocal },
        { provide: UploadService, useValue: {} },
        { provide: ProjectService, useValue: {} },
        { provide: CategoryService, useValue: {} },
      ],
    }).compile()

    service = module.get<ExpenseReportService>(ExpenseReportService)
    jest.spyOn(service, 'findOne').mockResolvedValue(reportDoc() as never)
  })

  describe('approveViatico', () => {
    it('deja que N2(seleccionado) apruebe antes que N2(principal) — cualquier orden', async () => {
      const report = reportDoc({ viaticoApproverChain: makeTwoStepChain(), viaticoRequiredLevels: 2 })
      mockExpenseReportModel.findById.mockResolvedValue(report)

      await service.approveViatico(
        solicitudReportId,
        { approvedBy: n2Id.toString() },
        n2Id.toString(),
        ROLES.COLABORADOR
      )

      expect(report.viaticoApproverChain[1].approved).toBe(true)
      expect(report.viaticoApproverChain[0].approved).toBeFalsy()
      expect(report.status).toBe('pending_l1') // aún falta N2(principal)
    })

    it('rechaza a quien no es aprobador de ningún paso pendiente', async () => {
      const report = reportDoc({ viaticoApproverChain: makeTwoStepChain(), viaticoRequiredLevels: 2 })
      mockExpenseReportModel.findById.mockResolvedValue(report)
      const stranger = new Types.ObjectId().toString()

      await expect(
        service.approveViatico(solicitudReportId, { approvedBy: stranger }, stranger, ROLES.COLABORADOR)
      ).rejects.toThrow(ForbiddenException)
    })

    it('pasa a pending_contabilidad cuando ambos pasos ya aprobaron, sin importar el orden', async () => {
      const chain = makeTwoStepChain()
      chain[1].approved = true // N2(seleccionado) aprobó primero
      const report = reportDoc({ viaticoApproverChain: chain, viaticoRequiredLevels: 2, viaticoApprovalLevel: 1 })
      mockExpenseReportModel.findById.mockResolvedValue(report)

      await service.approveViatico(
        solicitudReportId,
        { approvedBy: n1Id.toString() },
        n1Id.toString(),
        ROLES.COLABORADOR
      )

      expect(report.viaticoApproverChain.every((s) => s.approved)).toBe(true)
      expect(report.status).toBe('pending_contabilidad')
    })
  })

  describe('rejectViatico', () => {
    it('deja que cualquier aprobador de un paso pendiente rechace la solicitud', async () => {
      const report = reportDoc({ viaticoApproverChain: makeTwoStepChain(), viaticoRequiredLevels: 2 })
      mockExpenseReportModel.findById.mockResolvedValue(report)

      await service.rejectViatico(
        solicitudReportId,
        { rejectedBy: n2Id.toString(), rejectionReason: 'Falta sustento suficiente' },
        n2Id.toString(),
        ROLES.COLABORADOR
      )

      expect(report.status).toBe('rejected')
      expect(report.viaticoRejectedByRole).toBe('centro_costo')
    })

    it('rechaza a quien no es aprobador de ningún paso pendiente', async () => {
      const report = reportDoc({ viaticoApproverChain: makeTwoStepChain(), viaticoRequiredLevels: 2 })
      mockExpenseReportModel.findById.mockResolvedValue(report)
      const stranger = new Types.ObjectId().toString()

      await expect(
        service.rejectViatico(
          solicitudReportId,
          { rejectedBy: stranger, rejectionReason: 'motivo cualquiera' },
          stranger,
          ROLES.COLABORADOR
        )
      ).rejects.toThrow(ForbiddenException)
    })
  })
})

describe('ExpenseReportService — addExpenseToReport (reconstrucción de cadena por comprobante)', () => {
  let service: ExpenseReportService
  let mockExpenseReportModel: Record<string, jest.Mock>
  let mockExpenseModel: Record<string, jest.Mock>
  let mockProjectServiceLocal: { findManyByIds: jest.Mock }
  let mockUserServiceLocal: { findTransactionalProfile: jest.Mock }

  const addReportId = new Types.ObjectId().toString()
  const addUserId = new Types.ObjectId().toString()
  const addClientId = new Types.ObjectId().toString()
  const existingExpenseId = new Types.ObjectId().toString()
  const newExpenseId = new Types.ObjectId().toString()
  const projectId = new Types.ObjectId().toString()

  function reportSelectResult(overrides: Record<string, unknown> = {}) {
    return {
      status: 'submitted',
      userId: addUserId,
      clientId: addClientId,
      expenseIds: [existingExpenseId],
      ...overrides,
    }
  }

  function mockFindByIdSelect(result: unknown) {
    mockExpenseReportModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(result),
        }),
      }),
    })
  }

  beforeEach(async () => {
    jest.clearAllMocks()

    mockExpenseReportModel = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    }
    mockExpenseModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
    }
    mockProjectServiceLocal = { findManyByIds: jest.fn().mockResolvedValue([]) }
    mockUserServiceLocal = { findTransactionalProfile: jest.fn().mockResolvedValue(null) }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseReportService,
        { provide: getModelToken(ExpenseReport.name), useValue: mockExpenseReportModel },
        { provide: getModelToken(Expense.name), useValue: mockExpenseModel },
        { provide: getModelToken(CajaChicaReport.name), useValue: { countDocuments: jest.fn() } },
        { provide: EmailService, useValue: {} },
        { provide: NotificationsService, useValue: { create: jest.fn().mockResolvedValue(undefined) } },
        { provide: UserService, useValue: mockUserServiceLocal },
        { provide: AdvanceService, useValue: {} },
        { provide: UploadService, useValue: {} },
        { provide: ProjectService, useValue: mockProjectServiceLocal },
        { provide: CategoryService, useValue: {} },
      ],
    }).compile()

    service = module.get<ExpenseReportService>(ExpenseReportService)
  })

  it('agregar un comprobante a una rendición YA ENVIADA solo construye la cadena del nuevo (no toca los existentes)', async () => {
    mockFindByIdSelect(reportSelectResult({ status: 'submitted' }))

    await service.addExpenseToReport(addReportId, newExpenseId)

    expect(mockExpenseModel.find).toHaveBeenCalledTimes(1)
    const findArg = mockExpenseModel.find.mock.calls[0][0]
    expect(findArg._id.$in.map((id: Types.ObjectId) => id.toString())).toEqual([newExpenseId])
  })

  it('agregar un comprobante a una rendición RECHAZADA reconstruye la cadena de TODOS y la reenvía', async () => {
    mockFindByIdSelect(reportSelectResult({ status: 'rejected' }))

    const result = await service.addExpenseToReport(addReportId, newExpenseId)

    expect(mockExpenseReportModel.findByIdAndUpdate).toHaveBeenCalledWith(
      addReportId,
      expect.objectContaining({
        $set: { status: 'submitted' },
        $unset: { rejectionReason: '', rejectedByRole: '' },
      }),
      { new: true }
    )
    expect(mockExpenseModel.find).toHaveBeenCalledTimes(1)
    const findArg = mockExpenseModel.find.mock.calls[0][0]
    expect(findArg._id.$in.map((id: Types.ObjectId) => id.toString()).sort()).toEqual(
      [existingExpenseId, newExpenseId].sort()
    )
    expect(result).toBeDefined()
  })

  it('agregar un comprobante a una rendición ABIERTA (aún no enviada) no construye ninguna cadena', async () => {
    mockFindByIdSelect(reportSelectResult({ status: 'open' }))

    await service.addExpenseToReport(addReportId, newExpenseId)

    expect(mockExpenseModel.find).not.toHaveBeenCalled()
  })

  const approverId = new Types.ObjectId().toString()

  function mockProjectWithOneLevel() {
    mockProjectServiceLocal.findManyByIds.mockResolvedValue([
      {
        _id: projectId,
        approverLevels: [{ level: 1, userIds: [new Types.ObjectId(approverId)] }],
      },
    ])
    mockUserServiceLocal.findTransactionalProfile.mockResolvedValue({
      projectIds: [projectId],
      primaryProjectId: projectId,
    })
  }

  function mockExpenseDoc(overrides: Record<string, unknown> = {}): {
    _id: Types.ObjectId
    proyectId: Types.ObjectId
    status: string
    approverChain: ChainStep[] | undefined
    requiredLevels?: number
    approvalLevel?: number
    save: jest.Mock
  } {
    return {
      _id: new Types.ObjectId(newExpenseId),
      proyectId: new Types.ObjectId(projectId),
      status: 'pending',
      approverChain: undefined,
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    }
  }

  it('buildChainForNewExpense construye la cadena N1/N2 de un comprobante recién creado (chain-at-upload)', async () => {
    mockProjectWithOneLevel()
    const expenseDoc = mockExpenseDoc()
    mockExpenseModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([expenseDoc]),
    })

    await service.buildChainForNewExpense(newExpenseId, addUserId, addClientId)

    expect(expenseDoc.save).toHaveBeenCalledTimes(1)
    expect(expenseDoc.approverChain).toHaveLength(1)
    expect(expenseDoc.approverChain?.[0].approved).toBeFalsy()
    expect(expenseDoc.requiredLevels).toBe(1)
  })

  it('buildChainForNewExpense no hace nada si falta ownerUserId o clientId', async () => {
    await service.buildChainForNewExpense(newExpenseId, '', addClientId)
    expect(mockExpenseModel.find).not.toHaveBeenCalled()
  })

  it('no reconstruye (ni pisa aprobaciones en curso de) un comprobante que YA tiene cadena — envío normal, safety net', async () => {
    mockProjectWithOneLevel()
    const existingChain: ChainStep[] = [
      {
        level: 1,
        projectId: new Types.ObjectId(projectId),
        projectRole: 'principal',
        approverIds: [new Types.ObjectId(approverId)],
        approved: true,
        approvedBy: new Types.ObjectId(approverId),
        approvedAt: new Date(),
      },
    ]
    const expenseDoc = mockExpenseDoc({ approverChain: existingChain })
    mockExpenseModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([expenseDoc]),
    })

    // Reenvío normal (rama wasSubmitted de addExpenseToReport): solo agrega un
    // comprobante nuevo, pero si el motor volviera a mirar uno ya chained no
    // debe pisarlo.
    await service.buildChainForNewExpense(newExpenseId, addUserId, addClientId)

    expect(expenseDoc.save).not.toHaveBeenCalled()
    expect(expenseDoc.approverChain).toBe(existingChain)
  })

  it('agregar un comprobante a una rendición RECHAZADA SÍ reconstruye (force) la cadena de comprobantes que ya tenían aprobaciones', async () => {
    mockProjectWithOneLevel()
    const staleApprovedChain: ChainStep[] = [
      {
        level: 1,
        projectId: new Types.ObjectId(projectId),
        projectRole: 'principal',
        approverIds: [new Types.ObjectId(approverId)],
        approved: true,
        approvedBy: new Types.ObjectId(approverId),
        approvedAt: new Date(),
      },
    ]
    const existingDoc = mockExpenseDoc({
      _id: new Types.ObjectId(existingExpenseId),
      approverChain: staleApprovedChain,
    })
    mockExpenseModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([existingDoc]),
    })
    mockFindByIdSelect(reportSelectResult({ status: 'rejected', expenseIds: [existingExpenseId] }))

    await service.addExpenseToReport(addReportId, newExpenseId)

    expect(existingDoc.save).toHaveBeenCalledTimes(1)
    expect(existingDoc.approverChain).not.toBe(staleApprovedChain)
    expect(existingDoc.approverChain?.[0].approved).toBeFalsy()
  })

  it('findAllByCoordinator lista cualquier reporte con un comprobante en la cadena del aprobador, sin exigir isDirecta (regla 1.9 — visible desde el upload, aunque siga `open`)', async () => {
    const coordId = new Types.ObjectId().toString()
    const reportWithChain = new Types.ObjectId()

    // expenseModel.find(...).distinct('expenseReportId').exec() → reportes con
    // un comprobante donde el coordinador es aprobador.
    mockExpenseModel.find.mockReturnValue({
      distinct: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([reportWithChain]),
      }),
    })

    const chainable: Record<string, jest.Mock> = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }
    mockExpenseReportModel.find = jest.fn().mockReturnValue(chainable)

    await service.findAllByCoordinator(coordId, addClientId)

    const query = mockExpenseReportModel.find.mock.calls[0][0] as { $or: Array<Record<string, any>> }
    // Ninguna cláusula debe restringir a isDirecta: el match por cadena es general.
    expect(query.$or.some(c => c['isDirecta'] === true)).toBe(false)
    const chainClause = query.$or.find(c => c['_id']?.$in)
    expect(chainClause).toBeDefined()
    expect(
      chainClause!['_id'].$in.map((x: Types.ObjectId) => x.toString())
    ).toContain(reportWithChain.toString())
  })
})
