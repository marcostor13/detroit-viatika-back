import { Test, TestingModule } from '@nestjs/testing'
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common'
import { Types } from 'mongoose'
import { ExpenseReportController } from './expense-report.controller'
import { ExpenseReportService } from './expense-report.service'
import { AuditLogService } from '../audit-log/audit-log.service'
import { ROLES } from '../auth/enums/roles.enum'

const reportId = new Types.ObjectId().toHexString()

describe('ExpenseReportController — Fase 6 (reembolsos / documentos)', () => {
  let controller: ExpenseReportController

  const mockExpenseReportService = {
    findPendingReimbursementsByClient: jest.fn().mockResolvedValue({ items: [] }),
    findMyDocuments: jest.fn().mockResolvedValue({ items: [] }),
    registerReimbursementPayment: jest.fn().mockResolvedValue({ _id: 'r1', status: 'reimbursed' }),
  }

  const mockAuditLogService = {
    log: jest.fn().mockResolvedValue(undefined),
  }

  const clientA = new Types.ObjectId().toHexString()
  const clientB = new Types.ObjectId().toHexString()
  const userSub = new Types.ObjectId().toHexString()

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExpenseReportController],
      providers: [
        { provide: ExpenseReportService, useValue: mockExpenseReportService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile()

    controller = module.get<ExpenseReportController>(ExpenseReportController)
  })

  describe('findPendingReimbursements', () => {
    it('rechaza si no tiene permiso de pago (ni superadmin ni canApproveL2)', () => {
      const req = {
        user: {
          roles: [ROLES.ADMIN],
          permissions: {},
          clientId: clientA,
        },
      }

      expect(() =>
        controller.findPendingReimbursements(clientA, req as never)
      ).toThrow(ForbiddenException)
      expect(
        mockExpenseReportService.findPendingReimbursementsByClient
      ).not.toHaveBeenCalled()
    })

    it('rechaza si clientId de URL no coincide con el del JWT (no superadmin)', () => {
      const req = {
        user: {
          roles: [ROLES.ADMIN],
          permissions: { canApproveL2: true },
          clientId: clientA,
        },
      }

      expect(() =>
        controller.findPendingReimbursements(clientB, req as never)
      ).toThrow(ForbiddenException)
      expect(
        mockExpenseReportService.findPendingReimbursementsByClient
      ).not.toHaveBeenCalled()
    })

    it('delega al servicio cuando clientId coincide y tiene canApproveL2', async () => {
      const req = {
        user: {
          roles: [ROLES.ADMIN],
          permissions: { canApproveL2: true },
          clientId: clientA,
        },
      }

      await controller.findPendingReimbursements(clientA, req as never)

      expect(
        mockExpenseReportService.findPendingReimbursementsByClient
      ).toHaveBeenCalledWith(clientA)
    })

    it('superadmin puede consultar cualquier clientId', async () => {
      const req = {
        user: {
          roles: [ROLES.SUPER_ADMIN],
          permissions: {},
          clientId: undefined,
        },
      }

      await controller.findPendingReimbursements(clientB, req as never)

      expect(
        mockExpenseReportService.findPendingReimbursementsByClient
      ).toHaveBeenCalledWith(clientB)
    })
  })

  describe('findMyDocuments', () => {
    it('BadRequest si clientId de sesión no es un ObjectId válido', () => {
      const req = {
        user: {
          _id: userSub,
          sub: userSub,
          clientId: '',
        },
      }

      expect(() => controller.findMyDocuments(req as never)).toThrow(
        BadRequestException
      )
      expect(mockExpenseReportService.findMyDocuments).not.toHaveBeenCalled()
    })

    it('delega al servicio con userId y clientId resueltos', async () => {
      const req = {
        user: {
          _id: userSub,
          clientId: clientA,
        },
      }

      await controller.findMyDocuments(req as never)

      expect(mockExpenseReportService.findMyDocuments).toHaveBeenCalledWith(
        userSub,
        clientA
      )
    })
  })

  describe('registerReimbursementPayment', () => {
    it('pasa tenantCtx derivado del JWT al servicio y registra auditoría', async () => {
      const dto = {
        method: 'transferencia_bancaria' as const,
        transferDate: '2025-02-01T00:00:00.000Z',
        paymentReceiptUrl: 'https://example.com/r.pdf',
      }
      const req = {
        user: {
          _id: userSub,
          sub: userSub,
          roles: [ROLES.ADMIN],
          role: ROLES.ADMIN,
          permissions: { canApproveL2: true },
          clientId: clientA,
          name: 'Tester',
          email: 't@test.com',
        },
      }

      await controller.registerReimbursementPayment(
        reportId,
        dto as never,
        req as never
      )

      expect(
        mockExpenseReportService.registerReimbursementPayment
      ).toHaveBeenCalledWith(
        reportId,
        dto,
        ROLES.ADMIN,
        { canApproveL2: true },
        {
          requestClientId: clientA,
          isSuperAdmin: false,
        }
      )
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'register_reimbursement_payment',
          entityId: reportId,
        })
      )
    })
  })
})
