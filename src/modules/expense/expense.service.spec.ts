import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { Types } from 'mongoose'
import { ConfigService } from '@nestjs/config'
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { ExpenseService } from './expense.service'
import { Expense } from './entities/expense.entity'
import { EmailService } from '../email/email.service'
import { ProjectService } from '../project/project.service'
import { UserService } from '../user/user.service'
import { SunatConfigService } from '../sunat-config/sunat-config.service'
import { HttpService } from '@nestjs/axios'
import { UploadService } from '../upload/upload.service'
import { ExpenseReportService } from '../expense-report/expense-report.service'
import { NotificationsService } from '../notifications/notifications.service'
import { CategoryService } from '../category/category.service'
import { CreateExpenseDto } from './dto/create-expense.dto'
import { Client } from '../client/entities/client.entity'
import { ROLES } from '../auth/enums/roles.enum'
import { ChainStep } from '../advance/approval-chain.util'

describe('ExpenseService — email gating (isEmailEnabled)', () => {
  let service: ExpenseService

  const mockEmailServiceGating = {
    buildAppUrl: jest.fn().mockReturnValue('http://app'),
    sendInvoiceApprovedToColaborador: jest.fn().mockResolvedValue(undefined),
  }

  const mockUserServiceGating = {
    findOne: jest.fn(),
    findAll: jest.fn(),
    isEmailEnabled: jest.fn(),
  }

  const mockCategoryServiceGating = {
    findOne: jest.fn().mockResolvedValue(null),
  }

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('sk-test') },
        },
        {
          provide: getModelToken(Expense.name),
          useValue: { aggregate: jest.fn() },
        },
        { provide: getModelToken(Client.name), useValue: {} },
        { provide: EmailService, useValue: mockEmailServiceGating },
        { provide: ProjectService, useValue: {} },
        { provide: UserService, useValue: mockUserServiceGating },
        { provide: SunatConfigService, useValue: {} },
        { provide: HttpService, useValue: {} },
        { provide: UploadService, useValue: {} },
        { provide: ExpenseReportService, useValue: {} },
        {
          provide: NotificationsService,
          useValue: { create: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: CategoryService, useValue: mockCategoryServiceGating },
      ],
    }).compile()

    service = module.get<ExpenseService>(ExpenseService)
  })

  const clientId = new Types.ObjectId().toHexString()

  describe('sendApprovalEmails — collaborator email gating', () => {
    const createdBy = new Types.ObjectId().toHexString()
    const collab1Id = new Types.ObjectId()

    const expense = { data: null, createdBy, clientId }

    it('skips collaborator approval email when isEmailEnabled returns false', async () => {
      mockUserServiceGating.findOne.mockResolvedValue({
        email: 'creator@test.com',
        name: 'Creator',
      })
      mockUserServiceGating.findAll.mockResolvedValue([
        { _id: collab1Id, email: 'collab@test.com', name: 'Collab' },
      ])
      mockUserServiceGating.isEmailEnabled.mockResolvedValue(false)

      await (service as any).sendApprovalEmails(expense, null, 'Admin', 'User')

      expect(
        mockEmailServiceGating.sendInvoiceApprovedToColaborador
      ).not.toHaveBeenCalled()
    })

    it('sends collaborator approval email when isEmailEnabled returns true', async () => {
      mockUserServiceGating.findOne.mockResolvedValue({
        email: 'creator@test.com',
        name: 'Creator',
      })
      mockUserServiceGating.findAll.mockResolvedValue([
        { _id: collab1Id, email: 'collab@test.com', name: 'Collab' },
      ])
      mockUserServiceGating.isEmailEnabled.mockResolvedValue(true)

      await (service as any).sendApprovalEmails(expense, null, 'Admin', 'User')

      expect(
        mockEmailServiceGating.sendInvoiceApprovedToColaborador
      ).toHaveBeenCalledWith('collab@test.com', expect.any(Object))
    })
  })
})

