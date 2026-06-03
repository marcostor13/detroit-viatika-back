import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { ClientService } from './client.service'
import { Client } from './entities/client.entity'

describe('ClientService', () => {
  let service: ClientService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientService,
        { provide: getModelToken(Client.name), useValue: {} },
      ],
    }).compile()
    service = module.get<ClientService>(ClientService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })
})
