import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Types } from 'mongoose'
import { ProjectService } from './project.service'
import { Project } from './entities/project.entity'

const clientId = new Types.ObjectId().toString()
const projectId = new Types.ObjectId().toString()

const mockProject = {
  _id: new Types.ObjectId(projectId),
  name: 'Test Project',
  code: 'CC-001',
  isActive: true,
  clientName: undefined,
  committedAdvanceTotal: 0,
  clientId: { _id: new Types.ObjectId(clientId), name: 'Test Client' },
}

const expectedResponse = {
  _id: mockProject._id,
  name: mockProject.name,
  code: mockProject.code,
  isActive: mockProject.isActive,
  clientName: mockProject.clientName,
  committedAdvanceTotal: mockProject.committedAdvanceTotal,
  client: mockProject.clientId,
}

const makeQuery = (resolvedValue: any) => ({
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(resolvedValue),
})

const makeCountQuery = (count: number) => ({
  exec: jest.fn().mockResolvedValue(count),
})

const mockExpenseModel = {
  countDocuments: jest.fn().mockReturnValue(Promise.resolve(0)),
}

const mockProjectModel = {
  create: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findOneAndDelete: jest.fn(),
  countDocuments: jest.fn(),
  db: {
    model: jest.fn().mockReturnValue(mockExpenseModel),
  },
}

