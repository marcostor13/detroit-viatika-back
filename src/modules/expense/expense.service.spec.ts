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

  describe('determineCodComp (VD-70: tipo de comprobante → codComp SUNAT)', () => {
    const codComp = (tipo?: string): string => (service as any).determineCodComp(tipo)

    it('Factura → 01, Boleta → 03', () => {
      expect(codComp('Factura')).toBe('01')
      expect(codComp('Boleta')).toBe('03')
    })

    it('es case-insensitive y tolera variantes como "Boleta Electrónica"', () => {
      expect(codComp('BOLETA')).toBe('03')
      expect(codComp('boleta electrónica')).toBe('03')
      expect(codComp('  factura  ')).toBe('01')
    })

    it('cae a Factura (01) cuando el tipo es desconocido o vacío', () => {
      expect(codComp(undefined)).toBe('01')
      expect(codComp('')).toBe('01')
      expect(codComp('Ticket')).toBe('01')
    })

    it('mapea nota de crédito (07) y débito (08) — catálogo listo aunque el form no las exponga aún', () => {
      expect(codComp('Nota de Crédito')).toBe('07')
      expect(codComp('NOTA DE CREDITO ELECTRONICA')).toBe('07')
      expect(codComp('Nota de Débito')).toBe('08')
      expect(codComp('nota de debito')).toBe('08')
    })
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

describe('ExpenseService — assertCanMutateExpense (VD-69: N1/N2 no editan ni eliminan)', () => {
  let service: ExpenseService
  let mockExpenseModel: {
    findOne: jest.Mock
    findByIdAndUpdate: jest.Mock
    findOneAndDelete: jest.Mock
  }

  const clientId = new Types.ObjectId().toHexString()
  const expenseId = new Types.ObjectId().toHexString()
  const ownerId = new Types.ObjectId().toHexString()
  const approverId = new Types.ObjectId().toHexString()

  /** Comprobante sin rendición asociada: aísla la validación de propiedad. */
  function loneExpense(overrides: Record<string, unknown> = {}) {
    const expense = {
      _id: expenseId,
      clientId,
      createdBy: ownerId,
      status: 'pending',
      ...overrides,
    }
    mockExpenseModel.findOne.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(expense),
    })
    return expense
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    mockExpenseModel = {
      findOne: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findOneAndDelete: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    }

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
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        { provide: CategoryService, useValue: {} },
      ],
    }).compile()

    service = module.get<ExpenseService>(ExpenseService)
  })

  it('un Coordinador (perfil del aprobador N1/N2) NO puede eliminar un comprobante ajeno', async () => {
    loneExpense()
    const approver = { userId: approverId, roleName: ROLES.COORDINADOR, clientId }

    await expect(service.remove(expenseId, approver)).rejects.toThrow(ForbiddenException)
    expect(mockExpenseModel.findOneAndDelete).not.toHaveBeenCalled()
  })

  it('un Coordinador NO puede editar un comprobante ajeno', async () => {
    loneExpense()
    const approver = { userId: approverId, roleName: ROLES.COORDINADOR, clientId }

    await expect(
      service.update(expenseId, {} as never, approver)
    ).rejects.toThrow(ForbiddenException)
  })

  it('el creador sí puede eliminar su propio comprobante', async () => {
    loneExpense()
    const owner = { userId: ownerId, roleName: ROLES.COORDINADOR, clientId }

    await service.remove(expenseId, owner)
    expect(mockExpenseModel.findOneAndDelete).toHaveBeenCalled()
  })

  it('Contabilidad ya NO puede eliminar un comprobante ajeno (VD-69)', async () => {
    loneExpense()
    const conta = { userId: approverId, roleName: ROLES.CONTABILIDAD, clientId }

    await expect(service.remove(expenseId, conta)).rejects.toThrow(
      ForbiddenException
    )
    expect(mockExpenseModel.findOneAndDelete).not.toHaveBeenCalled()
  })

  it('Contabilidad ya NO puede editar un comprobante ajeno (VD-69)', async () => {
    loneExpense()
    const conta = { userId: approverId, roleName: ROLES.CONTABILIDAD, clientId }

    await expect(
      service.update(expenseId, {} as never, conta)
    ).rejects.toThrow(ForbiddenException)
  })

  it('un rol de sistema (Admin) conserva la escotilla sobre comprobantes ajenos', async () => {
    loneExpense()
    const admin = { userId: approverId, roleName: ROLES.ADMIN, clientId }

    await service.remove(expenseId, admin)
    expect(mockExpenseModel.findOneAndDelete).toHaveBeenCalled()
  })
})

