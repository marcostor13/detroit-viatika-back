import { Test, TestingModule } from '@nestjs/testing'
import { UnauthorizedException } from '@nestjs/common'
import { Types } from 'mongoose'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'

const userId = new Types.ObjectId().toHexString()
const notifId = new Types.ObjectId().toHexString()

const makeReq = (overrides: Record<string, unknown> = {}) => ({
  user: { _id: userId, ...overrides },
})

const mockService = {
  create: jest.fn().mockResolvedValue({ _id: notifId, isRead: false }),
  findByUser: jest.fn().mockResolvedValue([]),
  getUnreadCount: jest.fn().mockResolvedValue(3),
  findOne: jest.fn().mockResolvedValue({ _id: notifId }),
  markAllAsRead: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
  markAsRead: jest.fn().mockResolvedValue({ _id: notifId, isRead: true }),
}

describe('NotificationsController', () => {
  let controller: NotificationsController

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: mockService }],
    }).compile()
    controller = module.get<NotificationsController>(NotificationsController)
  })

  describe('create', () => {
    it('crea la notificacion con el DTO proporcionado', async () => {
      const dto: any = {
        userId,
        title: 'Test',
        message: 'Mensaje',
        type: 'info',
      }
      const result = await controller.create(dto)
      expect(mockService.create).toHaveBeenCalledWith(dto)
      expect(result).toBeDefined()
    })
  })

  describe('findAll', () => {
    it('retorna las notificaciones del usuario autenticado', async () => {
      const req = makeReq()
      const result = await controller.findAll(req as never)
      expect(mockService.findByUser).toHaveBeenCalledWith(userId)
      expect(result).toEqual([])
    })

    it('lanza UnauthorizedException si no se puede identificar el usuario', () => {
      const req = { user: {} }
      expect(() => controller.findAll(req as never)).toThrow(
        UnauthorizedException
      )
    })
  })

  describe('getUnreadCount', () => {
    it('retorna el conteo de no leidas envuelto en objeto', async () => {
      const req = makeReq()
      const result = await controller.getUnreadCount(req as never)
      expect(mockService.getUnreadCount).toHaveBeenCalledWith(userId)
      expect(result).toEqual({ count: 3 })
    })
  })

  describe('findOne', () => {
    it('retorna la notificacion por id del usuario autenticado', async () => {
      const req = makeReq()
      const result = await controller.findOne(notifId, req as never)
      expect(mockService.findOne).toHaveBeenCalledWith(notifId, userId)
      expect(result).toBeDefined()
    })
  })

  describe('markAllAsRead', () => {
    it('marca todas las notificaciones del usuario como leidas', async () => {
      const req = makeReq()
      const result = await controller.markAllAsRead(req as never)
      expect(mockService.markAllAsRead).toHaveBeenCalledWith(userId)
      expect(result).toEqual({ modifiedCount: 2 })
    })
  })

  describe('markAsRead', () => {
    it('marca una notificacion especifica como leida', async () => {
      const req = makeReq()
      const result = await controller.markAsRead(notifId, req as never)
      expect(mockService.markAsRead).toHaveBeenCalledWith(notifId, userId)
      expect(result).toBeDefined()
    })
  })

  describe('extractUserId (via req.user.sub)', () => {
    it('acepta userId desde req.user.sub', async () => {
      const req = { user: { sub: userId } }
      await controller.findAll(req as never)
      expect(mockService.findByUser).toHaveBeenCalledWith(userId)
    })
  })
})
