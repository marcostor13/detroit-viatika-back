import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Types } from 'mongoose'
import { OrdenTrabajoService } from './orden-trabajo.service'
import { OrdenTrabajo } from './entities/orden-trabajo.entity'
import { Project } from '../project/entities/project.entity'

const clientId = new Types.ObjectId().toString()
const costCenterId = new Types.ObjectId().toString()
const ordenId = new Types.ObjectId().toString()

const mockOrden = {
  _id: new Types.ObjectId(ordenId),
  nombre: 'Lim-Com-1',
  costCenterId: new Types.ObjectId(costCenterId),
  isActive: true,
  clientId: new Types.ObjectId(clientId),
}

const makeQuery = (resolvedValue: any) => ({
  populate: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(resolvedValue),
})

const mockOrdenTrabajoModel = {
  create: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findOneAndDelete: jest.fn(),
  countDocuments: jest.fn(),
  exists: jest.fn(),
}

const mockProjectModel = {
  exists: jest.fn(),
  findOne: jest.fn(),
}

describe('OrdenTrabajoService', () => {
  let service: OrdenTrabajoService

  beforeEach(async () => {
    jest.clearAllMocks()
    mockOrdenTrabajoModel.exists.mockReturnValue(makeQuery(null))
    mockProjectModel.exists.mockReturnValue(makeQuery({ _id: costCenterId }))
    mockProjectModel.findOne.mockReturnValue(makeQuery(null))

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdenTrabajoService,
        {
          provide: getModelToken(OrdenTrabajo.name),
          useValue: mockOrdenTrabajoModel,
        },
        { provide: getModelToken(Project.name), useValue: mockProjectModel },
      ],
    }).compile()
    service = module.get<OrdenTrabajoService>(OrdenTrabajoService)
  })

  describe('create', () => {
    it('creates an OT when the cost center exists and the name is unique', async () => {
      mockOrdenTrabajoModel.create.mockResolvedValue(mockOrden)
      const result = await service.create(
        { nombre: 'Lim-Com-1', costCenterId },
        clientId
      )
      expect(mockOrdenTrabajoModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ nombre: 'Lim-Com-1', isActive: true })
      )
      expect(result).toEqual(mockOrden)
    })

    it('rejects when the cost center does not belong to the company', async () => {
      mockProjectModel.exists.mockReturnValue(makeQuery(null))
      await expect(
        service.create({ nombre: 'X', costCenterId }, clientId)
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects a duplicate name within the same company (case-insensitive)', async () => {
      mockOrdenTrabajoModel.exists.mockReturnValue(makeQuery(mockOrden))
      await expect(
        service.create({ nombre: 'lim-com-1', costCenterId }, clientId)
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      mockOrdenTrabajoModel.findOne.mockReturnValue(makeQuery(null))
      await expect(service.findOne(ordenId, clientId)).rejects.toThrow(
        NotFoundException
      )
    })
  })

  describe('bulkCreate', () => {
    it('reports a row error when nombre is missing', async () => {
      const result = await service.bulkCreate(
        [{ nombre: '', costCenterKey: 'CC-001' }],
        clientId
      )
      expect(result.created).toBe(0)
      expect(result.errors).toEqual([
        { row: 2, reason: 'El campo Nombre es obligatorio' },
      ])
    })

    it('reports a row error when costCenterKey is missing', async () => {
      const result = await service.bulkCreate(
        [{ nombre: 'Lim-Com-1', costCenterKey: '' }],
        clientId
      )
      expect(result.errors).toEqual([
        { row: 2, reason: 'El campo Centro de Costo es obligatorio' },
      ])
    })

    it('resolves the cost center by code first', async () => {
      const ccId = new Types.ObjectId()
      mockProjectModel.findOne
        .mockReturnValueOnce(makeQuery({ _id: ccId })) // code lookup hits
      mockOrdenTrabajoModel.create.mockResolvedValue(mockOrden)

      const result = await service.bulkCreate(
        [{ nombre: 'Lim-Com-1', costCenterKey: 'CC-001' }],
        clientId
      )

      expect(result.created).toBe(1)
      expect(mockOrdenTrabajoModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ costCenterId: ccId })
      )
    })

    it('falls back to matching the cost center by name when the code does not match', async () => {
      const ccId = new Types.ObjectId()
      mockProjectModel.findOne
        .mockReturnValueOnce(makeQuery(null)) // code miss
        .mockReturnValueOnce(makeQuery({ _id: ccId })) // name hit
      mockOrdenTrabajoModel.create.mockResolvedValue(mockOrden)

      const result = await service.bulkCreate(
        [{ nombre: 'Lim-Com-1', costCenterKey: 'Centro Principal' }],
        clientId
      )

      expect(result.created).toBe(1)
      expect(mockOrdenTrabajoModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ costCenterId: ccId })
      )
    })

    it('errors the row (does not abort the batch) when the cost center is not found', async () => {
      mockProjectModel.findOne.mockReturnValue(makeQuery(null))
      mockOrdenTrabajoModel.create.mockResolvedValue(mockOrden)

      const result = await service.bulkCreate(
        [
          { nombre: 'Fila mala', costCenterKey: 'NO-EXISTE' },
          { nombre: 'Fila buena', costCenterKey: 'NO-EXISTE-2' },
        ],
        clientId
      )

      expect(result.created).toBe(0)
      expect(result.errors).toHaveLength(2)
      expect(result.errors[0].reason).toContain('no encontrado')
    })

    it('rejects a name repeated within the same file without querying the DB twice', async () => {
      const ccId = new Types.ObjectId()
      mockProjectModel.findOne.mockReturnValue(makeQuery({ _id: ccId }))
      mockOrdenTrabajoModel.create.mockResolvedValue(mockOrden)

      const result = await service.bulkCreate(
        [
          { nombre: 'Lim-Com-1', costCenterKey: 'CC-001' },
          { nombre: 'lim-com-1', costCenterKey: 'CC-001' },
        ],
        clientId
      )

      expect(result.created).toBe(1)
      expect(result.errors).toEqual([
        { row: 3, reason: 'Nombre "lim-com-1" repetido en este mismo archivo' },
      ])
    })

    it('reports a duplicate-name row error (existing DB record) without aborting the batch', async () => {
      const ccId = new Types.ObjectId()
      mockProjectModel.findOne.mockReturnValue(makeQuery({ _id: ccId }))
      mockOrdenTrabajoModel.exists.mockReturnValue(makeQuery(mockOrden))

      const result = await service.bulkCreate(
        [{ nombre: 'Lim-Com-1', costCenterKey: 'CC-001' }],
        clientId
      )

      expect(result.created).toBe(0)
      expect(result.errors[0].reason).toContain('Ya existe una orden de trabajo')
    })

    it('defaults isActive to true when not provided', async () => {
      const ccId = new Types.ObjectId()
      mockProjectModel.findOne.mockReturnValue(makeQuery({ _id: ccId }))
      mockOrdenTrabajoModel.create.mockResolvedValue(mockOrden)

      await service.bulkCreate(
        [{ nombre: 'Lim-Com-1', costCenterKey: 'CC-001' }],
        clientId
      )

      expect(mockOrdenTrabajoModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true })
      )
    })
  })
})