describe('ExpenseService — resolveMovilidadCategoryId (VD-89: planilla en directa)', () => {
  let service: ExpenseService
  const clientId = new Types.ObjectId().toHexString()
  const userId = new Types.ObjectId().toHexString()

  const movA = { _id: new Types.ObjectId(), name: 'Planilla de movilidad' }
  const movB = { _id: new Types.ObjectId(), name: 'Planilla de movilidad COM' }
  const otra = { _id: new Types.ObjectId(), name: 'Capacitación' }

  const categoryService = { findAllFlat: jest.fn() }
  const userService = { findOne: jest.fn() }

  async function build(): Promise<ExpenseService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('sk-test') },
        },
        { provide: getModelToken(Expense.name), useValue: {} },
        { provide: getModelToken(Client.name), useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: ProjectService, useValue: {} },
        { provide: UserService, useValue: userService },
        { provide: SunatConfigService, useValue: {} },
        { provide: HttpService, useValue: {} },
        { provide: UploadService, useValue: {} },
        { provide: ExpenseReportService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: CategoryService, useValue: categoryService },
      ],
    }).compile()
    return module.get<ExpenseService>(ExpenseService)
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    service = await build()
  })

  const resolve = (uid?: string) =>
    (service as any).resolveMovilidadCategoryId(uid, clientId) as Promise<string>

  it('devuelve la única categoría de movilidad asignada al colaborador', async () => {
    categoryService.findAllFlat.mockResolvedValue([movA, movB, otra])
    userService.findOne.mockResolvedValue({
      permissions: { categoryIds: [String(movB._id)] },
    })
    await expect(resolve(userId)).resolves.toBe(String(movB._id))
  })

  it('cae a la única del cliente cuando el colaborador no tiene categorías asignadas', async () => {
    categoryService.findAllFlat.mockResolvedValue([movA, otra])
    userService.findOne.mockResolvedValue({ permissions: { categoryIds: [] } })
    await expect(resolve(userId)).resolves.toBe(String(movA._id))
  })

  it('devuelve vacío si hay varias de movilidad y el colaborador no las restringe (ambiguo)', async () => {
    categoryService.findAllFlat.mockResolvedValue([movA, movB, otra])
    userService.findOne.mockResolvedValue({ permissions: { categoryIds: [] } })
    await expect(resolve(userId)).resolves.toBe('')
  })

  it('devuelve vacío si el cliente no tiene categorías de movilidad', async () => {
    categoryService.findAllFlat.mockResolvedValue([otra])
    userService.findOne.mockResolvedValue({ permissions: { categoryIds: [] } })
    await expect(resolve(userId)).resolves.toBe('')
  })
})

