import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { BadRequestException } from '@nestjs/common'
import { Types } from 'mongoose'
import * as bcrypt from 'bcryptjs'
import { UserService } from './user.service'
import { User } from './schemas/user.schema'
import { RoleService } from '../role/role.service'

jest.mock('bcryptjs')

const userId = new Types.ObjectId().toString()
const clientId = new Types.ObjectId().toString()
const roleId = new Types.ObjectId().toString()

const mockRoleAdmin = { _id: new Types.ObjectId(), name: 'Administrador' }
const mockRoleSuper = { _id: new Types.ObjectId(), name: 'Superadministrador' }

const mockUserDoc = {
  _id: new Types.ObjectId(userId),
  email: 'user@example.com',
  name: 'Test User',
  password: 'hashed',
  roleId: mockRoleAdmin,
  clientId: new Types.ObjectId(clientId),
  isActive: true,
  permissions: { modules: [], canApproveL1: false, canApproveL2: false },
}

const makeChain = (resolvedValue: any) => ({
  populate: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(resolvedValue),
  then: (res: any, rej: any) => Promise.resolve(resolvedValue).then(res, rej),
  catch: (rej: any) => Promise.resolve(resolvedValue).catch(rej),
})

const mockUserModel = {
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
}

const mockRoleService = {
  getAdminRoles: jest.fn(),
}

describe('UserService', () => {
  let service: UserService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: RoleService, useValue: mockRoleService },
      ],
    }).compile()
    service = module.get<UserService>(UserService)
  })

  describe('findAllWithClient', () => {
    it('returns mapped users with role and client', async () => {
      mockUserModel.find.mockReturnValue(makeChain([mockUserDoc]))
      const result = await service.findAllWithClient()
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        email: 'user@example.com',
        isActive: true,
      })
    })
  })

  describe('findByEmail', () => {
    it('returns user when found', async () => {
      mockUserModel.findOne.mockReturnValue(makeChain(mockUserDoc))
      const result = await service.findByEmail('user@example.com')
      expect(result).not.toBeNull()
      expect(result!.email).toBe('user@example.com')
      expect(result!.password).toBe('hashed')
    })

    it('returns null when not found', async () => {
      mockUserModel.findOne.mockReturnValue(makeChain(null))
      const result = await service.findByEmail('missing@example.com')
      expect(result).toBeNull()
    })
  })

  describe('findOne', () => {
    it('returns user by ID', async () => {
      mockUserModel.findById.mockReturnValue(makeChain(mockUserDoc))
      const result = await service.findOne(userId)
      expect(result).toMatchObject({ email: 'user@example.com' })
    })

    it('returns empty object when user not found', async () => {
      mockUserModel.findById.mockReturnValue(makeChain(null))
      const result = await service.findOne(userId)
      expect(result).toEqual({})
    })
  })

  describe('create', () => {
    const dto = {
      email: 'new@example.com',
      password: 'plain123',
      name: 'New User',
      roleId,
      clientId,
    }

    it('auto-genera contraseña temporal y crea usuario', async () => {
      ;(bcrypt.hash as jest.Mock).mockResolvedValue('hashed_pw')
      mockUserModel.findOne.mockReturnValue(makeChain(null))
      mockUserModel.create.mockResolvedValue({ _id: new Types.ObjectId() })
      mockUserModel.findById.mockReturnValue(makeChain(mockUserDoc))
      const result = await service.create(dto)
      // La contraseña que se hashea es la temporal generada automáticamente, no la del DTO
      expect(bcrypt.hash).toHaveBeenCalledWith(expect.any(String), 10)
      expect(mockUserModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          password: 'hashed_pw',
          mustChangePassword: true,
        })
      )
      expect(result).toMatchObject({ email: 'user@example.com' })
      expect((result as any).temporaryPassword).toBeDefined()
    })

    it('throws BadRequestException when email already registered', async () => {
      mockUserModel.findOne.mockReturnValue(makeChain(mockUserDoc))
      await expect(service.create(dto)).rejects.toThrow(BadRequestException)
      await expect(service.create(dto)).rejects.toThrow(
        'El correo ya se encuentra registrado'
      )
    })
  })

  describe('findAll', () => {
    it('returns list of users for a clientId', async () => {
      mockUserModel.find.mockReturnValue(makeChain([mockUserDoc]))
      const result = await service.findAll(new Types.ObjectId(clientId))
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ email: 'user@example.com' })
    })
  })

  describe('update', () => {
    it('updates user and returns updated document', async () => {
      const updated = { ...mockUserDoc, name: 'Updated' }
      mockUserModel.findByIdAndUpdate.mockReturnValue(makeChain(updated))
      const result = await service.update(userId, { name: 'Updated' })
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ name: 'Updated' }),
        { new: true }
      )
      expect(result).toEqual(updated)
    })

    it('converts roleId to ObjectId when provided', async () => {
      mockUserModel.findByIdAndUpdate.mockReturnValue(makeChain(mockUserDoc))
      await service.update(userId, { roleId } as any)
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ roleId: expect.any(Types.ObjectId) }),
        { new: true }
      )
    })
  })

  describe('delete', () => {
    it('calls findByIdAndDelete with the user ID', async () => {
      mockUserModel.findByIdAndDelete.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUserDoc),
      })
      await service.delete(userId)
      expect(mockUserModel.findByIdAndDelete).toHaveBeenCalledWith(userId)
    })
  })

  describe('findAdminsByClient', () => {
    it('returns admin users for a client', async () => {
      mockRoleService.getAdminRoles.mockResolvedValue([
        mockRoleAdmin,
        mockRoleSuper,
      ])
      mockUserModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([mockUserDoc]),
      })
      const result = await service.findAdminsByClient(clientId)
      expect(result).toHaveLength(1)
    })
  })
})
