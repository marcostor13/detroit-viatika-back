import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { NotFoundException } from '@nestjs/common'
import { Types } from 'mongoose'
import { CategoryService } from './category.service'
import { Category } from './entities/category.entity'

const clientId = new Types.ObjectId().toString()
const categoryId = new Types.ObjectId().toString()
const parentId = new Types.ObjectId().toString()

const mockCategory = {
  _id: new Types.ObjectId(categoryId),
  name: 'Alimentación',
  key: 'alimentacion',
  clientId: new Types.ObjectId(clientId),
  parentId: null,
  isActive: true,
  description: undefined,
  createdAt: new Date(),
  updatedAt: new Date(),
  toObject: function () {
    const { toObject: _, ...rest } = this as any
    return rest
  },
}

const mockParent = {
  _id: new Types.ObjectId(parentId),
  name: 'Gastos',
  key: 'gastos',
  clientId: new Types.ObjectId(clientId),
  parentId: null,
  isActive: true,
  description: undefined,
  createdAt: new Date(),
  updatedAt: new Date(),
  toObject: function () {
    const { toObject: _, ...rest } = this as any
    return rest
  },
}

const makeExec = (resolvedValue: any) => ({
  exec: jest.fn().mockResolvedValue(resolvedValue),
})

const makeChainable = (resolvedValue: any) => ({
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(resolvedValue),
})

const mockSave = jest.fn()

const MockModel: any = jest.fn().mockImplementation((data: any) => ({
  ...data,
  save: mockSave,
}))
MockModel.find = jest.fn()
MockModel.findOne = jest.fn()
MockModel.findOneAndUpdate = jest.fn()
MockModel.findOneAndDelete = jest.fn()
MockModel.countDocuments = jest.fn()
MockModel.deleteMany = jest.fn()

describe('CategoryService', () => {
  let service: CategoryService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoryService,
        { provide: getModelToken(Category.name), useValue: MockModel },
      ],
    }).compile()
    service = module.get<CategoryService>(CategoryService)
  })

  describe('generateKey (via create)', () => {
    it('auto-generates a key from the name', async () => {
      mockSave.mockResolvedValue(mockCategory)
      await service.create({ name: 'Alimentación', clientId })
      expect(MockModel).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'alimentacion' })
      )
    })

    it('removes accents and special characters', async () => {
      mockSave.mockResolvedValue({ ...mockCategory, name: 'Ñoño', key: 'nono' })
      await service.create({ name: 'Ñoño', clientId })
      expect(MockModel).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'nono' })
      )
    })

    it('preserves an explicit key when provided', async () => {
      mockSave.mockResolvedValue({ ...mockCategory, key: 'custom-key' })
      await service.create({ name: 'Alimentación', key: 'custom-key', clientId })
      expect(MockModel).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'custom-key' })
      )
    })

  })

  describe('create', () => {
    it('saves and returns the new category', async () => {
      mockSave.mockResolvedValue(mockCategory)
      const result = await service.create({ name: 'Alimentación', clientId })
      expect(mockSave).toHaveBeenCalled()
      expect(result).toEqual(mockCategory)
    })
  })

  describe('findAll', () => {
    it('returns paginated result', async () => {
      MockModel.countDocuments.mockReturnValue(makeExec(1))
      MockModel.find.mockReturnValue(makeChainable([mockParent]))
      const result = await service.findAll(clientId)
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.data).toHaveLength(1)
    })

    it('filters by search term', async () => {
      MockModel.countDocuments.mockReturnValue(makeExec(0))
      MockModel.find.mockReturnValue(makeChainable([]))
      await service.findAll(clientId, { search: 'alim' })
      expect(MockModel.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ name: { $regex: 'alim', $options: 'i' } })
      )
    })

    it('defaults page to 1 and limit to 20', async () => {
      MockModel.countDocuments.mockReturnValue(makeExec(0))
      MockModel.find.mockReturnValue(makeChainable([]))
      const result = await service.findAll(clientId)
      expect(result.page).toBe(1)
      expect(result.limit).toBe(20)
    })
  })

  describe('findAllFlat', () => {
    it('returns all categories without nesting', async () => {
      MockModel.find.mockReturnValue(makeExec([mockCategory]))
      const result = await service.findAllFlat(clientId)
      expect(MockModel.find).toHaveBeenCalledWith({
        clientId: expect.any(Types.ObjectId),
      })
      expect(result).toEqual([mockCategory])
    })
  })

  describe('findOne', () => {
    it('returns the category when found', async () => {
      MockModel.findOne.mockReturnValue(makeExec(mockCategory))
      const result = await service.findOne(categoryId, clientId)
      expect(result).toEqual(mockCategory)
    })

    it('throws NotFoundException when not found', async () => {
      MockModel.findOne.mockReturnValue(makeExec(null))
      await expect(service.findOne(categoryId, clientId)).rejects.toThrow(NotFoundException)
    })
  })

  describe('findByKey', () => {
    it('returns category by key', async () => {
      MockModel.findOne.mockReturnValue(makeExec(mockCategory))
      const result = await service.findByKey('alimentacion', clientId)
      expect(MockModel.findOne).toHaveBeenCalledWith({
        key: 'alimentacion',
        clientId: expect.any(Types.ObjectId),
      })
      expect(result).toEqual(mockCategory)
    })

    it('throws NotFoundException when key not found', async () => {
      MockModel.findOne.mockReturnValue(makeExec(null))
      await expect(service.findByKey('nonexistent', clientId)).rejects.toThrow(NotFoundException)
    })
  })

  describe('update', () => {
    it('updates and returns the category', async () => {
      const updated = { ...mockCategory, name: 'Transporte' }
      MockModel.findOne.mockReturnValue(makeExec(mockCategory))
      MockModel.findOneAndUpdate.mockReturnValue(makeExec(updated))
      const result = await service.update(categoryId, { name: 'Transporte' }, clientId)
      expect(result).toEqual(updated)
    })

    it('throws NotFoundException when category not found for update', async () => {
      MockModel.findOne.mockReturnValue(makeExec(mockCategory))
      MockModel.findOneAndUpdate.mockReturnValue(makeExec(null))
      await expect(service.update(categoryId, { name: 'X' }, clientId)).rejects.toThrow(NotFoundException)
    })
  })

  describe('remove', () => {
    it('deletes the category successfully', async () => {
      MockModel.findOneAndDelete.mockReturnValue(makeExec(mockCategory))
      await expect(service.remove(categoryId, clientId)).resolves.toBeUndefined()
      expect(MockModel.findOneAndDelete).toHaveBeenCalledWith({
        _id: categoryId,
        clientId: expect.any(Types.ObjectId),
      })
    })

    it('throws NotFoundException when category not found for delete', async () => {
      MockModel.findOneAndDelete.mockReturnValue(makeExec(null))
      await expect(service.remove(categoryId, clientId)).rejects.toThrow(NotFoundException)
    })
  })
})