describe('ExpenseService — createDeclaracionJurada (DJE: un gasto por rubro)', () => {
  let service: ExpenseService
  const clientId = new Types.ObjectId().toHexString()
  const userId = new Types.ObjectId().toHexString()
  const proyectId = new Types.ObjectId().toHexString()
  const catAlimentacion = new Types.ObjectId().toHexString()
  const catMovilidad = new Types.ObjectId().toHexString()

  const expenseModel = {
    create: jest.fn(),
  }
  const userService = {
    findTransactionalProfile: jest.fn(),
    findEmailNameClient: jest.fn(),
  }
  const expenseReportService = {
    assertReportNotLockedByCajaChica: jest.fn(),
    buildChainForNewExpense: jest.fn(),
    addExpenseToReport: jest.fn(),
  }
  const categoryService = { findOne: jest.fn() }

  async function build(): Promise<ExpenseService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('sk-test') },
        },
        { provide: getModelToken(Expense.name), useValue: expenseModel },
        { provide: getModelToken(Client.name), useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: ProjectService, useValue: {} },
        { provide: UserService, useValue: userService },
        { provide: SunatConfigService, useValue: {} },
        { provide: HttpService, useValue: {} },
        { provide: UploadService, useValue: {} },
        { provide: ExpenseReportService, useValue: expenseReportService },
        { provide: NotificationsService, useValue: {} },
        { provide: CategoryService, useValue: categoryService },
      ],
    }).compile()
    return module.get<ExpenseService>(ExpenseService)
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    service = await build()
    userService.findTransactionalProfile.mockResolvedValue({
      signature: 'data:image/png;base64,firma',
    })
    userService.findEmailNameClient.mockResolvedValue({
      name: 'John Doe',
      email: 'john@acme.com',
      clientId,
    })
    expenseModel.create.mockImplementation((doc: any) =>
      Promise.resolve({ ...doc, _id: new Types.ObjectId() })
    )
  })

  const baseBody = () => ({
    clientId,
    userId,
    proyectId,
    moneda: 'US$',
    destino: 'Quito',
    pais: 'Ecuador',
    lugarFirma: 'Lima',
    alimentacion: {
      categoryId: catAlimentacion,
      rows: [
        { fecha: '2026-07-10', monto: 40 },
        { fecha: '2026-07-11', monto: 35.5 },
      ],
    },
    movilidad: {
      categoryId: catMovilidad,
      rows: [{ fecha: '2026-07-11', monto: 20 }],
    },
  })

  it('crea un gasto por rubro con el total del rubro y el mismo groupId', async () => {
    const res = await service.createDeclaracionJurada(baseBody() as any)

    expect(res.expenses).toHaveLength(2)
    expect(expenseModel.create).toHaveBeenCalledTimes(2)
    const [alimentacion, movilidad] = expenseModel.create.mock.calls.map(c => c[0])
    expect(alimentacion.total).toBeCloseTo(75.5)
    expect(movilidad.total).toBeCloseTo(20)
    expect(String(alimentacion.categoryId)).toBe(catAlimentacion)
    expect(String(movilidad.categoryId)).toBe(catMovilidad)
    expect(alimentacion.declaracionJuradaGroupId).toBe(res.groupId)
    expect(movilidad.declaracionJuradaGroupId).toBe(res.groupId)
    expect(alimentacion.subTipo).toBe('DJE')
    expect(alimentacion.declaracionJurada).toBe(true)
    expect(alimentacion.declaracionJuradaFirmante).toBe('John Doe')
    expect(alimentacion.declaracionJuradaMoneda).toBe('US$')
    expect(alimentacion.declaracionJuradaDestino).toBe('Quito')
    expect(alimentacion.declaracionJuradaRows).toHaveLength(2)
  })

  it('fecha del gasto = primer día declarado del rubro', async () => {
    const body = baseBody()
    body.alimentacion.rows = [
      { fecha: '2026-07-15', monto: 10 },
      { fecha: '2026-07-09', monto: 10 },
    ]
    await service.createDeclaracionJurada(body as any)
    const alimentacion = expenseModel.create.mock.calls[0][0]
    expect(alimentacion.fechaEmision).toBe('09/07/2026')
  })

  it('omite el rubro sin filas', async () => {
    const body: any = baseBody()
    delete body.movilidad
    const res = await service.createDeclaracionJurada(body)
    expect(res.expenses).toHaveLength(1)
    expect(expenseModel.create).toHaveBeenCalledTimes(1)
  })

  it('rechaza la declaración sin ningún rubro con filas', async () => {
    const body: any = baseBody()
    delete body.alimentacion
    delete body.movilidad
    await expect(service.createDeclaracionJurada(body)).rejects.toThrow(
      'Debes ingresar al menos un gasto de Alimentación o Movilidad'
    )
    expect(expenseModel.create).not.toHaveBeenCalled()
  })

  it('rechaza filas con monto 0 o sin fecha (no hay ValidationPipe global)', async () => {
    const sinMonto: any = baseBody()
    sinMonto.alimentacion.rows = [{ fecha: '2026-07-10', monto: 0 }]
    await expect(service.createDeclaracionJurada(sinMonto)).rejects.toThrow(
      /monto mayor a 0/
    )

    const sinFecha: any = baseBody()
    sinFecha.alimentacion.rows = [{ fecha: '  ', monto: 20 }]
    await expect(service.createDeclaracionJurada(sinFecha)).rejects.toThrow(
      /requiere una fecha/
    )

    expect(expenseModel.create).not.toHaveBeenCalled()
  })

  it('rechaza un rubro con filas pero sin categoría válida', async () => {
    const body: any = baseBody()
    body.movilidad.categoryId = ''
    await expect(service.createDeclaracionJurada(body)).rejects.toThrow(
      /Falta la categoría de Movilidad/
    )
    expect(expenseModel.create).not.toHaveBeenCalled()
  })

  it('exige firma digital registrada', async () => {
    userService.findTransactionalProfile.mockResolvedValue({ signature: '' })
    await expect(
      service.createDeclaracionJurada(baseBody() as any)
    ).rejects.toThrow(/firma digital/i)
    expect(expenseModel.create).not.toHaveBeenCalled()
  })

  it('arma la cadena de aprobación y suma el gasto a la rendición', async () => {
    const expenseReportId = new Types.ObjectId().toHexString()
    await service.createDeclaracionJurada({
      ...baseBody(),
      expenseReportId,
    } as any)
    expect(expenseReportService.buildChainForNewExpense).toHaveBeenCalledTimes(2)
    expect(expenseReportService.addExpenseToReport).toHaveBeenCalledTimes(2)
    expect(expenseReportService.addExpenseToReport).toHaveBeenCalledWith(
      expenseReportId,
      expect.any(String)
    )
  })

  it('el sub-tipo DJE ya no pasa por createOtherExpense', async () => {
    await expect(
      service.createOtherExpense({
        clientId,
        userId,
        proyectId,
        categoryId: catAlimentacion,
        total: 100,
        subTipo: 'DJE',
        declaracionJurada: true,
        imageUrl: 'https://s3/doc.pdf',
      } as CreateExpenseDto)
    ).rejects.toThrow(/declaracion-jurada/)
  })
})
