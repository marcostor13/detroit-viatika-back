import { Test, TestingModule } from '@nestjs/testing'
import { HttpException, NotFoundException } from '@nestjs/common'
import { Types } from 'mongoose'
import { SunatConfigController } from './sunat-config.controller'
import { SunatConfigService } from './sunat-config.service'

const clientId = new Types.ObjectId().toHexString()
const configId = new Types.ObjectId().toHexString()

function makeConfig() {
  return { _id: configId, clientId, clientIdSunat: 'C', clientSecret: 'S', isActive: true }
}

const mockService = {
  create: jest.fn().mockResolvedValue(makeConfig()),
  findOne: jest.fn().mockResolvedValue(makeConfig()),
  update: jest.fn().mockResolvedValue(makeConfig()),
  remove: jest.fn().mockResolvedValue(makeConfig()),
  getActiveCredentials: jest.fn().mockResolvedValue({ clientId: 'C', clientSecret: 'S' }),
}

describe('SunatConfigController', () => {
  let controller: SunatConfigController

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SunatConfigController],
      providers: [
        { provide: SunatConfigService, useValue: mockService },
      ],
    }).compile()
    controller = module.get<SunatConfigController>(SunatConfigController)
  })

  describe('create', () => {
    it('crea la configuracion SUNAT', async () => {
      const dto: any = { clientId, clientIdSunat: 'C', clientSecret: 'S' }
      const result = await controller.create(dto)
      expect(mockService.create).toHaveBeenCalledWith(dto)
      expect(result).toBeDefined()
    })
  })

  describe('getCredentials', () => {
    it('retorna las credenciales activas de SUNAT', async () => {
      const result = await controller.getCredentials(clientId)
      expect(mockService.getActiveCredentials).toHaveBeenCalledWith(clientId)
      expect(result).toEqual({ clientId: 'C', clientSecret: 'S' })
    })

    it('lanza HttpException si el servicio falla', async () => {
      mockService.getActiveCredentials.mockRejectedValue(new NotFoundException('No encontrado'))
      await expect(controller.getCredentials(clientId)).rejects.toThrow(HttpException)
    })
  })

  describe('findOne', () => {
    it('retorna la configuracion por clientId', async () => {
      const result = await controller.findOne(clientId)
      expect(mockService.findOne).toHaveBeenCalledWith(clientId)
      expect(result).toBeDefined()
    })

    it('lanza HttpException si el servicio falla', async () => {
      mockService.findOne.mockRejectedValue(new NotFoundException('No encontrado'))
      await expect(controller.findOne(clientId)).rejects.toThrow(HttpException)
    })
  })

  describe('update', () => {
    it('actualiza la configuracion por id', async () => {
      const dto: any = { clientIdSunat: 'NUEVO' }
      const result = await controller.update(configId, dto)
      expect(mockService.update).toHaveBeenCalledWith(configId, dto)
      expect(result).toBeDefined()
    })

    it('lanza HttpException si el servicio falla', async () => {
      mockService.update.mockRejectedValue(new NotFoundException('No encontrado'))
      await expect(controller.update(configId, {} as any)).rejects.toThrow(HttpException)
    })
  })

  describe('remove', () => {
    it('elimina la configuracion por id', async () => {
      const result = await controller.remove(configId)
      expect(mockService.remove).toHaveBeenCalledWith(configId)
      expect(result).toBeDefined()
    })

    it('lanza HttpException si el servicio falla', async () => {
      mockService.remove.mockRejectedValue(new NotFoundException('No encontrado'))
      await expect(controller.remove(configId)).rejects.toThrow(HttpException)
    })
  })
})
