import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { UploadService } from './upload.service'

describe('UploadService', () => {
  let service: UploadService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const env: Record<string, string> = {
                AWS_REGION: 'us-east-1',
                AWS_ACCESS_KEY_ID: 'test-key',
                AWS_SECRET_ACCESS_KEY: 'test-secret',
                AWS_S3_BUCKET_NAME: 'test-bucket',
              }
              return env[key] ?? ''
            }),
            getOrThrow: jest.fn((key: string) => {
              const env: Record<string, string> = {
                AWS_REGION: 'us-east-1',
                AWS_ACCESS_KEY_ID: 'test-key',
                AWS_SECRET_ACCESS_KEY: 'test-secret',
                AWS_S3_BUCKET_NAME: 'test-bucket',
              }
              const val = env[key]
              if (!val) throw new Error(`Config key ${key} not found`)
              return val
            }),
          },
        },
      ],
    }).compile()
    service = module.get<UploadService>(UploadService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })
})
