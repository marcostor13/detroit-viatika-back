import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { Types } from 'mongoose'
import { CategoryService } from './category.service'
import { Category } from './entities/category.entity'
import { CategoryProfile } from '../category-profile/entities/category-profile.entity'

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
    const { toObject: _, ...rest } = this
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
    const { toObject: _, ...rest } = this
    return rest
  },
}

const makeExec = (resolvedValue: any) => ({
  collation: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(resolvedValue),
})

const makeChainable = (resolvedValue: any) => ({
  collation: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
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
MockModel.create = jest.fn()

const MockProfileModel: any = {}
MockProfileModel.findOneAndUpdate = jest.fn()

describe('CategoryService', () => {
  let service: CategoryService

  beforeEach(async () => {
    jest.clearAllMocks()
    // Default: sin colisiones de key (generateUniqueKey consulta las tomadas).
    MockModel.find.mockReturnValue(makeChainable([]))
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoryService,
        { provide: getModelToken(Category.name), useValue: MockModel },
        {
          provide: getModelToken(CategoryProfile.name),
          useValue: MockProfileModel,
        },
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
      await service.create({
        name: 'Alimentación',
        key: 'custom-key',
        clientId,
      })
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

    it('añade sufijo -2 cuando el slug ya existe (dos "Planilla de movilidad" con distinta cuenta)', async () => {
      MockModel.find.mockReturnValue(
        makeChainable([{ key: 'planilla-de-movilidad' }])
      )
      mockSave.mockResolvedValue(mockCategory)
      await service.create({ name: 'Planilla de movilidad', clientId })
      expect(MockModel).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'planilla-de-movilidad-2' })
      )
    })

    it('salta al -3 cuando el base y el -2 ya están tomados', async () => {
      MockModel.find.mockReturnValue(
        makeChainable([
          { key: 'planilla-de-movilidad' },
          { key: 'planilla-de-movilidad-2' },
        ])
      )
      mockSave.mockResolvedValue(mockCategory)
      await service.create({ name: 'Planilla de movilidad', clientId })
      expect(MockModel).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'planilla-de-movilidad-3' })
      )
    })

    it('mapea el error de clave duplicada (E11000) a ConflictException', async () => {
      mockSave.mockRejectedValue({ code: 11000 })
      await expect(
        service.create({ name: 'Alimentación', clientId })
      ).rejects.toBeInstanceOf(ConflictException)
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
      await expect(service.findOne(categoryId, clientId)).rejects.toThrow(
        NotFoundException
      )
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
      await expect(service.findByKey('nonexistent', clientId)).rejects.toThrow(
        NotFoundException
      )
    })
  })

  describe('update', () => {
    it('updates and returns the category', async () => {
      const updated = { ...mockCategory, name: 'Transporte' }
      MockModel.findOne.mockReturnValue(makeExec(mockCategory))
      MockModel.findOneAndUpdate.mockReturnValue(makeExec(updated))
      const result = await service.update(
        categoryId,
        { name: 'Transporte' },
        clientId
      )
      expect(result).toEqual(updated)
    })

    it('throws NotFoundException when category not found for update', async () => {
      MockModel.findOne.mockReturnValue(makeExec(mockCategory))
      MockModel.findOneAndUpdate.mockReturnValue(makeExec(null))
      await expect(
        service.update(categoryId, { name: 'X' }, clientId)
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('remove', () => {
    it('deletes the category successfully', async () => {
      MockModel.findOneAndDelete.mockReturnValue(makeExec(mockCategory))
      await expect(
        service.remove(categoryId, clientId)
      ).resolves.toBeUndefined()
      expect(MockModel.findOneAndDelete).toHaveBeenCalledWith({
        _id: categoryId,
        clientId: expect.any(Types.ObjectId),
      })
    })

    it('throws NotFoundException when category not found for delete', async () => {
      MockModel.findOneAndDelete.mockReturnValue(makeExec(null))
      await expect(service.remove(categoryId, clientId)).rejects.toThrow(
        NotFoundException
      )
    })
  })

  describe('bulkCreate', () => {
    it('reports a row error when name is missing', async () => {
      const result = await service.bulkCreate([{ name: '' }], clientId)
      expect(result.created).toBe(0)
      expect(result.errors).toEqual([
        { row: 2, reason: 'El campo Nombre es obligatorio' },
      ])
      expect(result.warnings).toEqual([])
    })

    it('creates a category and does not touch CategoryProfile when perfil is absent', async () => {
      MockModel.create.mockResolvedValue({ ...mockCategory, _id: mockCategory._id })
      const result = await service.bulkCreate(
        [{ name: 'Movilidad' }],
        clientId
      )
      expect(result.created).toBe(1)
      expect(result.errors).toEqual([])
      expect(MockProfileModel.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('links the new category into an existing/new profile via upsert + $addToSet', async () => {
      MockModel.create.mockResolvedValue({ ...mockCategory, _id: mockCategory._id })
      MockProfileModel.findOneAndUpdate.mockReturnValue(makeExec({}))
      const result = await service.bulkCreate(
        [{ name: 'Movilidad', perfil: 'Gastos de campo' }],
        clientId
      )
      expect(result.created).toBe(1)
      expect(result.warnings).toEqual([])
      expect(MockProfileModel.findOneAndUpdate).toHaveBeenCalledWith(
        { name: 'Gastos de campo', clientId: expect.any(Types.ObjectId) },
        expect.objectContaining({
          $addToSet: { categoryIds: mockCategory._id },
          $setOnInsert: {
            name: 'Gastos de campo',
            clientId: expect.any(Types.ObjectId),
          },
        }),
        { new: true, upsert: true }
      )
    })

    it('still counts the row as created if profile linkage fails, and reports a warning instead of an error', async () => {
      MockModel.create.mockResolvedValue({ ...mockCategory, _id: mockCategory._id })
      MockProfileModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('perfil boom')),
      })
      const result = await service.bulkCreate(
        [{ name: 'Movilidad', perfil: 'Gastos de campo' }],
        clientId
      )
      expect(result.created).toBe(1)
      expect(result.errors).toEqual([])
      expect(result.warnings).toEqual([
        {
          row: 2,
          reason:
            'Categoría creada pero no se pudo vincular al perfil "Gastos de campo": perfil boom',
        },
      ])
    })

    it('reports a duplicate-key row error without aborting the batch', async () => {
      MockModel.create
        .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }))
        .mockResolvedValueOnce({ ...mockCategory, _id: mockCategory._id })
      const result = await service.bulkCreate(
        [{ name: 'Movilidad' }, { name: 'Alimentación' }],
        clientId
      )
      expect(result.created).toBe(1)
      expect(result.errors).toEqual([
        {
          row: 2,
          reason: 'Ya existe una categoría con nombre similar (clave duplicada)',
        },
      ])
    })
  })
})
