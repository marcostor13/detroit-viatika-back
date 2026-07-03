import { Test, TestingModule } from '@nestjs/testing'
import { Types } from 'mongoose'
import { AuditLogController } from './audit-log.controller'
import { AuditLogService } from './audit-log.service'

const clientId = new Types.ObjectId().toHexString()

const mockAuditLogService = {
  findAll: jest
    .fn()
    .mockResolvedValue({ data: [], total: 0, page: 1, pages: 0, limit: 20 }),
}

describe('AuditLogController', () => {
  let controller: AuditLogController

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditLogController],
      providers: [{ provide: AuditLogService, useValue: mockAuditLogService }],
    }).compile()
    controller = module.get<AuditLogController>(AuditLogController)
  })

  describe('findAll', () => {
    it('delega al servicio con el clientId del JWT', async () => {
      const req = { user: { clientId } }
      const result = await controller.findAll(
        req as never,
        '1',
        '20',
        'usuarios',
        undefined
      )
      expect(mockAuditLogService.findAll).toHaveBeenCalledWith(clientId, {
        page: 1,
        limit: 20,
        module: 'usuarios',
        search: undefined,
      })
      expect(result).toBeDefined()
    })

    it('usa valores por defecto si no se pasan parametros', async () => {
      const req = { user: { clientId } }
      await controller.findAll(
        req as never,
        undefined,
        undefined,
        undefined,
        undefined
      )
      expect(mockAuditLogService.findAll).toHaveBeenCalledWith(clientId, {
        page: 1,
        limit: 20,
        module: undefined,
        search: undefined,
      })
    })

    it('pasa el parametro de busqueda al servicio', async () => {
      const req = { user: { clientId } }
      await controller.findAll(req as never, '2', '10', undefined, 'juan')
      expect(mockAuditLogService.findAll).toHaveBeenCalledWith(clientId, {
        page: 2,
        limit: 10,
        module: undefined,
        search: 'juan',
      })
    })
  })
})
