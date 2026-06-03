import { Test, TestingModule } from '@nestjs/testing'
import { ClientController } from './client.controller'
import { ClientService } from './client.service'
import { ClientOnboardingService } from './client-onboarding.service'
import { UserService } from '../user/user.service'

describe('ClientController', () => {
  let controller: ClientController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientController],
      providers: [
        { provide: ClientService, useValue: {} },
        { provide: ClientOnboardingService, useValue: {} },
        { provide: UserService, useValue: {} },
      ],
    }).compile()

    controller = module.get<ClientController>(ClientController)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })
})