describe('ExpenseService — Fase 5 (plazos y límites de categoría)', () => {
  let service: ExpenseService

  const mockExpenseRepository = {
    aggregate: jest.fn(),
  }

  const mockCategoryService = {
    findOne: jest.fn(),
  }

  const noopDeps = {
    emailService: {},
    projectService: {},
    userService: {},
    sunatConfigService: {},
    httpService: {},
    uploadService: {},
    expenseReportService: {},
    notificationsService: {},
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-05-15T15:00:00.000Z'))

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('sk-test-openai-key') },
        },
        {
          provide: getModelToken(Expense.name),
          useValue: mockExpenseRepository,
        },
        { provide: getModelToken(Client.name), useValue: {} },
        { provide: EmailService, useValue: noopDeps.emailService },
        { provide: ProjectService, useValue: noopDeps.projectService },
        { provide: UserService, useValue: noopDeps.userService },
        { provide: SunatConfigService, useValue: noopDeps.sunatConfigService },
        { provide: HttpService, useValue: noopDeps.httpService },
        { provide: UploadService, useValue: noopDeps.uploadService },
        {
          provide: ExpenseReportService,
          useValue: noopDeps.expenseReportService,
        },
        {
          provide: NotificationsService,
          useValue: noopDeps.notificationsService,
        },
        { provide: CategoryService, useValue: mockCategoryService },
      ],
    }).compile()

    service = module.get<ExpenseService>(ExpenseService)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('evaluateDeadline', () => {
    it('sin fecha no marca observación', () => {
      const out = (
        service as unknown as {
          evaluateDeadline: (d?: string | null) => unknown
        }
      ).evaluateDeadline(null)
      expect(out).toEqual({ observado: false })
    })

    it('emisión reciente no observa', () => {
      const out = (
        service as unknown as { evaluateDeadline: (d: string) => unknown }
      ).evaluateDeadline('2026-05-14')
      expect(out).toEqual({ observado: false })
    })

    it('emisión con varios días de antigüedad no observa', () => {
      const out = (
        service as unknown as { evaluateDeadline: (d: string) => unknown }
      ).evaluateDeadline('2026-05-10')
      expect(out).toEqual({ observado: false })
    })

    it('emisión de mes anterior tampoco rechaza', () => {
      const out = (
        service as unknown as { evaluateDeadline: (d: string) => unknown }
      ).evaluateDeadline('2026-04-20')
      expect(out).toEqual({ observado: false })
    })
  })

  describe('evaluateCategoryLimit', () => {
    const bodyBase = (): CreateExpenseDto =>
      ({
        expenseReportId: new Types.ObjectId().toString(),
        categoryId: new Types.ObjectId().toString(),
        clientId: new Types.ObjectId().toString(),
      }) as CreateExpenseDto

    it('sin datos de categoría no evalúa', async () => {
      const b = bodyBase()
      delete (b as { expenseReportId?: string }).expenseReportId
      const out = await (
        service as unknown as {
          evaluateCategoryLimit: (
            dto: CreateExpenseDto,
            n: number
          ) => Promise<unknown>
        }
      ).evaluateCategoryLimit(b, 100)
      expect(out).toEqual({})
      expect(mockCategoryService.findOne).not.toHaveBeenCalled()
    })

    it('bloquea al llegar o superar el 100% del límite', async () => {
      mockCategoryService.findOne.mockResolvedValue({ limit: 100 })
      mockExpenseRepository.aggregate.mockResolvedValue([{ total: 92 }])
      await expect(
        (
          service as unknown as {
            evaluateCategoryLimit: (
              dto: CreateExpenseDto,
              n: number
            ) => Promise<unknown>
          }
        ).evaluateCategoryLimit(bodyBase(), 10)
      ).rejects.toThrow(/Límite de categoría/)
    })

    it('alerta al alcanzar al menos el 90%', async () => {
      mockCategoryService.findOne.mockResolvedValue({ limit: 100 })
      mockExpenseRepository.aggregate.mockResolvedValue([{ total: 85 }])
      const out = await (
        service as unknown as {
          evaluateCategoryLimit: (
            dto: CreateExpenseDto,
            n: number
          ) => Promise<unknown>
        }
      ).evaluateCategoryLimit(bodyBase(), 10)
      expect(out).toMatchObject({
        warning: expect.stringContaining('90%'),
      })
    })

    it('por debajo del 90% devuelve solo porcentaje', async () => {
      mockCategoryService.findOne.mockResolvedValue({ limit: 100 })
      mockExpenseRepository.aggregate.mockResolvedValue([{ total: 10 }])
      const out = await (
        service as unknown as {
          evaluateCategoryLimit: (
            dto: CreateExpenseDto,
            n: number
          ) => Promise<unknown>
        }
      ).evaluateCategoryLimit(bodyBase(), 50)
      expect(out).toEqual({ percent: 60 })
      expect((out as { warning?: string }).warning).toBeUndefined()
    })
  })
})

