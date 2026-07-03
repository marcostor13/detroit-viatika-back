import { Test, TestingModule } from '@nestjs/testing'
import { CategoryGroupController } from './category-group.controller'
import { CategoryGroupService } from './category-group.service'
import { AuditLogService } from '../audit-log/audit-log.service'

const mockCategoryGroupService = {
  create: jest.fn().mockResolvedValue({ _id: 'g1', name: 'Test Group' }),
  findAll: jest.fn().mockResolvedValue([{ _id: 'g1', name: 'Test Group' }]),
  update: jest.fn().mockResolvedValue({ _id: 'g1', name: 'Updated Group' }),
  remove: jest.fn().mockResolvedValue(undefined),
}

const mockAuditLogService = {
  log: jest.fn(),
}

const mockReq = {
  user: { _id: 'u1', email: 'admin@test.com', clientId: 'c1' },
}

describe('CategoryGroupController', () => {
  let controller: CategoryGroupController

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoryGroupController],
      providers: [
        { provide: CategoryGroupService, useValue: mockCategoryGroupService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    })
      .overrideGuard(require('../auth/guards/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../auth/guards/roles.guard').RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('@nestjs/passport').AuthGuard('jwt'))
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get<CategoryGroupController>(CategoryGroupController)
  })

  it('is defined', () => {
    expect(controller).toBeDefined()
  })

  describe('findAll', () => {
    it('delegates to service.findAll with clientId', async () => {
      const result = await controller.findAll('c1')
      expect(mockCategoryGroupService.findAll).toHaveBeenCalledWith('c1')
      expect(result).toEqual([{ _id: 'g1', name: 'Test Group' }])
    })
  })

  describe('create', () => {
    it('delegates to service.create and logs audit', async () => {
      const dto = { name: 'New Group', clientId: 'c1' } as any
      const result = await controller.create(dto, mockReq as any)
      expect(mockCategoryGroupService.create).toHaveBeenCalledWith(dto)
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create_category_group',
          module: 'categorias',
        })
      )
      expect(result).toEqual({ _id: 'g1', name: 'Test Group' })
    })
  })

  describe('update', () => {
    it('delegates to service.update with id and clientId params', async () => {
      const dto = { name: 'Updated Name' } as any
      const result = await controller.update('g1', 'c1', dto, mockReq as any)
      expect(mockCategoryGroupService.update).toHaveBeenCalledWith(
        'g1',
        dto,
        'c1'
      )
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update_category_group',
          entityId: 'g1',
        })
      )
      expect(result).toEqual({ _id: 'g1', name: 'Updated Group' })
    })
  })

  describe('remove', () => {
    it('delegates to service.remove with id and clientId params', async () => {
      await controller.remove('g1', 'c1', mockReq as any)
      expect(mockCategoryGroupService.remove).toHaveBeenCalledWith('g1', 'c1')
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'delete_category_group',
          entityId: 'g1',
        })
      )
    })
  })
})
