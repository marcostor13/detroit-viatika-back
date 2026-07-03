import { Test, TestingModule } from '@nestjs/testing'
import { ForbiddenException } from '@nestjs/common'
import { Types } from 'mongoose'
import { UserController } from './user.controller'
import { UserService } from './user.service'
import { AuditLogService } from '../audit-log/audit-log.service'
import { ROLES } from '../auth/enums/roles.enum'

const clientId = new Types.ObjectId()
const userId = new Types.ObjectId()
const otherClientId = new Types.ObjectId()

const makeReq = (overrides: Record<string, unknown> = {}) => ({
  user: {
    _id: userId.toString(),
    sub: userId.toString(),
    name: 'Admin',
    email: 'admin@test.com',
    clientId: clientId.toString(),
    roles: [ROLES.ADMIN],
    role: ROLES.ADMIN,
    ...overrides,
  },
})

const mockUserService = {
  findAllWithClient: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue({ _id: userId, email: 'user@test.com' }),
  findAllPaginated: jest.fn().mockResolvedValue({ data: [], total: 0 }),
  findAll: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue({ _id: userId }),
  update: jest.fn().mockResolvedValue({ _id: userId }),
  delete: jest.fn().mockResolvedValue({ deleted: true }),
  resetPassword: jest.fn().mockResolvedValue({ message: 'ok' }),
  bulkImportUsers: jest.fn().mockResolvedValue({
    created: 2,
    skipped: [],
    errors: [],
    credentials: [],
  }),
  changeOwnPassword: jest.fn().mockResolvedValue(undefined),
}

const mockAuditLogService = { log: jest.fn().mockResolvedValue(undefined) }

describe('UserController', () => {
  let controller: UserController

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: mockUserService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile()
    controller = module.get<UserController>(UserController)
  })

  describe('findAllWithClient', () => {
    it('retorna la lista de usuarios con su cliente', async () => {
      const result = await controller.findAllWithClient()
      expect(mockUserService.findAllWithClient).toHaveBeenCalled()
      expect(result).toEqual([])
    })
  })

  describe('create', () => {
    it('crea el usuario y registra auditoria', async () => {
      const dto: any = {
        email: 'nuevo@test.com',
        name: 'Nuevo',
        password: 'Pass123!',
      }
      const req = makeReq()
      const result = await controller.create(dto, req as never)
      expect(mockUserService.create).toHaveBeenCalledWith(dto)
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create_user', module: 'usuarios' })
      )
      expect(result).toBeDefined()
    })
  })

  describe('findAll', () => {
    it('permite a ADMIN consultar su propio clientId', async () => {
      const req = makeReq({
        roles: [ROLES.ADMIN],
        clientId: clientId.toString(),
      })
      await controller.findAll(
        clientId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        req as never
      )
      expect(mockUserService.findAll).toHaveBeenCalledWith(clientId)
    })

    it('lanza ForbiddenException si ADMIN intenta consultar otro clientId', async () => {
      const req = makeReq({
        roles: [ROLES.ADMIN],
        clientId: clientId.toString(),
      })
      await expect(
        controller.findAll(
          otherClientId,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          req as never
        )
      ).rejects.toThrow(ForbiddenException)
    })

    it('usa findAllPaginated cuando se pasan parametros de busqueda', async () => {
      const req = makeReq({
        roles: [ROLES.ADMIN],
        clientId: clientId.toString(),
      })
      await controller.findAll(
        clientId,
        '1',
        '20',
        'juan',
        'active',
        undefined,
        req as never
      )
      expect(mockUserService.findAllPaginated).toHaveBeenCalledWith(
        clientId,
        expect.objectContaining({
          page: 1,
          limit: 20,
          search: 'juan',
          status: 'active',
        })
      )
    })

    it('permite a SUPER_ADMIN consultar cualquier clientId', async () => {
      const req = makeReq({
        roles: [ROLES.SUPER_ADMIN],
        clientId: clientId.toString(),
      })
      await controller.findAll(
        otherClientId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        req as never
      )
      expect(mockUserService.findAll).toHaveBeenCalledWith(otherClientId)
    })
  })

  describe('findOne', () => {
    it('delega al servicio con el id resuelto', async () => {
      await controller.findOne(userId)
      expect(mockUserService.findOne).toHaveBeenCalledWith(userId.toString())
    })
  })

  describe('updateOwnProfile', () => {
    it('actualiza nombre y foto del propio perfil', async () => {
      const req = makeReq()
      const body = {
        name: 'Nuevo Nombre',
        profilePic: 'https://cdn.example.com/pic.jpg',
      }
      await controller.updateOwnProfile(body, req as never)
      expect(mockUserService.update).toHaveBeenCalledWith(userId.toString(), {
        name: 'Nuevo Nombre',
        profilePic: 'https://cdn.example.com/pic.jpg',
      })
    })

    it('omite nombre si esta vacio', async () => {
      const req = makeReq()
      await controller.updateOwnProfile(
        { name: '  ', profilePic: 'url' },
        req as never
      )
      expect(mockUserService.update).toHaveBeenCalledWith(userId.toString(), {
        profilePic: 'url',
      })
    })
  })

  describe('update', () => {
    it('actualiza el usuario por id', async () => {
      const dto: any = { name: 'Actualizado' }
      await controller.update(userId, dto)
      expect(mockUserService.update).toHaveBeenCalledWith(
        userId.toString(),
        dto
      )
    })
  })

  describe('updatePermissions', () => {
    it('actualiza permisos y registra auditoria', async () => {
      const req = makeReq()
      const dto: any = {
        modules: ['tesoreria'],
        canApproveL1: true,
        canApproveL2: false,
      }
      await controller.updatePermissions(userId, dto, req as never)
      expect(mockUserService.update).toHaveBeenCalledWith(userId.toString(), {
        permissions: dto,
      })
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'update_permissions' })
      )
    })
  })

  describe('delete', () => {
    it('elimina el usuario por id', async () => {
      await controller.delete(userId)
      expect(mockUserService.delete).toHaveBeenCalledWith(userId.toString())
    })
  })

  describe('resetPassword', () => {
    it('resetea la contrasena y registra auditoria', async () => {
      const req = makeReq()
      await controller.resetPassword(userId, req as never)
      expect(mockUserService.resetPassword).toHaveBeenCalledWith(
        userId.toString()
      )
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'reset_password' })
      )
    })
  })

  describe('downloadTemplate', () => {
    it('retorna el archivo base64 con nombre de plantilla', async () => {
      const req = makeReq()
      const result = await controller.downloadTemplate(req as never)
      expect(result).toHaveProperty('file')
      expect(result).toHaveProperty('filename', 'plantilla_usuarios.xlsx')
    })
  })

  describe('changeOwnPassword', () => {
    it('cambia la contrasena del usuario autenticado', async () => {
      const req = makeReq()
      const result = await controller.changeOwnPassword(
        { password: 'Nueva123!' },
        req as never
      )
      expect(mockUserService.changeOwnPassword).toHaveBeenCalledWith(
        userId.toString(),
        'Nueva123!'
      )
      expect(result).toEqual({
        message: 'Contraseña actualizada correctamente',
      })
    })
  })

  describe('updateSignature', () => {
    it('actualiza la firma digital y registra auditoria', async () => {
      const req = makeReq()
      await controller.updateSignature(
        { signature: 'base64-sig' },
        req as never
      )
      expect(mockUserService.update).toHaveBeenCalledWith(userId.toString(), {
        signature: 'base64-sig',
      })
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'update_signature' })
      )
    })
  })
})
