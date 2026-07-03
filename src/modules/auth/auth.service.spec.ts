import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { AuthService } from './auth.service'
import { UserService } from '../user/user.service'
import { ClientService } from '../client/client.service'

jest.mock('bcryptjs')

const mockUserService = {
  findByEmail: jest.fn(),
  findAllByEmail: jest.fn(),
  create: jest.fn(),
  findOne: jest.fn(),
}

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock.jwt.token'),
  verify: jest.fn(),
}

const mockClientService = {
  findAll: jest.fn().mockResolvedValue([]),
}

const mockUser = {
  _id: { toString: () => 'user123' },
  email: 'test@example.com',
  name: 'Test User',
  password: 'hashed_password',
  role: { name: 'Colaborador' },
  client: { _id: { toString: () => 'client123' } },
  permissions: { modules: [], canApproveL1: false, canApproveL2: false },
  isActive: true,
  mustChangePassword: false,
}

describe('AuthService', () => {
  let service: AuthService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: mockUserService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ClientService, useValue: mockClientService },
      ],
    }).compile()
    service = module.get<AuthService>(AuthService)
  })

  describe('register', () => {
    const dto = {
      email: 'new@example.com',
      password: 'pass123',
      name: 'New User',
      roleId: 'roleId',
      clientId: 'clientId',
    }

    it('creates user and returns success message', async () => {
      mockUserService.create.mockResolvedValue(mockUser)
      const result = await service.register(dto as any)
      expect(mockUserService.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: dto.email })
      )
      expect(result).toEqual({ message: 'Usuario creado correctamente' })
    })

    it('passes null clientId when clientId is empty string', async () => {
      mockUserService.create.mockResolvedValue(mockUser)
      await service.register({ ...dto, clientId: '' } as any)
      expect(mockUserService.create).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: null })
      )
    })
  })

  describe('validateUser', () => {
    it('returns user without password when credentials are valid', async () => {
      mockUserService.findByEmail.mockResolvedValue(mockUser)
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(true)
      const result = await service.validateUser('test@example.com', 'pass123')
      expect(result).not.toHaveProperty('password')
      expect(result).toHaveProperty('email', 'test@example.com')
    })

    it('returns null when user is not found', async () => {
      mockUserService.findByEmail.mockResolvedValue(null)
      const result = await service.validateUser('unknown@example.com', 'pass')
      expect(result).toBeNull()
    })

    it('returns null when password does not match', async () => {
      mockUserService.findByEmail.mockResolvedValue(mockUser)
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(false)
      const result = await service.validateUser('test@example.com', 'wrong')
      expect(result).toBeNull()
    })
  })

  describe('login', () => {
    it('returns access_token and user data on valid credentials', async () => {
      mockUserService.findAllByEmail.mockResolvedValue([mockUser])
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(true)
      const result = await service.login('test@example.com', 'pass123')
      expect(result).toHaveProperty('access_token', 'mock.jwt.token')
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          email: mockUser.email,
          roles: ['Colaborador'],
        })
      )
    })

    it('throws BadRequestException when user not found', async () => {
      mockUserService.findAllByEmail.mockResolvedValue([])
      await expect(service.login('wrong@example.com', 'bad')).rejects.toThrow(
        BadRequestException
      )
    })

    it('throws BadRequestException when password is wrong', async () => {
      mockUserService.findAllByEmail.mockResolvedValue([mockUser])
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(false)
      await expect(service.login('test@example.com', 'wrong')).rejects.toThrow(
        BadRequestException
      )
    })

    it('includes clientId and permissions in JWT payload', async () => {
      mockUserService.findAllByEmail.mockResolvedValue([mockUser])
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(true)
      await service.login('test@example.com', 'pass123')
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client123',
          permissions: mockUser.permissions,
        })
      )
    })
  })

  describe('selectClient', () => {
    it('throws BadRequestException when hubToken is invalid', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('invalid')
      })
      await expect(
        service.selectClient({ hubToken: 'bad.token', clientId: 'c1' })
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when email/password not provided without hubToken', async () => {
      await expect(service.selectClient({ clientId: 'c1' })).rejects.toThrow(
        BadRequestException
      )
    })

    it('issues token for email+password+clientId flow', async () => {
      const user = { ...mockUser, client: { _id: { toString: () => 'c1' } } }
      mockUserService.findAllByEmail.mockResolvedValue([user])
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(true)
      const result = await service.selectClient({
        email: 'test@example.com',
        password: 'pass',
        clientId: 'c1',
      })
      expect(result).toHaveProperty('access_token')
    })
  })

  describe('getHubCompanies', () => {
    it('returns mapped list of companies', async () => {
      mockClientService.findAll.mockResolvedValue([
        {
          _id: { toString: () => 'c1' },
          comercialName: 'Empresa A',
          logo: null,
        },
      ])
      const result = await service.getHubCompanies()
      expect(result).toEqual([
        { clientId: 'c1', name: 'Empresa A', logo: null },
      ])
    })
  })
})
