import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { DatabaseSeederService } from './database-seeder.service'
import { RoleService } from '../role/role.service'
import { UserService } from '../user/user.service'
import { User } from '../user/schemas/user.schema'
import { ROLES } from './enums/roles.enum'

const mockUserModel = {
  collection: {
    indexes: jest.fn().mockResolvedValue([]),
    dropIndex: jest.fn().mockResolvedValue(undefined),
  },
  create: jest.fn().mockResolvedValue({}),
  updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
}

const mockRoleService = {
  getByName: jest.fn(),
  create: jest.fn().mockResolvedValue({ _id: 'new-role-id', name: 'TestRole' }),
  update: jest.fn().mockResolvedValue({}),
}

const mockUserService = {
  findAllWithClient: jest.fn().mockResolvedValue([]),
}

describe('DatabaseSeederService', () => {
  let service: DatabaseSeederService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseSeederService,
        { provide: RoleService, useValue: mockRoleService },
        { provide: UserService, useValue: mockUserService },
        { provide: getModelToken(User.name), useValue: mockUserModel },
      ],
    }).compile()
    service = module.get<DatabaseSeederService>(DatabaseSeederService)
  })

  it('is defined', () => {
    expect(service).toBeDefined()
  })

  describe('onApplicationBootstrap', () => {
    it('runs without error when all roles already exist', async () => {
      mockRoleService.getByName.mockResolvedValue({
        _id: 'existing-id',
        name: 'Role',
      })
      mockUserService.findAllWithClient.mockResolvedValue([
        { role: { name: ROLES.SUPER_ADMIN } },
      ])
      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined()
    })
  })

  describe('seedRoles', () => {
    it('creates each role that does not yet exist', async () => {
      // All getByName return null -> create
      mockRoleService.getByName.mockResolvedValue(null)
      mockUserService.findAllWithClient.mockResolvedValue([
        { role: { name: ROLES.SUPER_ADMIN } },
      ])
      await service.onApplicationBootstrap()
      expect(mockRoleService.create).toHaveBeenCalled()
    })

    it('skips creation when role already exists', async () => {
      mockRoleService.getByName.mockResolvedValue({
        _id: 'role-id',
        name: 'ExistingRole',
      })
      mockUserService.findAllWithClient.mockResolvedValue([
        { role: { name: ROLES.SUPER_ADMIN } },
      ])
      await service.onApplicationBootstrap()
      expect(mockRoleService.create).not.toHaveBeenCalled()
    })

    it('renames old role instead of creating new one when old name exists', async () => {
      // Superadministrador not found, but Super is found -> rename
      mockRoleService.getByName.mockImplementation(async (name: string) => {
        if (name === ROLES.SUPER_ADMIN) return null
        if (name === 'Super') return { _id: 'old-id', name: 'Super' }
        return { _id: 'some-id', name }
      })
      mockUserService.findAllWithClient.mockResolvedValue([
        { role: { name: ROLES.SUPER_ADMIN } },
      ])
      await service.onApplicationBootstrap()
      expect(mockRoleService.update).toHaveBeenCalledWith('old-id', {
        name: ROLES.SUPER_ADMIN,
      })
    })
  })

  describe('seedSuperAdmin', () => {
    it('creates superadmin when none exists', async () => {
      mockRoleService.getByName.mockImplementation(async (name: string) => {
        if (name === ROLES.SUPER_ADMIN)
          return { _id: 'super-role-id', name: ROLES.SUPER_ADMIN }
        return { _id: 'role-id', name }
      })
      mockUserService.findAllWithClient.mockResolvedValue([])
      await service.onApplicationBootstrap()
      expect(mockUserModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'admin@viatika.com' })
      )
    })

    it('skips superadmin creation when one already exists', async () => {
      mockRoleService.getByName.mockResolvedValue({
        _id: 'role-id',
        name: 'Role',
      })
      mockUserService.findAllWithClient.mockResolvedValue([
        { role: { name: ROLES.SUPER_ADMIN } },
      ])
      await service.onApplicationBootstrap()
      expect(mockUserModel.create).not.toHaveBeenCalled()
    })

    it('skips superadmin creation when superadmin role not found', async () => {
      mockRoleService.getByName.mockImplementation(async (name: string) => {
        if (name === ROLES.SUPER_ADMIN) return null
        return { _id: 'role-id', name }
      })
      mockUserService.findAllWithClient.mockResolvedValue([])
      await service.onApplicationBootstrap()
      expect(mockUserModel.create).not.toHaveBeenCalled()
    })

    it('drops legacy email_1 index if it exists', async () => {
      mockUserModel.collection.indexes.mockResolvedValueOnce([
        { name: 'email_1' },
      ])
      mockRoleService.getByName.mockResolvedValue({ _id: 'r', name: 'Role' })
      mockUserService.findAllWithClient.mockResolvedValue([
        { role: { name: ROLES.SUPER_ADMIN } },
      ])
      await service.onApplicationBootstrap()
      expect(mockUserModel.collection.dropIndex).toHaveBeenCalledWith('email_1')
    })
  })
})
