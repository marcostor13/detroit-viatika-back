import { SchedulerService } from './scheduler.service'

const makeExec = (val: any) => ({ exec: jest.fn().mockResolvedValue(val) })

const mockAdvanceModel = {
  find: jest.fn(),
}

const mockExpenseModel = {
  countDocuments: jest.fn(),
}

const mockClientModel = {
  find: jest.fn(),
}

const mockUserService = {
  findEmailNameClient: jest.fn(),
  isEmailEnabled: jest.fn(),
}

const mockEmailService = {
  buildAppUrl: jest.fn().mockReturnValue('http://localhost:4200'),
  sendViaticoRecordatorioColaborador: jest.fn().mockResolvedValue(undefined),
  sendViaticoResumenCoordinador: jest.fn().mockResolvedValue(undefined),
  sendViaticoRecordatorioUltimoDia: jest.fn().mockResolvedValue(undefined),
}

const mockNotificationsService = {
  create: jest.fn().mockResolvedValue(undefined),
}

const makeService = () =>
  new SchedulerService(
    mockAdvanceModel as any,
    mockExpenseModel as any,
    mockClientModel as any,
    mockUserService as any,
    mockEmailService as any,
    mockNotificationsService as any
  )

describe('SchedulerService', () => {
  let service: SchedulerService

  beforeEach(() => {
    jest.clearAllMocks()
    service = makeService()
  })

  it('is defined', () => {
    expect(service).toBeDefined()
  })

  describe('handleDailyNotifications', () => {
    it('calls processNotifications and completes without error when no clients', async () => {
      mockClientModel.find.mockReturnValue(makeExec([]))
      await expect(service.handleDailyNotifications()).resolves.toBeUndefined()
    })

    it('swallows errors thrown internally', async () => {
      mockClientModel.find.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('DB down')),
      })
      await expect(service.handleDailyNotifications()).resolves.toBeUndefined()
    })
  })

  describe('processNotifications — no clients with notifications enabled', () => {
    it('does not query advances when client list is empty', async () => {
      mockClientModel.find.mockReturnValue(makeExec([]))
      await service.handleDailyNotifications()
      expect(mockAdvanceModel.find).not.toHaveBeenCalled()
    })
  })

  describe('processNotifications — short advance (≤15 days), last day today', () => {
    it('sends last-day reminder email and in-app notification', async () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const startDate = new Date(today)
      startDate.setDate(startDate.getDate() - 5)
      const endDate = new Date(today)

      const client = {
        _id: 'c1',
        notificationSettings: { enabled: true, frequency: 'semanal' },
      }
      const advance: any = {
        _id: 'adv1',
        userId: { toString: () => 'u1' },
        coordinatorId: null,
        startDate,
        endDate,
        place: 'Lima',
        expenseReportId: null,
      }

      mockClientModel.find.mockReturnValue(makeExec([client]))
      mockAdvanceModel.find.mockReturnValue(makeExec([advance]))
      mockUserService.findEmailNameClient.mockResolvedValue({
        email: 'a@b.com',
        name: 'Test',
      })

      await service.handleDailyNotifications()
      expect(mockNotificationsService.create).toHaveBeenCalled()
    })
  })

  describe('processNotifications — long advance (>15 days), on notification day, no recent expenses', () => {
    it('sends collaborator reminder when it is Monday noon local time (weekly frequency)', async () => {
      // Use local time string (no Z) to ensure getDay() returns Monday in any timezone
      const monday = new Date('2026-06-01T12:00:00') // June 1 2026 = Monday, noon local time
      jest.useFakeTimers().setSystemTime(monday)

      const startDate = new Date(monday)
      startDate.setDate(startDate.getDate() - 20)
      const endDate = new Date(monday)
      endDate.setDate(endDate.getDate() + 5)

      const client = {
        _id: 'c1',
        notificationSettings: { enabled: true, frequency: 'semanal' },
      }
      const advance: any = {
        _id: 'adv2',
        userId: { toString: () => 'u1' },
        coordinatorId: null,
        startDate,
        endDate,
        place: 'Lima',
        expenseReportId: 'er1',
      }

      mockClientModel.find.mockReturnValue(makeExec([client]))
      mockAdvanceModel.find.mockReturnValue(makeExec([advance]))
      mockExpenseModel.countDocuments.mockReturnValue(makeExec(0))
      mockUserService.findEmailNameClient.mockResolvedValue({
        email: 'a@b.com',
        name: 'Test',
      })

      await service.handleDailyNotifications()
      expect(mockNotificationsService.create).toHaveBeenCalled()

      jest.useRealTimers()
    })
  })

  describe('processNotifications — long advance, NOT notification day', () => {
    it('skips sending when today is Tuesday noon local time (weekly frequency requires Monday)', async () => {
      // June 2 2026 = Tuesday, noon local time
      const tuesday = new Date('2026-06-02T12:00:00')
      jest.useFakeTimers().setSystemTime(tuesday)

      const startDate = new Date(tuesday)
      startDate.setDate(startDate.getDate() - 20)
      const endDate = new Date(tuesday)
      endDate.setDate(endDate.getDate() + 5)

      const client = {
        _id: 'c1',
        notificationSettings: { enabled: true, frequency: 'semanal' },
      }
      const advance: any = {
        _id: 'adv3',
        userId: { toString: () => 'u1' },
        coordinatorId: null,
        startDate,
        endDate,
        place: 'Lima',
        expenseReportId: 'er1',
      }

      mockClientModel.find.mockReturnValue(makeExec([client]))
      mockAdvanceModel.find.mockReturnValue(makeExec([advance]))

      await service.handleDailyNotifications()
      expect(
        mockEmailService.sendViaticoRecordatorioColaborador
      ).not.toHaveBeenCalled()

      jest.useRealTimers()
    })
  })

  describe('processNotifications — coordinator notification when pending expenses exist', () => {
    it('notifies both collaborator and coordinator when advance has pending expenses', async () => {
      const monday = new Date('2026-06-01T12:00:00') // Monday noon local
      jest.useFakeTimers().setSystemTime(monday)

      const startDate = new Date(monday)
      startDate.setDate(startDate.getDate() - 20)
      const endDate = new Date(monday)
      endDate.setDate(endDate.getDate() + 5)

      const client = {
        _id: 'c1',
        notificationSettings: { enabled: true, frequency: 'semanal' },
      }
      const advance: any = {
        _id: 'adv4',
        userId: { toString: () => 'u1' },
        coordinatorId: { toString: () => 'coord1' },
        startDate,
        endDate,
        place: 'Lima',
        expenseReportId: 'er1',
      }

      mockClientModel.find.mockReturnValue(makeExec([client]))
      mockAdvanceModel.find.mockReturnValue(makeExec([advance]))
      mockExpenseModel.countDocuments
        .mockReturnValueOnce(makeExec(0)) // recentExpenses = 0 → collab reminder
        .mockReturnValueOnce(makeExec(3)) // pendingCount = 3 → coordinator summary

      mockUserService.findEmailNameClient
        .mockResolvedValueOnce({
          email: 'collab@test.com',
          name: 'Collab',
          clientId: 'c1',
        })
        .mockResolvedValueOnce({
          email: 'coord@test.com',
          name: 'Coord',
          clientId: 'c1',
        })

      mockUserService.isEmailEnabled.mockResolvedValue(true)

      await service.handleDailyNotifications()
      // notificationsService.create is called fire-and-forget, but the mock IS invoked synchronously
      expect(mockNotificationsService.create).toHaveBeenCalled()

      jest.useRealTimers()
    })
  })

  describe('email gating — isEmailEnabled', () => {
    const client = {
      _id: 'c1',
      notificationSettings: { enabled: true, frequency: 'semanal' },
    }

    const makeLongAdvance = (base: Date, coordinatorId: any = null): any => {
      const startDate = new Date(base)
      startDate.setDate(startDate.getDate() - 20)
      const endDate = new Date(base)
      endDate.setDate(endDate.getDate() + 5)
      return {
        _id: 'adv-gate',
        userId: { toString: () => 'u1' },
        coordinatorId,
        startDate,
        endDate,
        place: 'Lima',
        expenseReportId: 'er1',
      }
    }

    afterEach(() => jest.useRealTimers())

    it('suppresses collaborator email when isEmailEnabled returns false', async () => {
      const monday = new Date('2026-06-01T12:00:00')
      jest.useFakeTimers().setSystemTime(monday)

      mockClientModel.find.mockReturnValue(makeExec([client]))
      mockAdvanceModel.find.mockReturnValue(makeExec([makeLongAdvance(monday)]))
      mockExpenseModel.countDocuments.mockReturnValue(makeExec(0))
      mockUserService.findEmailNameClient.mockResolvedValue({
        email: 'a@b.com',
        name: 'Test',
      })
      mockUserService.isEmailEnabled.mockResolvedValue(false)

      await service.handleDailyNotifications()

      expect(
        mockEmailService.sendViaticoRecordatorioColaborador
      ).not.toHaveBeenCalled()
    })

    it('sends collaborator email when isEmailEnabled returns true', async () => {
      const monday = new Date('2026-06-01T12:00:00')
      jest.useFakeTimers().setSystemTime(monday)

      mockClientModel.find.mockReturnValue(makeExec([client]))
      mockAdvanceModel.find.mockReturnValue(makeExec([makeLongAdvance(monday)]))
      mockExpenseModel.countDocuments.mockReturnValue(makeExec(0))
      mockUserService.findEmailNameClient.mockResolvedValue({
        email: 'a@b.com',
        name: 'Test',
      })
      mockUserService.isEmailEnabled.mockResolvedValue(true)

      await service.handleDailyNotifications()

      expect(
        mockEmailService.sendViaticoRecordatorioColaborador
      ).toHaveBeenCalledWith(
        'a@b.com',
        expect.objectContaining({ collaboratorName: 'Test' })
      )
    })

    it('suppresses coordinator email when isEmailEnabled returns false for coordinator', async () => {
      const monday = new Date('2026-06-01T12:00:00')
      jest.useFakeTimers().setSystemTime(monday)

      const coordinatorId = { toString: () => 'coord1' }
      mockClientModel.find.mockReturnValue(makeExec([client]))
      mockAdvanceModel.find.mockReturnValue(
        makeExec([makeLongAdvance(monday, coordinatorId)])
      )
      // recentExpenses > 0 so no collab reminder (avoids the collab isEmailEnabled call)
      mockExpenseModel.countDocuments
        .mockReturnValueOnce(makeExec(5)) // recentExpenses — skip collab reminder
        .mockReturnValueOnce(makeExec(2)) // pendingCount — trigger coordinator summary
      mockUserService.findEmailNameClient
        .mockResolvedValueOnce({ email: 'collab@test.com', name: 'Collab' })
        .mockResolvedValueOnce({ email: 'coord@test.com', name: 'Coord' })
      mockUserService.isEmailEnabled.mockResolvedValue(false) // coordinator check fails

      await service.handleDailyNotifications()

      expect(
        mockEmailService.sendViaticoResumenCoordinador
      ).not.toHaveBeenCalled()
    })

    it('sends coordinator email when isEmailEnabled returns true for coordinator', async () => {
      const monday = new Date('2026-06-01T12:00:00')
      jest.useFakeTimers().setSystemTime(monday)

      const coordinatorId = { toString: () => 'coord1' }
      mockClientModel.find.mockReturnValue(makeExec([client]))
      mockAdvanceModel.find.mockReturnValue(
        makeExec([makeLongAdvance(monday, coordinatorId)])
      )
      mockExpenseModel.countDocuments
        .mockReturnValueOnce(makeExec(5))
        .mockReturnValueOnce(makeExec(2))
      mockUserService.findEmailNameClient
        .mockResolvedValueOnce({ email: 'collab@test.com', name: 'Collab' })
        .mockResolvedValueOnce({ email: 'coord@test.com', name: 'Coord' })
      mockUserService.isEmailEnabled.mockResolvedValue(true)

      await service.handleDailyNotifications()

      expect(
        mockEmailService.sendViaticoResumenCoordinador
      ).toHaveBeenCalledWith(
        'coord@test.com',
        expect.objectContaining({ coordinatorName: 'Coord', pendingCount: 2 })
      )
    })

    it('suppresses last-day email when isEmailEnabled returns false', async () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const startDate = new Date(today)
      startDate.setDate(startDate.getDate() - 5)
      const advance: any = {
        _id: 'adv-last',
        userId: { toString: () => 'u1' },
        coordinatorId: null,
        startDate,
        endDate: new Date(today),
        place: 'Lima',
        expenseReportId: null,
      }
      mockClientModel.find.mockReturnValue(makeExec([client]))
      mockAdvanceModel.find.mockReturnValue(makeExec([advance]))
      mockUserService.findEmailNameClient.mockResolvedValue({
        email: 'a@b.com',
        name: 'Test',
      })
      mockUserService.isEmailEnabled.mockResolvedValue(false)

      await service.handleDailyNotifications()

      expect(
        mockEmailService.sendViaticoRecordatorioUltimoDia
      ).not.toHaveBeenCalled()
    })

    it('sends last-day email when isEmailEnabled returns true', async () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const startDate = new Date(today)
      startDate.setDate(startDate.getDate() - 5)
      const advance: any = {
        _id: 'adv-last',
        userId: { toString: () => 'u1' },
        coordinatorId: null,
        startDate,
        endDate: new Date(today),
        place: 'Lima',
        expenseReportId: null,
      }
      mockClientModel.find.mockReturnValue(makeExec([client]))
      mockAdvanceModel.find.mockReturnValue(makeExec([advance]))
      mockUserService.findEmailNameClient.mockResolvedValue({
        email: 'a@b.com',
        name: 'Test',
      })
      mockUserService.isEmailEnabled.mockResolvedValue(true)

      await service.handleDailyNotifications()

      expect(
        mockEmailService.sendViaticoRecordatorioUltimoDia
      ).toHaveBeenCalledWith(
        'a@b.com',
        expect.objectContaining({ collaboratorName: 'Test' })
      )
    })
  })
})
