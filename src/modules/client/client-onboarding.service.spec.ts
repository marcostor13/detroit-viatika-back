import { Test, TestingModule } from '@nestjs/testing'
import { NotFoundException } from '@nestjs/common'
import { ClientOnboardingService } from './client-onboarding.service'
import { ClientService } from './client.service'
import { UserService } from '../user/user.service'
import { EmailService } from '../email/email.service'
import { RoleService } from '../role/role.service'
import { ROLES } from '../auth/enums/roles.enum'

const adminRole = {
  _id: { toString: () => 'role-admin-id' },
  name: ROLES.ADMIN,
}
const createdClient = {
  _id: { toString: () => 'client-id-1' },
  comercialName: 'Test Co',
  email: 'test@co.com',
  toObject: jest
    .fn()
    .mockReturnValue({ _id: 'client-id-1', comercialName: 'Test Co' }),
}
const createdUser = {
  _id: 'user-id-1',
  email: 'admin@testco.com',
  name: 'Admin User',
  role: adminRole,
  isActive: true,
  temporaryPassword: 'Temp@1234',
}

const mockClientService = {
  create: jest.fn().mockResolvedValue(createdClient),
  remove: jest.fn().mockResolvedValue(undefined),
}
const mockUserService = {
  create: jest.fn().mockResolvedValue(createdUser),
}
const mockEmailService = {
  sendProviderWelcomeEmail: jest.fn().mockResolvedValue(undefined),
  buildAppUrl: jest.fn().mockReturnValue('http://localhost:4200/login'),
}
const mockRoleService = {
  getByName: jest.fn().mockResolvedValue(adminRole),
}

const payload = {
  client: { comercialName: 'Test Co', ruc: '20123456789' } as any,
  adminUser: { name: 'Admin User', email: 'admin@testco.com' },
}

describe('ClientOnboardingService', () => {
  let service: ClientOnboardingService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientOnboardingService,
        { provide: ClientService, useValue: mockClientService },
        { provide: UserService, useValue: mockUserService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: RoleService, useValue: mockRoleService },
      ],
    }).compile()
    service = module.get<ClientOnboardingService>(ClientOnboardingService)
  })

  it('is defined', () => {
    expect(service).toBeDefined()
  })

  describe('registerClientWithUser — happy path', () => {
    it('creates client and admin user, returns structured response', async () => {
      const result = await service.registerClientWithUser(payload)
      expect(mockClientService.create).toHaveBeenCalledWith(payload.client)
      expect(mockUserService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'admin@testco.com',
          roleId: 'role-admin-id',
          clientId: 'client-id-1',
          isActive: true,
          isCompanyAdmin: true,
        })
      )
      expect(result.message).toBe(
        'Cliente registrado correctamente con usuario'
      )
      expect(result.adminUser.email).toBe('admin@testco.com')
      expect(result.adminUser.temporaryPassword).toBe('Temp@1234')
    })

    it('sends welcome email with correct credentials', async () => {
      await service.registerClientWithUser(payload)
      expect(mockEmailService.sendProviderWelcomeEmail).toHaveBeenCalledWith(
        'admin@testco.com',
        expect.objectContaining({
          firstName: 'Admin',
          lastName: 'User',
          password: 'Temp@1234',
        })
      )
    })

    it('assigns all required module permissions to admin user', async () => {
      await service.registerClientWithUser(payload)
      const createCall = mockUserService.create.mock.calls[0][0]
      expect(createCall.permissions.canApproveL1).toBe(true)
      expect(createCall.permissions.canApproveL2).toBe(true)
      expect(createCall.permissions.modules).toContain('tesoreria')
    })
  })

  describe('registerClientWithUser — error paths', () => {
    it('throws NotFoundException when admin role does not exist', async () => {
      mockRoleService.getByName.mockResolvedValueOnce(null)
      await expect(service.registerClientWithUser(payload)).rejects.toThrow(
        NotFoundException
      )
    })

    it('rolls back client when user creation fails', async () => {
      mockUserService.create.mockRejectedValueOnce(
        new Error('Email already exists')
      )
      await expect(service.registerClientWithUser(payload)).rejects.toThrow(
        'Email already exists'
      )
      expect(mockClientService.remove).toHaveBeenCalledWith('client-id-1')
    })

    it('does not throw when welcome email fails', async () => {
      mockEmailService.sendProviderWelcomeEmail.mockRejectedValueOnce(
        new Error('SMTP error')
      )
      const result = await service.registerClientWithUser(payload)
      expect(result.message).toBe(
        'Cliente registrado correctamente con usuario'
      )
    })
  })

  describe('splitName (via welcome email call)', () => {
    it('splits single-word name into firstName with empty lastName', async () => {
      const payloadSingleName = {
        ...payload,
        adminUser: { name: 'Admin', email: 'admin@testco.com' },
      }
      await service.registerClientWithUser(payloadSingleName)
      expect(mockEmailService.sendProviderWelcomeEmail).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ firstName: 'Admin', lastName: '' })
      )
    })

    it('splits multi-word name: first word is firstName, rest is lastName', async () => {
      const payloadMultiName = {
        ...payload,
        adminUser: { name: 'Juan Carlos Pérez', email: 'admin@testco.com' },
      }
      await service.registerClientWithUser(payloadMultiName)
      expect(mockEmailService.sendProviderWelcomeEmail).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ firstName: 'Juan', lastName: 'Carlos Pérez' })
      )
    })
  })
})
