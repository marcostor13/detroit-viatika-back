import { Test, TestingModule } from '@nestjs/testing'
import { Types } from 'mongoose'
import { CategoryController } from './category.controller'
import { CategoryService } from './category.service'
import { AuditLogService } from '../audit-log/audit-log.service'

const clientId = new Types.ObjectId().toHexString()
const catId = new Types.ObjectId().toHexString()
const userId = new Types.ObjectId().toHexString()

const makeReq = () => ({
  user: { _id: userId, sub: userId, name: 'Admin', email: 'a@a.com', clientId },
})

const mockCategoryService = {
  create: jest.fn().mockResolvedValue({ _id: catId, name: 'Alimentación' }),
  findAllFlat: jest.fn().mockResolvedValue([]),
  findAll: jest.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: jest.fn().mockResolvedValue({ _id: catId }),
  findByKey: jest.fn().mockResolvedValue({ _id: catId }),
  update: jest.fn().mockResolvedValue({ _id: catId, name: 'Actualizado' }),
  remove: jest.fn().mockResolvedValue({ _id: catId }),
}

const mockAuditLogService = { log: jest.fn().mockResolvedValue(undefined) }

describe('CategoryController', () => {
  let controller: CategoryController

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoryController],
      providers: [
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile()
    controller = module.get<CategoryController>(CategoryController)
  })

  describe('create', () => {
    it('crea la categoria y registra auditoria', async () => {
      const dto: any = { name: 'Alimentación', clientId }
      const req = makeReq()
      const result = await controller.create(dto, req as never)
      expect(mockCategoryService.create).toHaveBeenCalledWith(dto)
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create_category',
          module: 'categorias',
        })
      )
      expect(result).toBeDefined()
    })
  })

  describe('findAllFlat', () => {
    it('delega al servicio con clientId', async () => {
      const req = makeReq()
      await controller.findAllFlat(clientId, req as never)
      expect(mockCategoryService.findAllFlat).toHaveBeenCalledWith(
        clientId,
        undefined
      )
    })
  })

  describe('findAllFlatLegacy', () => {
    it('usa la misma logica que findAllFlat', async () => {
      const req = makeReq()
      await controller.findAllFlatLegacy(clientId, req as never)
      expect(mockCategoryService.findAllFlat).toHaveBeenCalledWith(
        clientId,
        undefined
      )
    })
  })

  describe('findAll', () => {
    it('pasa parametros de paginacion al servicio', async () => {
      await controller.findAll(clientId, '2', '10', 'comida')
      expect(mockCategoryService.findAll).toHaveBeenCalledWith(clientId, {
        page: 2,
        limit: 10,
        search: 'comida',
      })
    })

    it('maneja parametros undefined', async () => {
      await controller.findAll(clientId, undefined, undefined, undefined)
      expect(mockCategoryService.findAll).toHaveBeenCalledWith(clientId, {
        page: undefined,
        limit: undefined,
        search: undefined,
      })
    })
  })

  describe('findOne', () => {
    it('delega al servicio con id y clientId', async () => {
      await controller.findOne(catId, clientId)
      expect(mockCategoryService.findOne).toHaveBeenCalledWith(catId, clientId)
    })
  })

  describe('findByKey', () => {
    it('delega al servicio con key y clientId', async () => {
      await controller.findByKey('alimentacion', clientId)
      expect(mockCategoryService.findByKey).toHaveBeenCalledWith(
        'alimentacion',
        clientId
      )
    })
  })

  describe('update', () => {
    it('busca el anterior, actualiza y registra auditoria', async () => {
      const dto: any = { limit: 1000 }
      const req = makeReq()
      const result = await controller.update(catId, clientId, dto, req as never)
      expect(mockCategoryService.findOne).toHaveBeenCalledWith(catId, clientId)
      expect(mockCategoryService.update).toHaveBeenCalledWith(
        catId,
        dto,
        clientId
      )
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'update_category' })
      )
      expect(result).toBeDefined()
    })
  })

  describe('remove', () => {
    it('elimina la categoria y registra auditoria', async () => {
      const req = makeReq()
      const result = await controller.remove(catId, clientId, req as never)
      expect(mockCategoryService.remove).toHaveBeenCalledWith(catId, clientId)
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete_category' })
      )
      expect(result).toBeDefined()
    })
  })
})