describe('ExpenseService — aprobación por comprobante (regla 1.4, en paralelo entre niveles)', () => {
  let service: ExpenseService
  let mockExpenseModel: { findOne: jest.Mock; findByIdAndUpdate: jest.Mock }
  let mockNotificationsService: { create: jest.Mock }

  const clientId = new Types.ObjectId().toHexString()
  const expenseId = new Types.ObjectId().toHexString()
  const n1Id = new Types.ObjectId()
  const n2Id = new Types.ObjectId()
  const projectId = new Types.ObjectId()

  const actorN1 = { userId: n1Id.toString(), roleName: ROLES.COLABORADOR, clientId }
  const actorN2 = { userId: n2Id.toString(), roleName: ROLES.COLABORADOR, clientId }

  function makeChain(): ChainStep[] {
    return [
      { level: 1, projectId, projectRole: 'principal', approverIds: [n1Id] },
      { level: 2, projectId, projectRole: 'principal', approverIds: [n2Id] },
    ]
  }

  function baseExpense(overrides: Record<string, unknown> = {}) {
    return {
      _id: expenseId,
      clientId,
      createdBy: new Types.ObjectId().toHexString(),
      approverChain: makeChain(),
      approvalLevel: 0,
      requiredLevels: 2,
      approvalHistory: [],
      contabilidadStatus: 'pending',
      status: 'pending',
      ...overrides,
    }
  }

  function mockLoadExpense(expense: unknown) {
    const query = {
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(expense),
    }
    mockExpenseModel.findOne.mockReturnValue(query)
  }

  function mockUpdate(result: unknown) {
    mockExpenseModel.findByIdAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(result),
    })
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    mockNotificationsService = { create: jest.fn().mockResolvedValue(undefined) }
    mockExpenseModel = { findOne: jest.fn(), findByIdAndUpdate: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('sk-test') } },
        { provide: getModelToken(Expense.name), useValue: mockExpenseModel },
        { provide: getModelToken(Client.name), useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: ProjectService, useValue: {} },
        { provide: UserService, useValue: {} },
        { provide: SunatConfigService, useValue: {} },
        { provide: HttpService, useValue: {} },
        { provide: UploadService, useValue: {} },
        { provide: ExpenseReportService, useValue: {} },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: CategoryService, useValue: {} },
      ],
    }).compile()

    service = module.get<ExpenseService>(ExpenseService)
  })

  describe('approveByCoord', () => {
    it('deja que N2 apruebe antes que N1 (cualquier orden)', async () => {
      const expense = baseExpense()
      mockLoadExpense(expense)
      mockUpdate({ ...expense })

      await service.approveByCoord(expenseId, actorN2)

      const [, updatePayload] = mockExpenseModel.findByIdAndUpdate.mock.calls[0]
      expect(updatePayload.$set.approverChain[1].approved).toBe(true)
      expect(updatePayload.$set.approverChain[0].approved).toBeFalsy()
      expect(updatePayload.$set.status).toBe('pending')
    })

    it('rechaza a quien no es aprobador de ningún paso pendiente', async () => {
      const expense = baseExpense()
      mockLoadExpense(expense)
      const stranger = { userId: new Types.ObjectId().toString(), roleName: ROLES.COLABORADOR, clientId }

      await expect(service.approveByCoord(expenseId, stranger)).rejects.toThrow(ForbiddenException)
    })

    it('marca la cadena completa cuando N1 y N2 ya aprobaron, sin importar el orden', async () => {
      const chain = makeChain()
      chain[1].approved = true // N2 aprobó primero
      const expense = baseExpense({ approverChain: chain, approvalLevel: 1 })
      mockLoadExpense(expense)
      mockUpdate({ ...expense })

      await service.approveByCoord(expenseId, actorN1)

      const [, updatePayload] = mockExpenseModel.findByIdAndUpdate.mock.calls[0]
      expect(updatePayload.$set.approverChain.every((s: ChainStep) => s.approved)).toBe(true)
      // Cadena de Coordinador completa, pero Contabilidad sigue pendiente.
      expect(updatePayload.$set.status).toBe('pending')
    })

    it('rechaza aprobar cuando la rendición aún no fue enviada (approverChain vacío)', async () => {
      const expense = baseExpense({ approverChain: [] })
      mockLoadExpense(expense)

      await expect(service.approveByCoord(expenseId, actorN1)).rejects.toThrow(BadRequestException)
    })
  })

  describe('rejectByCoord', () => {
    it('deja que cualquier aprobador de un paso pendiente rechace, no solo "el turno actual"', async () => {
      const expense = baseExpense()
      mockLoadExpense(expense)
      mockUpdate({ ...expense, status: 'rejected' })

      await service.rejectByCoord(expenseId, actorN2, 'Falta sustento suficiente')

      expect(mockExpenseModel.findByIdAndUpdate).toHaveBeenCalled()
      const [, updatePayload] = mockExpenseModel.findByIdAndUpdate.mock.calls[0]
      expect(updatePayload.$set.status).toBe('rejected')
    })

    it('rechaza a quien no es aprobador de ningún paso pendiente', async () => {
      const expense = baseExpense()
      mockLoadExpense(expense)
      const stranger = { userId: new Types.ObjectId().toString(), roleName: ROLES.COLABORADOR, clientId }

      await expect(service.rejectByCoord(expenseId, stranger, 'motivo cualquiera')).rejects.toThrow(ForbiddenException)
    })
  })
})
