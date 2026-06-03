import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { AuditLogService } from './audit-log.service'
import { AuditLog } from './entities/audit-log.entity'
import { Types } from 'mongoose'

const clientId = new Types.ObjectId().toHexString()
const userId = new Types.ObjectId().toHexString()

function makeDataQuery(data: unknown[]) {
  return {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(data),
  }
}

describe('AuditLogService', () => {
  let service: AuditLogService
  let mockModel: Record<string, jest.Mock>

  beforeEach(async () => {
    jest.clearAllMocks()
    mockModel = {
      create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      find: jest.fn(),
      countDocuments: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: getModelToken(AuditLog.name), useValue: mockModel },
      ],
    }).compile()

    service = module.get<AuditLogService>(AuditLogService)
  })

  describe('log', () => {
    it('crea un registro de auditoria en la base de datos', async () => {
      await service.log({
        userId,
        userName: 'Admin',
        action: 'create_user',
        module: 'usuarios',
        entityId: new Types.ObjectId().toHexString(),
        clientId,
      })
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId, action: 'create_user' })
      )
    })

    it('no lanza excepcion si el modelo falla', async () => {
      mockModel.create.mockRejectedValue(new Error('DB error'))
      await expect(
        service.log({ userId, userName: 'Admin', action: 'create_user', module: 'usuarios' })
      ).resolves.toBeUndefined()
    })
  })

  describe('findAll', () => {
    it('retorna datos paginados con filtro de clientId', async () => {
      const logs = [{ _id: new Types.ObjectId(), action: 'create_user' }]
      mockModel.find.mockReturnValue(makeDataQuery(logs))
      mockModel.countDocuments.mockResolvedValue(1)

      const result = await service.findAll(clientId, { page: 1, limit: 20 })

      expect(result).toEqual({ data: logs, total: 1, page: 1, pages: 1, limit: 20 })
      expect(mockModel.find).toHaveBeenCalledWith(expect.objectContaining({ clientId }))
    })

    it('aplica filtro de modulo', async () => {
      mockModel.find.mockReturnValue(makeDataQuery([]))
      mockModel.countDocuments.mockResolvedValue(0)

      await service.findAll(clientId, { module: 'usuarios' })

      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ module: 'usuarios' })
      )
    })

    it('aplica filtro de busqueda de texto', async () => {
      mockModel.find.mockReturnValue(makeDataQuery([]))
      mockModel.countDocuments.mockResolvedValue(0)

      await service.findAll(clientId, { search: 'juan' })

      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ $or: expect.any(Array) })
      )
    })

    it('usa valores por defecto si no se pasan opciones', async () => {
      mockModel.find.mockReturnValue(makeDataQuery([]))
      mockModel.countDocuments.mockResolvedValue(0)

      const result = await service.findAll(clientId)

      expect(result.page).toBe(1)
      expect(result.limit).toBe(20)
    })

    it('calcula correctamente el numero de paginas', async () => {
      mockModel.find.mockReturnValue(makeDataQuery([]))
      mockModel.countDocuments.mockResolvedValue(45)

      const result = await service.findAll(clientId, { page: 1, limit: 20 })

      expect(result.pages).toBe(3)
    })
  })
})
