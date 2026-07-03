import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { NotFoundException } from '@nestjs/common'
import { Types } from 'mongoose'
import { SunatConfigService } from './sunat-config.service'
import { SunatConfig } from './entities/sunat-config.entity'

const clientId = new Types.ObjectId().toHexString()
const configId = new Types.ObjectId().toHexString()

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    _id: configId,
    clientId,
    clientIdSunat: 'CLIENT-SUNAT-123',
    clientSecret: 'SECRET-456',
    isActive: true,
    ...overrides,
  }
}

describe('SunatConfigService', () => {
  let service: SunatConfigService
  let mockModel: any
  let MockSunatConfigModel: jest.Mock

  beforeEach(async () => {
    jest.clearAllMocks()

    const savedConfig = makeConfig()
    savedConfig['save'] = jest.fn().mockResolvedValue(savedConfig)
    MockSunatConfigModel = jest.fn().mockImplementation(() => savedConfig)

    mockModel = Object.assign(MockSunatConfigModel, {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findOneAndDelete: jest.fn(),
    })

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SunatConfigService,
        { provide: getModelToken(SunatConfig.name), useValue: mockModel },
      ],
    }).compile()

    service = module.get<SunatConfigService>(SunatConfigService)
  })

  describe('create', () => {
    it('lanza error si ya existe configuracion para el clientId', async () => {
      mockModel.findOne.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(makeConfig()),
      })
      await expect(
        service.create({
          clientId,
          clientIdSunat: 'C',
          clientSecret: 'S',
        } as any)
      ).rejects.toThrow('Ya existe configuración SUNAT para esta empresa')
    })

    it('crea la configuracion si no existe', async () => {
      mockModel.findOne.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      })
      const result = await service.create({
        clientId,
        clientIdSunat: 'C',
        clientSecret: 'S',
      } as any)
      expect(MockSunatConfigModel).toHaveBeenCalledWith(
        expect.objectContaining({ clientId })
      )
      expect(result).toBeDefined()
    })
  })

  describe('findOne', () => {
    it('retorna la configuracion si existe', async () => {
      const config = makeConfig()
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(config),
      })
      const result = await service.findOne(clientId)
      expect(result).toEqual(config)
    })

    it('retorna null si no existe', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      })
      const result = await service.findOne(clientId)
      expect(result).toBeNull()
    })
  })

  describe('update', () => {
    it('actualiza la configuracion y retorna el documento actualizado', async () => {
      const updated = makeConfig({ clientIdSunat: 'NEW-CLIENT' })
      mockModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updated),
      })
      const result = await service.update(configId, {
        clientIdSunat: 'NEW-CLIENT',
      } as any)
      expect(result).toEqual(updated)
    })

    it('lanza NotFoundException si no existe la configuracion', async () => {
      mockModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      })
      await expect(service.update(configId, {} as any)).rejects.toThrow(
        NotFoundException
      )
    })
  })

  describe('remove', () => {
    it('elimina la configuracion y la retorna', async () => {
      const config = makeConfig()
      mockModel.findOneAndDelete.mockReturnValue({
        exec: jest.fn().mockResolvedValue(config),
      })
      const result = await service.remove(configId)
      expect(result).toEqual(config)
    })

    it('lanza NotFoundException si no existe', async () => {
      mockModel.findOneAndDelete.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      })
      await expect(service.remove(configId)).rejects.toThrow(NotFoundException)
    })
  })

  describe('getActiveCredentials', () => {
    it('retorna clientId y clientSecret de la configuracion activa', async () => {
      const config = makeConfig()
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(config),
      })
      const result = await service.getActiveCredentials(clientId)
      expect(result).toEqual({
        clientId: 'CLIENT-SUNAT-123',
        clientSecret: 'SECRET-456',
      })
    })

    it('lanza NotFoundException si no hay credenciales activas', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      })
      await expect(service.getActiveCredentials(clientId)).rejects.toThrow(
        NotFoundException
      )
    })
  })

  describe('getCredentials', () => {
    it('retorna _id, clientId y clientSecret', async () => {
      const config = makeConfig()
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(config),
      })
      const result = await service.getCredentials(clientId)
      expect(result).toEqual({
        _id: configId,
        clientId: 'CLIENT-SUNAT-123',
        clientSecret: 'SECRET-456',
      })
    })

    it('lanza NotFoundException si no existe', async () => {
      mockModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      })
      await expect(service.getCredentials(clientId)).rejects.toThrow(
        NotFoundException
      )
    })
  })
})
