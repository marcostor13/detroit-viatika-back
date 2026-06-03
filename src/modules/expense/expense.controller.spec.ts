import { Test, TestingModule } from '@nestjs/testing'
import { ExpenseController } from './expense.controller'
import { ExpenseService } from './expense.service'
import { AuditLogService } from '../audit-log/audit-log.service'

describe('ExpenseController', () => {
  let controller: ExpenseController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExpenseController],
      providers: [
        { provide: ExpenseService, useValue: {} },
        { provide: AuditLogService, useValue: {} },
      ],
    }).compile()
    controller = module.get<ExpenseController>(ExpenseController)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })
})
