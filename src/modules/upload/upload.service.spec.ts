import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  PutObjectCommand: jest.fn().mockImplementation((args: unknown) => args),
  DeleteObjectCommand: jest.fn().mockImplementation((args: unknown) => args),
}))

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}))

import { S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { UploadService } from './upload.service'

type AnyMock = jest.Mock<any, any>

const CONFIG: Record<string, string> = {
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'test-key',
  AWS_SECRET_ACCESS_KEY: 'test-secret',
  AWS_S3_BUCKET_NAME: 'test-bucket',
}

describe('UploadService', () => {
  let service: UploadService
  let mockSend: jest.Mock

  beforeEach(async () => {
    jest.clearAllMocks()

    mockSend = jest.fn()
    ;(S3Client as unknown as AnyMock).mockImplementation(() => ({ send: mockSend }))
    ;(getSignedUrl as unknown as AnyMock).mockResolvedValue(
      'https://s3.presigned.url/test-bucket/123-file.jpg?sig=xxx',
    )

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => CONFIG[key] ?? ''),
            getOrThrow: jest.fn((key: string) => {
              const val = CONFIG[key]
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

  // ---------------------------------------------------------------------------
  // getPresignedUploadUrl
  // ---------------------------------------------------------------------------
  describe('getPresignedUploadUrl', () => {
    it('returns presignedUrl from getSignedUrl and builds fileUrl', async () => {
      const result = await service.getPresignedUploadUrl('photo.jpg', 'image/jpeg')

      expect(result.presignedUrl).toBe('https://s3.presigned.url/test-bucket/123-file.jpg?sig=xxx')
      expect(result.fileUrl).toMatch(/^https:\/\/test-bucket\.s3\.amazonaws\.com\/\d+-photo\.jpg$/)
    })

    it('calls getSignedUrl with expiresIn 300', async () => {
      await service.getPresignedUploadUrl('file.pdf', 'application/pdf')

      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 300 },
      )
    })

    it('passes Bucket, ContentType and timestamped Key to PutObjectCommand', async () => {
      const before = Date.now()
      await service.getPresignedUploadUrl('doc.pdf', 'application/pdf')
      const after = Date.now()

      // getSignedUrl receives: (s3Client, command, options)
      // command is the result of new PutObjectCommand(args) — our mock returns args directly
      const commandArg = (getSignedUrl as unknown as AnyMock).mock.calls[0][1] as any
      expect(commandArg.Bucket).toBe('test-bucket')
      expect(commandArg.ContentType).toBe('application/pdf')
      const ts = parseInt(commandArg.Key.split('-')[0], 10)
      expect(ts).toBeGreaterThanOrEqual(before)
      expect(ts).toBeLessThanOrEqual(after)
      expect(commandArg.Key).toMatch(/^\d+-doc\.pdf$/)
    })

    it('builds correct us-east-1 URL without region in subdomain', async () => {
      const result = await service.getPresignedUploadUrl('f.jpg', 'image/jpeg')
      expect(result.fileUrl).toMatch(/^https:\/\/test-bucket\.s3\.amazonaws\.com\//)
      expect(result.fileUrl).not.toContain('.s3.us-east-1.')
    })

    it('builds correct URL with region for non us-east-1', async () => {
      const module = await Test.createTestingModule({
        providers: [
          UploadService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => ({ ...CONFIG, AWS_REGION: 'us-west-2' }[key] ?? '')),
              getOrThrow: jest.fn((key: string) => {
                const val = { ...CONFIG, AWS_REGION: 'us-west-2' }[key]
                if (!val) throw new Error(`Config key ${key} not found`)
                return val
              }),
            },
          },
        ],
      }).compile()
      const svc = module.get<UploadService>(UploadService)

      const result = await svc.getPresignedUploadUrl('f.jpg', 'image/jpeg')
      expect(result.fileUrl).toContain('.s3.us-west-2.amazonaws.com/')
    })
  })

  // ---------------------------------------------------------------------------
  // uploadImage
  // ---------------------------------------------------------------------------
  describe('uploadImage', () => {
    it('sends PutObjectCommand and returns public URL', async () => {
      mockSend.mockResolvedValue({})
      const buf = Buffer.from('file-content')
      const file = { buffer: buf, mimetype: 'image/jpeg' } as Express.Multer.File

      const url = await service.uploadImage(file, 'folder/img.jpg')

      expect(url).toBe('https://test-bucket.s3.amazonaws.com/folder/img.jpg')
      expect(mockSend).toHaveBeenCalledTimes(1)
      const sentArgs = mockSend.mock.calls[0][0] as any
      expect(sentArgs.Bucket).toBe('test-bucket')
      expect(sentArgs.Key).toBe('folder/img.jpg')
      expect(sentArgs.Body).toBe(buf)
      expect(sentArgs.ContentType).toBe('image/jpeg')
    })

    it('throws wrapped error when S3 send fails', async () => {
      mockSend.mockRejectedValue(new Error('network timeout'))
      const file = { buffer: Buffer.from('x'), mimetype: 'image/jpeg' } as Express.Multer.File

      await expect(service.uploadImage(file, 'k.jpg')).rejects.toThrow(
        'Error al subir el archivo a S3: network timeout',
      )
    })
  })

  // ---------------------------------------------------------------------------
  // deleteFile
  // ---------------------------------------------------------------------------
  describe('deleteFile', () => {
    it('sends DeleteObjectCommand with correct key and returns message', async () => {
      mockSend.mockResolvedValue({})

      const result = await service.deleteFile('uploads/my-file.jpg')

      expect(result.message).toContain('uploads/my-file.jpg')
      const sentArgs = mockSend.mock.calls[0][0] as any
      expect(sentArgs.Bucket).toBe('test-bucket')
      expect(sentArgs.Key).toBe('uploads/my-file.jpg')
    })

    it('throws wrapped error when S3 delete fails', async () => {
      mockSend.mockRejectedValue(new Error('access denied'))

      await expect(service.deleteFile('k.jpg')).rejects.toThrow(
        'Error al eliminar el archivo de S3: access denied',
      )
    })
  })
})