describe('ProjectService', () => {
  let service: ProjectService

  beforeEach(async () => {
    jest.clearAllMocks()
    mockProjectModel.db.model.mockReturnValue(mockExpenseModel)
    mockExpenseModel.countDocuments.mockReturnValue(Promise.resolve(0))
    mockProjectModel.findOne.mockReturnValue(makeQuery(null))

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        { provide: getModelToken(Project.name), useValue: mockProjectModel },
      ],
    }).compile()
    service = module.get<ProjectService>(ProjectService)
  })

  describe('create', () => {
    it('creates a project with clientId as ObjectId', async () => {
      mockProjectModel.create.mockResolvedValue(mockProject)
      const result = await service.create({ name: 'Test Project', clientId })
      expect(mockProjectModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Project',
          clientId: expect.any(Types.ObjectId),
        })
      )
      expect(result).toEqual(expectedResponse)
    })

    it('generates code from name when code is not provided', async () => {
      mockProjectModel.create.mockResolvedValue({ ...mockProject, code: 'MY-PROJECT' })
      await service.create({ name: 'My Project', clientId })
      expect(mockProjectModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'MY-PROJECT' })
      )
    })

    it('uses provided code when given', async () => {
      mockProjectModel.create.mockResolvedValue({ ...mockProject, code: 'CUSTOM' })
      await service.create({ name: 'Any', code: 'CUSTOM', clientId })
      expect(mockProjectModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'CUSTOM' })
      )
    })

    it('throws a friendly error when the code already exists', async () => {
      mockProjectModel.findOne.mockReturnValue(makeQuery(mockProject))

      await expect(
        service.create({ name: 'Duplicado', code: 'CC-001', clientId })
      ).rejects.toThrow(
        new BadRequestException(
          'Ya existe un centro de costo con el código "CC-001". Usa un código diferente.'
        )
      )
      expect(mockProjectModel.create).not.toHaveBeenCalled()
    })
  })

  describe('findAll', () => {
    it('returns mapped list of projects for a client', async () => {
      mockProjectModel.find.mockReturnValue(makeQuery([mockProject]))
      mockProjectModel.countDocuments.mockReturnValue(makeCountQuery(1))
      const result = await service.findAll(clientId)
      expect(mockProjectModel.find).toHaveBeenCalledWith({
        clientId: expect.any(Types.ObjectId),
      })
      expect(result).toEqual([expectedResponse])
    })

    it('returns empty array when no projects exist', async () => {
      mockProjectModel.find.mockReturnValue(makeQuery([]))
      mockProjectModel.countDocuments.mockReturnValue(makeCountQuery(0))
      const result = await service.findAll(clientId)
      expect(result).toEqual([])
    })

    it('returns paginated result when page/limit opts are provided', async () => {
      mockProjectModel.find.mockReturnValue(makeQuery([mockProject]))
      mockProjectModel.countDocuments.mockReturnValue(makeCountQuery(25))
      const result = await service.findAll(clientId, { page: 2, limit: 10 }) as any
      expect(result.data).toEqual([expectedResponse])
      expect(result.total).toBe(25)
      expect(result.page).toBe(2)
      expect(result.limit).toBe(10)
      expect(result.pages).toBe(3)
    })

    it('filters by isActive when provided', async () => {
      mockProjectModel.find.mockReturnValue(makeQuery([]))
      mockProjectModel.countDocuments.mockReturnValue(makeCountQuery(0))
      await service.findAll(clientId, { isActive: false })
      expect(mockProjectModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false })
      )
    })

    it('filters by search text when provided', async () => {
      mockProjectModel.find.mockReturnValue(makeQuery([]))
      mockProjectModel.countDocuments.mockReturnValue(makeCountQuery(0))
      await service.findAll(clientId, { search: 'alpha' })
      expect(mockProjectModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ $or: expect.any(Array) })
      )
    })
  })

  describe('findOne', () => {
    it('returns the project when found', async () => {
      mockProjectModel.findOne.mockReturnValue(makeQuery(mockProject))
      const result = await service.findOne(projectId, clientId)
      expect(result).toEqual(expectedResponse)
    })

    it('throws NotFoundException when project does not exist', async () => {
      mockProjectModel.findOne.mockReturnValue(makeQuery(null))
      await expect(service.findOne(projectId, clientId)).rejects.toThrow(NotFoundException)
    })
  })

  describe('update', () => {
    it('returns updated project', async () => {
      const updated = { ...mockProject, name: 'Updated' }
      mockProjectModel.findOneAndUpdate.mockReturnValue(makeQuery(updated))
      const result = await service.update(projectId, { name: 'Updated' }, clientId)
      expect(result).toEqual({ ...expectedResponse, name: 'Updated' })
    })

    it('throws NotFoundException when project not found for update', async () => {
      mockProjectModel.findOneAndUpdate.mockReturnValue(makeQuery(null))
      await expect(service.update(projectId, { name: 'X' }, clientId)).rejects.toThrow(NotFoundException)
    })

    it('checks for active expenses when deactivating', async () => {
      mockExpenseModel.countDocuments.mockReturnValue(Promise.resolve(3))
      await expect(
        service.update(projectId, { isActive: false }, clientId)
      ).rejects.toThrow(BadRequestException)
    })

    it('proceeds with deactivation when no active expenses exist', async () => {
      mockExpenseModel.countDocuments.mockReturnValue(Promise.resolve(0))
      const updated = { ...mockProject, isActive: false }
      mockProjectModel.findOneAndUpdate.mockReturnValue(makeQuery(updated))
      const result = await service.update(projectId, { isActive: false }, clientId)
      expect(result).toEqual({ ...expectedResponse, isActive: false })
    })

    it('throws a friendly error when updating with a duplicate code from another record', async () => {
      mockProjectModel.findOne.mockReturnValue(
        makeQuery({ ...mockProject, _id: new Types.ObjectId() })
      )

      await expect(
        service.update(projectId, { code: 'CC-001' }, clientId)
      ).rejects.toThrow(
        new BadRequestException(
          'Ya existe un centro de costo con el código "CC-001". Usa un código diferente.'
        )
      )
      expect(mockProjectModel.findOneAndUpdate).not.toHaveBeenCalled()
    })
  })

  describe('remove', () => {
    it('returns deleted project', async () => {
      mockProjectModel.findOneAndDelete.mockReturnValue(makeQuery(mockProject))
      const result = await service.remove(projectId, clientId)
      expect(result).toEqual(mockProject)
    })

    it('throws NotFoundException when project not found for delete', async () => {
      mockProjectModel.findOneAndDelete.mockReturnValue(makeQuery(null))
      await expect(service.remove(projectId, clientId)).rejects.toThrow(NotFoundException)
    })
  })

  describe('adjustCommittedAdvanceTotal', () => {
    it('increments committed budget with positive delta', async () => {
      const updatedDoc = {
        ...mockProject,
        committedAdvanceTotal: 250,
        save: jest.fn().mockResolvedValue(undefined),
      }
      mockProjectModel.findOneAndUpdate.mockReturnValue(makeQuery(updatedDoc))

      await service.adjustCommittedAdvanceTotal(projectId, clientId, 250)

      expect(mockProjectModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: expect.any(Types.ObjectId),
          clientId: expect.any(Types.ObjectId),
        },
        { $inc: { committedAdvanceTotal: 250 } },
        { new: true }
      )
      expect(updatedDoc.save).not.toHaveBeenCalled()
    })

    it('clamps to zero when delta would make total negative', async () => {
      const updatedDoc = {
        ...mockProject,
        committedAdvanceTotal: -10,
        save: jest.fn().mockResolvedValue(undefined),
      }
      mockProjectModel.findOneAndUpdate.mockReturnValue(makeQuery(updatedDoc))

      await service.adjustCommittedAdvanceTotal(projectId, clientId, -50)

      expect(updatedDoc.committedAdvanceTotal).toBe(0)
      expect(updatedDoc.save).toHaveBeenCalled()
    })

    it('is a no-op when delta is 0', async () => {
      await service.adjustCommittedAdvanceTotal(projectId, clientId, 0)
      expect(mockProjectModel.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('throws NotFoundException when project not found during adjustment', async () => {
      mockProjectModel.findOneAndUpdate.mockReturnValue(makeQuery(null))
      await expect(
        service.adjustCommittedAdvanceTotal(projectId, clientId, 100)
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('bulkImport', () => {
    it('creates projects from valid rows', async () => {
      mockProjectModel.findOne.mockReturnValue(makeQuery(null))
      mockProjectModel.create.mockResolvedValue(mockProject)

      const result = await service.bulkImport(
        [{ 'Nombre Proyecto': 'Alpha', 'Código': 'ALPHA-01' }],
        clientId
      )

      expect(result.created).toBe(1)
      expect(result.skipped).toHaveLength(0)
      expect(result.errors).toHaveLength(0)
    })

    it('skips rows with an existing code', async () => {
      mockProjectModel.findOne.mockReturnValue(makeQuery(mockProject))

      const result = await service.bulkImport(
        [{ 'Nombre Proyecto': 'Alpha', 'Código': 'CC-001' }],
        clientId
      )

      expect(result.skipped).toContain('CC-001')
      expect(result.created).toBe(0)
    })

    it('records errors for rows without a name', async () => {
      const result = await service.bulkImport([{ 'Código': 'X' }], clientId)
      expect(result.errors).toHaveLength(1)
    })

    it('records errors when create throws', async () => {
      mockProjectModel.findOne.mockReturnValue(makeQuery(null))
      mockProjectModel.create.mockRejectedValue(new Error('DB error'))

      const result = await service.bulkImport(
        [{ 'Nombre Proyecto': 'Fail Project' }],
        clientId
      )

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('DB error')
    })

    it('handles multiple rows mixing create, skip, and error', async () => {
      mockProjectModel.findOne
        .mockReturnValueOnce(makeQuery(null))
        .mockReturnValueOnce(makeQuery(mockProject))
      mockProjectModel.create.mockResolvedValueOnce(mockProject)

      const result = await service.bulkImport(
        [
          { 'Nombre Proyecto': 'New' },
          { 'Nombre Proyecto': 'Existing', 'Código': 'CC-001' },
          {},
        ],
        clientId
      )

      expect(result.created).toBe(1)
      expect(result.skipped).toHaveLength(1)
      expect(result.errors).toHaveLength(1)
    })
  })
})
