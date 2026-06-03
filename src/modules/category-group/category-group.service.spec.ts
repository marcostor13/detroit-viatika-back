import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Types } from 'mongoose'
import { CategoryGroupService } from './category-group.service'
import { CategoryGroup } from './entities/category-group.entity'

const clientId = new Types.ObjectId().toString()
const groupId = new Types.ObjectId().toString()

const makeGroup = (overrides: any = {}) => ({
  _id: new Types.ObjectId(groupId),
  name: 'Test Group',
  description: 'A test group',
  clientId: new Types.ObjectId(clientId),
  categoryIds: [],
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
})

const mockGroupModel = {
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findOneAndDelete: jest.fn(),
}

// Constructor mock for new this.groupModel(...)
function MockGroupModel(data: any) {
  return { ...data, save: jest.fn().mockResolvedValue({ ...data, _id: new Types.ObjectId(groupId) }) }
}
Object.assign(MockGroupModel, mockGroupModel)

describe('CategoryGroupService', () => {
  let service: CategoryGroupService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoryGroupService,
        { provide: getModelToken(CategoryGroup.name), useValue: MockGroupModel },
      ],
    }).compile()
    service = module.get<CategoryGroupService>(CategoryGroupService)
  })

  it('is defined', () => {
    expect(service).toBeDefined()
  })

  describe('findAll', () => {
    it('returns groups filtered by clientId', async () => {
      const groups = [makeGroup()]
      ;(MockGroupModel as any).find.mockReturnValue({ exec: jest.fn().mockResolvedValue(groups) })
      const result = await service.findAll(clientId)
      expect(result).toEqual(groups)
      expect((MockGroupModel as any).find).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: expect.any(Types.ObjectId) })
      )
    })
  })

  describe('findOne', () => {
    it('returns group when found', async () => {
      const group = makeGroup()
      ;(MockGroupModel as any).findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(group) })
      const result = await service.findOne(groupId, clientId)
      expect(result).toBe(group)
    })

    it('throws NotFoundException when group is not found', async () => {
      ;(MockGroupModel as any).findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) })
      await expect(service.findOne(groupId, clientId)).rejects.toThrow(NotFoundException)
    })

    it('throws BadRequestException for invalid id', async () => {
      await expect(service.findOne('invalid-id', clientId)).rejects.toThrow(BadRequestException)
    })
  })

  describe('create', () => {
    it('creates and saves a new group', async () => {
      const dto = { name: 'New Group', description: 'Desc', clientId, categoryIds: [] }
      const saved = makeGroup({ name: 'New Group' })
      ;(MockGroupModel as any).save = jest.fn().mockResolvedValue(saved)
      const result = await service.create(dto)
      expect(result).toBeDefined()
    })
  })

  describe('update', () => {
    it('updates group and returns updated document', async () => {
      const updated = makeGroup({ name: 'Updated Name' })
      ;(MockGroupModel as any).findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(updated) })
      const result = await service.update(groupId, { name: 'Updated Name' }, clientId)
      expect(result).toBe(updated)
    })

    it('throws NotFoundException when group to update is not found', async () => {
      ;(MockGroupModel as any).findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) })
      await expect(service.update(groupId, { name: 'X' }, clientId)).rejects.toThrow(NotFoundException)
    })

    it('updates only provided fields', async () => {
      const updated = makeGroup()
      ;(MockGroupModel as any).findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(updated) })
      await service.update(groupId, { description: 'New desc' }, clientId)
      expect((MockGroupModel as any).findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ description: 'New desc' }),
        expect.any(Object)
      )
    })
  })

  describe('remove', () => {
    it('removes group successfully', async () => {
      ;(MockGroupModel as any).findOneAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(makeGroup()) })
      await expect(service.remove(groupId, clientId)).resolves.toBeUndefined()
    })

    it('throws NotFoundException when group to remove is not found', async () => {
      ;(MockGroupModel as any).findOneAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) })
      await expect(service.remove(groupId, clientId)).rejects.toThrow(NotFoundException)
    })
  })
})
