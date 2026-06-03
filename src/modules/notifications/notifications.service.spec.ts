import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { Types } from 'mongoose'
import { NotificationsService } from './notifications.service'
import { Notification } from './entities/notification.entity'

const userId = new Types.ObjectId()
const notifId = new Types.ObjectId()

function makeNotif(overrides: Record<string, unknown> = {}) {
  return {
    _id: notifId,
    userId,
    title: 'Test',
    message: 'Test message',
    isRead: false,
    save: jest.fn().mockResolvedValue({ _id: notifId, userId, isRead: false }),
    ...overrides,
  }
}

describe('NotificationsService', () => {
  let service: NotificationsService
  let mockModel: any
  let MockNotificationModel: jest.Mock

  beforeEach(async () => {
    jest.clearAllMocks()

    const savedNotif = makeNotif()
    MockNotificationModel = jest.fn().mockImplementation(() => savedNotif)

    mockModel = Object.assign(MockNotificationModel, {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateMany: jest.fn(),
      countDocuments: jest.fn(),
    })

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getModelToken(Notification.name), useValue: mockModel },
      ],
    }).compile()

    service = module.get<NotificationsService>(NotificationsService)
  })

  describe('create', () => {
    it('crea una notificacion con userId normalizado', async () => {
      const result = await service.create({
        userId: userId.toString(),
        title: 'Test',
        message: 'Test message',
        type: 'info',
      } as any)
      expect(MockNotificationModel).toHaveBeenCalledWith(
        expect.objectContaining({ userId: expect.any(Types.ObjectId) })
      )
      expect(result).toBeDefined()
    })

    it('lanza error si el userId no es un ObjectId valido', async () => {
      await expect(
        service.create({ userId: 'invalid-id', title: 'T', message: 'M', type: 'info' } as any)
      ).rejects.toThrow()
    })
  })

  describe('findByUser', () => {
    it('retorna las notificaciones del usuario ordenadas por fecha', async () => {
      const notifs = [makeNotif()]
      const query = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(notifs) }
      mockModel.find.mockReturnValue(query)

      const result = await service.findByUser(userId.toString())

      expect(mockModel.find).toHaveBeenCalledWith({ userId: expect.any(Types.ObjectId) })
      expect(result).toEqual(notifs)
    })
  })

  describe('getUnreadCount', () => {
    it('retorna el conteo de notificaciones no leidas', async () => {
      mockModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(5) })

      const count = await service.getUnreadCount(userId.toString())

      expect(count).toBe(5)
      expect(mockModel.countDocuments).toHaveBeenCalledWith({
        userId: expect.any(Types.ObjectId),
        isRead: false,
      })
    })
  })

  describe('findOne', () => {
    it('retorna la notificacion por id y userId', async () => {
      const notif = makeNotif()
      mockModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(notif) })

      const result = await service.findOne(notifId.toString(), userId.toString())

      expect(mockModel.findOne).toHaveBeenCalledWith({
        _id: expect.any(Types.ObjectId),
        userId: expect.any(Types.ObjectId),
      })
      expect(result).toBeDefined()
    })

    it('retorna null si no existe la notificacion', async () => {
      mockModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) })

      const result = await service.findOne(notifId.toString(), userId.toString())

      expect(result).toBeNull()
    })
  })

  describe('markAsRead', () => {
    it('marca la notificacion como leida', async () => {
      const updated = makeNotif({ isRead: true })
      mockModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(updated) })

      const result = await service.markAsRead(notifId.toString(), userId.toString())

      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.any(Types.ObjectId), userId: expect.any(Types.ObjectId) }),
        { $set: { isRead: true } },
        { new: true }
      )
      expect(result?.isRead).toBe(true)
    })
  })

  describe('markAllAsRead', () => {
    it('marca todas las notificaciones del usuario como leidas', async () => {
      mockModel.updateMany.mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 3 }) })

      const result = await service.markAllAsRead(userId.toString())

      expect(result).toEqual({ modifiedCount: 3 })
      expect(mockModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: expect.any(Types.ObjectId), isRead: false }),
        { $set: { isRead: true } }
      )
    })
  })
})
