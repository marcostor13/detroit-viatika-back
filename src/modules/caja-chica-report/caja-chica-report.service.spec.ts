import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { CajaChicaReportService } from './caja-chica-report.service'
import { CajaChicaReport } from './entities/caja-chica-report.entity'
import { ExpenseReport } from '../expense-report/entities/expense-report.entity'
import { Types } from 'mongoose'

const clientId = new Types.ObjectId().toHexString()
const userId = new Types.ObjectId().toHexString()
const reportId = new Types.ObjectId().toHexString()
const expReportId = new Types.ObjectId().toHexString()

const mockCountersCollection = {
  findOneAndUpdate: jest.fn().mockResolvedValue({ seq: 1 }),
}

const mockDb = { collection: jest.fn().mockReturnValue(mockCountersCollection) }

const makeMockCajaChicaDoc = (overrides: any = {}) => ({
  _id: new Types.ObjectId(),
  codigo: 'CC-0001',
  title: 'Test Report',
  clientId: new Types.ObjectId(clientId),
  createdBy: new Types.ObjectId(userId),
  status: 'draft',
  selectedReports: [],
  totalAmount: 0,
  save: jest
    .fn()
    .mockResolvedValue({ _id: new Types.ObjectId(), ...overrides }),
  ...overrides,
})

const makeMockExpReport = (overrides: any = {}) => ({
  _id: new Types.ObjectId(expReportId),
  isCajaChica: true,
  clientId: new Types.ObjectId(clientId),
  userId: { _id: new Types.ObjectId(userId), name: 'Juan' },
  expenseIds: [{ total: '100' }, { total: '50' }],
  ...overrides,
})

