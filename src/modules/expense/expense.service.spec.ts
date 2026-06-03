import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { Types } from 'mongoose'
import { ConfigService } from '@nestjs/config'
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

describe('ExpenseService — email gating (isEmailEnabled)', () => {
  let service: ExpenseService

  const mockEmailServiceGating = {
    buildAppUrl: jest.fn().mockReturnValue('http://app'),
    sendInvoiceUploadedExpenseNotification: jest.fn().mockResolvedValue(undefined),
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
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('sk-test') } },
        { provide: getModelToken(Expense.name), useValue: { aggregate: jest.fn() } },
        { provide: getModelToken(Client.name), useValue: {} },
        { provide: EmailService, useValue: mockEmailServiceGating },
        { provide: ProjectService, useValue: {} },
        { provide: UserService, useValue: mockUserServiceGating },
        { provide: SunatConfigService, useValue: {} },
        { provide: HttpService, useValue: {} },
        { provide: UploadService, useValue: {} },
        { provide: ExpenseReportService, useValue: {} },
        { provide: NotificationsService, useValue: { create: jest.fn().mockResolvedValue(undefined) } },
        { provide: CategoryService, useValue: mockCategoryServiceGating },
      ],
    }).compile()

    service = module.get<ExpenseService>(ExpenseService)
  })

  const userId = new Types.ObjectId().toHexString()
  const clientId = new Types.ObjectId().toHexString()
  const body = { userId, clientId } as unknown as CreateExpenseDto
  const data = {} as any

  describe('notifyStakeholders — creator email gating', () => {
    it('does not send creator email when isEmailEnabled returns false', async () => {
      mockUserServiceGating.findOne.mockResolvedValue({ email: 'creator@test.com', name: 'Creator' })
      mockUserServiceGating.isEmailEnabled.mockResolvedValue(false)
      mockUserServiceGating.findAll.mockResolvedValue([])

      await (service as any).notifyStakeholders(body, data, 'Project')

      expect(mockEmailServiceGating.sendInvoiceUploadedExpenseNotification).not.toHaveBeenCalled()
    })

    it('sends creator email when isEmailEnabled returns true', async () => {
      mockUserServiceGating.findOne.mockResolvedValue({ email: 'creator@test.com', name: 'Creator' })
      mockUserServiceGating.isEmailEnabled.mockResolvedValue(true)
      mockUserServiceGating.findAll.mockResolvedValue([])

      await (service as any).notifyStakeholders(body, data, 'Project')

      expect(mockEmailServiceGating.sendInvoiceUploadedExpenseNotification).toHaveBeenCalledWith(
        'creator@test.com',
        expect.any(Object),
      )
    })
  })

  describe('notifyStakeholders — collaborator email gating', () => {
    it('skips collaborator email when isEmailEnabled returns false', async () => {
      const collabId = new Types.ObjectId()
      // findOne returns null so creator block skips email; isEmailEnabled still called for creator
      mockUserServiceGating.findOne.mockResolvedValue(null)
      mockUserServiceGating.findAll.mockResolvedValue([
        { _id: collabId, email: 'collab@test.com', name: 'Collab' },
      ])
      mockUserServiceGating.isEmailEnabled.mockResolvedValue(false)

      await (service as any).notifyStakeholders(body, data, 'Project')

      expect(mockEmailServiceGating.sendInvoiceUploadedExpenseNotification).not.toHaveBeenCalled()
    })

    it('sends collaborator email when isEmailEnabled returns true for collaborator', async () => {
      const collabId = new Types.ObjectId()
      mockUserServiceGating.findOne.mockResolvedValue(null) // no creator email
      mockUserServiceGating.findAll.mockResolvedValue([
        { _id: collabId, email: 'collab@test.com', name: 'Collab' },
      ])
      // first call = creator check (null email so no send), second call = collab check
      mockUserServiceGating.isEmailEnabled
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)

      await (service as any).notifyStakeholders(body, data, 'Project')

      expect(mockEmailServiceGating.sendInvoiceUploadedExpenseNotification).toHaveBeenCalledWith(
        'collab@test.com',
        expect.any(Object),
      )
    })
  })

  describe('sendApprovalEmails — collaborator email gating', () => {
    const createdBy = new Types.ObjectId().toHexString()
    const collab1Id = new Types.ObjectId()

    const expense = { data: null, createdBy, clientId }

    it('skips collaborator approval email when isEmailEnabled returns false', async () => {
      mockUserServiceGating.findOne.mockResolvedValue({ email: 'creator@test.com', name: 'Creator' })
      mockUserServiceGating.findAll.mockResolvedValue([
        { _id: collab1Id, email: 'collab@test.com', name: 'Collab' },
      ])
      mockUserServiceGating.isEmailEnabled.mockResolvedValue(false)

      await (service as any).sendApprovalEmails(expense, null, 'Admin', 'User')

      expect(mockEmailServiceGating.sendInvoiceApprovedToColaborador).not.toHaveBeenCalled()
    })

    it('sends collaborator approval email when isEmailEnabled returns true', async () => {
      mockUserServiceGating.findOne.mockResolvedValue({ email: 'creator@test.com', name: 'Creator' })
      mockUserServiceGating.findAll.mockResolvedValue([
        { _id: collab1Id, email: 'collab@test.com', name: 'Collab' },
      ])
      mockUserServiceGating.isEmailEnabled.mockResolvedValue(true)

      await (service as any).sendApprovalEmails(expense, null, 'Admin', 'User')

      expect(mockEmailServiceGating.sendInvoiceApprovedToColaborador).toHaveBeenCalledWith(
        'collab@test.com',
        expect.any(Object),
      )
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
        { provide: getModelToken(Expense.name), useValue: mockExpenseRepository },
        { provide: getModelToken(Client.name), useValue: {} },
        { provide: EmailService, useValue: noopDeps.emailService },
        { provide: ProjectService, useValue: noopDeps.projectService },
        { provide: UserService, useValue: noopDeps.userService },
        { provide: SunatConfigService, useValue: noopDeps.sunatConfigService },
        { provide: HttpService, useValue: noopDeps.httpService },
        { provide: UploadService, useValue: noopDeps.uploadService },
        { provide: ExpenseReportService, useValue: noopDeps.expenseReportService },
        { provide: NotificationsService, useValue: noopDeps.notificationsService },
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
      const out = (service as unknown as { evaluateDeadline: (d?: string | null) => unknown }).evaluateDeadline(null)
      expect(out).toEqual({ observado: false })
    })

    it('emisión reciente no observa', () => {
      const out = (service as unknown as { evaluateDeadline: (d: string) => unknown }).evaluateDeadline(
        '2026-05-14'
      )
      expect(out).toEqual({ observado: false })
    })

    it('emisión con varios días de antigüedad no observa', () => {
      const out = (service as unknown as { evaluateDeadline: (d: string) => unknown }).evaluateDeadline(
        '2026-05-10'
      )
      expect(out).toEqual({ observado: false })
    })

    it('emisión de mes anterior tampoco rechaza', () => {
      const out = (service as unknown as { evaluateDeadline: (d: string) => unknown }).evaluateDeadline(
        '2026-04-20'
      )
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
          evaluateCategoryLimit: (dto: CreateExpenseDto, n: number) => Promise<unknown>
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
            evaluateCategoryLimit: (dto: CreateExpenseDto, n: number) => Promise<unknown>
          }
        ).evaluateCategoryLimit(bodyBase(), 10)
      ).rejects.toThrow(/Límite de categoría/)
    })

    it('alerta al alcanzar al menos el 90%', async () => {
      mockCategoryService.findOne.mockResolvedValue({ limit: 100 })
      mockExpenseRepository.aggregate.mockResolvedValue([{ total: 85 }])
      const out = await (
        service as unknown as {
          evaluateCategoryLimit: (dto: CreateExpenseDto, n: number) => Promise<unknown>
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
          evaluateCategoryLimit: (dto: CreateExpenseDto, n: number) => Promise<unknown>
        }
      ).evaluateCategoryLimit(bodyBase(), 50)
      expect(out).toEqual({ percent: 60 })
      expect((out as { warning?: string }).warning).toBeUndefined()
    })
  })
})