describe('CajaChicaReportService', () => {
  let service: CajaChicaReportService
  let cajaChicaModel: any
  let expenseReportModel: any

  beforeEach(async () => {
    const mockCajaChicaModel: any = jest
      .fn()
      .mockImplementation((data: any) => ({
        ...data,
        save: jest
          .fn()
          .mockResolvedValue({ _id: new Types.ObjectId(), ...data }),
      }))
    mockCajaChicaModel.find = jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    })
    mockCajaChicaModel.findById = jest.fn()
    mockCajaChicaModel.updateOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    })
    mockCajaChicaModel.bulkWrite = jest
      .fn()
      .mockResolvedValue({ modifiedCount: 1 })
    mockCajaChicaModel.db = mockDb

    const mockExpenseReportModel: any = {}
    mockExpenseReportModel.findById = jest.fn()
    mockExpenseReportModel.find = jest.fn()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CajaChicaReportService,
        {
          provide: getModelToken(CajaChicaReport.name),
          useValue: mockCajaChicaModel,
        },
        {
          provide: getModelToken(ExpenseReport.name),
          useValue: mockExpenseReportModel,
        },
      ],
    }).compile()

    service = module.get<CajaChicaReportService>(CajaChicaReportService)
    cajaChicaModel = module.get(getModelToken(CajaChicaReport.name))
    expenseReportModel = module.get(getModelToken(ExpenseReport.name))
  })

  describe('create', () => {
    it('generates codigo and saves report', async () => {
      const dto = { title: 'Caja Chica Mayo' }
      const result = await service.create(dto, userId, clientId)
      expect(result).toBeDefined()
    })

    it('throws if no clientId', async () => {
      await expect(service.create({ title: 'x' }, userId, '')).rejects.toThrow(
        BadRequestException
      )
    })
  })

  describe('findAllByClient', () => {
    it('returns empty array when no reports', async () => {
      const result = await service.findAllByClient(clientId)
      expect(Array.isArray(result)).toBe(true)
    })

    it('recalculates and self-heals stale totals in the list', async () => {
      cajaChicaModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          {
            _id: new Types.ObjectId(reportId),
            codigo: 'CC-0001',
            title: 'Test',
            totalAmount: 0,
            selectedReports: [
              {
                expenseReportId: new Types.ObjectId(expReportId),
                colaboradorId: new Types.ObjectId(),
                colaboradorName: 'Juan',
              },
            ],
          },
        ]),
      })
      expenseReportModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([makeMockExpReport()]),
      })
      const result = await service.findAllByClient(clientId)
      expect(result[0].totalAmount).toBe(150)
      expect(cajaChicaModel.bulkWrite).toHaveBeenCalled()
    })
  })

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      cajaChicaModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      })
      await expect(service.findOne(reportId)).rejects.toThrow(NotFoundException)
    })

    it('returns enriched report with selectedReports', async () => {
      cajaChicaModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(reportId),
          codigo: 'CC-0001',
          title: 'Test',
          selectedReports: [],
          totalAmount: 0,
        }),
      })
      const result = await service.findOne(reportId)
      expect(result.selectedReports).toEqual([])
    })

    it('recalculates and self-heals a stale totalAmount on read', async () => {
      cajaChicaModel.findById.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(reportId),
          codigo: 'CC-0001',
          title: 'Test',
          totalAmount: 0,
          selectedReports: [
            {
              expenseReportId: new Types.ObjectId(expReportId),
              colaboradorId: new Types.ObjectId(),
              colaboradorName: 'Juan',
            },
          ],
        }),
      })
      expenseReportModel.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(makeMockExpReport()),
      })
      const result = await service.findOne(reportId)
      // makeMockExpReport totals: '100' + '50' = 150
      expect(result.totalAmount).toBe(150)
      expect(cajaChicaModel.updateOne).toHaveBeenCalledWith(
        { _id: reportId },
        { $set: { totalAmount: 150 } }
      )
    })
  })

  describe('addReports', () => {
    it('throws NotFoundException when caja chica report not found', async () => {
      cajaChicaModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      })
      await expect(
        service.addReports(reportId, [expReportId], clientId)
      ).rejects.toThrow(NotFoundException)
    })

    it('throws BadRequestException when adding to finalized report', async () => {
      const doc = makeMockCajaChicaDoc({ status: 'finalized' })
      cajaChicaModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(doc),
      })
      await expect(
        service.addReports(reportId, [expReportId], clientId)
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when expense report is not caja chica', async () => {
      const doc = makeMockCajaChicaDoc()
      cajaChicaModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(doc),
      })
      expenseReportModel.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest
          .fn()
          .mockResolvedValue(makeMockExpReport({ isCajaChica: false })),
      })
      await expect(
        service.addReports(reportId, [expReportId], clientId)
      ).rejects.toThrow(BadRequestException)
    })

    it('adds a valid caja chica expense report', async () => {
      const doc = makeMockCajaChicaDoc()
      cajaChicaModel.findById
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(doc) })
        .mockReturnValue({
          populate: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(makeMockExpReport()),
        })
      expenseReportModel.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(makeMockExpReport()),
      })
      const result = await service.addReports(reportId, [expReportId], clientId)
      expect(result).toBeDefined()
    })
  })

  describe('removeReport', () => {
    it('throws NotFoundException when report not found', async () => {
      cajaChicaModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      })
      await expect(service.removeReport(reportId, expReportId)).rejects.toThrow(
        NotFoundException
      )
    })

    it('removes the report and recalculates total', async () => {
      const doc = makeMockCajaChicaDoc({
        selectedReports: [
          {
            expenseReportId: new Types.ObjectId(expReportId),
            colaboradorId: new Types.ObjectId(),
            colaboradorName: 'Juan',
          },
        ],
      })
      cajaChicaModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(doc),
      })
      expenseReportModel.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(makeMockExpReport()),
      })
      const result = await service.removeReport(reportId, expReportId)
      expect(result).toBeDefined()
    })
  })

  describe('finalize', () => {
    it('throws NotFoundException when report not found', async () => {
      cajaChicaModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      })
      await expect(service.finalize(reportId)).rejects.toThrow(
        NotFoundException
      )
    })

    it('throws BadRequestException when already finalized', async () => {
      const doc = makeMockCajaChicaDoc({ status: 'finalized' })
      cajaChicaModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(doc),
      })
      await expect(service.finalize(reportId)).rejects.toThrow(
        BadRequestException
      )
    })

    it('throws BadRequestException when no selected reports', async () => {
      const doc = makeMockCajaChicaDoc({ selectedReports: [] })
      cajaChicaModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(doc),
      })
      await expect(service.finalize(reportId)).rejects.toThrow(
        BadRequestException
      )
    })

    it('finalizes a draft report with selected reports and recalculates total', async () => {
      const doc = makeMockCajaChicaDoc({
        selectedReports: [
          {
            expenseReportId: new Types.ObjectId(expReportId),
            colaboradorId: new Types.ObjectId(),
            colaboradorName: 'Juan',
          },
        ],
      })
      cajaChicaModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(doc),
      })
      expenseReportModel.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(makeMockExpReport()),
      })
      const result = await service.finalize(reportId)
      expect(result).toBeDefined()
      // total frozen from expense totals '100' + '50'
      expect(doc.totalAmount).toBe(150)
      expect(doc.status).toBe('finalized')
    })
  })
})
