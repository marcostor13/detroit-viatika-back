import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { UploadController } from './upload.controller'
import { UploadService } from './upload.service'

const mockUploadService = {
  getPresignedUploadUrl: jest.fn(),
  uploadImage: jest.fn(),
  deleteFile: jest.fn(),
}

describe('UploadController', () => {
  let controller: UploadController

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadController],
      providers: [{ provide: UploadService, useValue: mockUploadService }],
    }).compile()

    controller = module.get<UploadController>(UploadController)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('GET /upload/presigned-url', () => {
    it('returns presignedUrl and fileUrl from service', async () => {
      mockUploadService.getPresignedUploadUrl.mockResolvedValue({
        presignedUrl: 'https://s3/presigned',
        fileUrl: 'https://s3/file.jpg',
      })

      const result = await controller.getPresignedUrl('photo.jpg', 'image/jpeg')

      expect(result).toEqual({ presignedUrl: 'https://s3/presigned', fileUrl: 'https://s3/file.jpg' })
      expect(mockUploadService.getPresignedUploadUrl).toHaveBeenCalledWith('photo.jpg', 'image/jpeg')
    })

    it('throws BadRequestException when filename is empty', async () => {
      await expect(controller.getPresignedUrl('', 'image/jpeg')).rejects.toThrow(BadRequestException)
      expect(mockUploadService.getPresignedUploadUrl).not.toHaveBeenCalled()
    })

    it('throws BadRequestException when contentType is empty', async () => {
      await expect(controller.getPresignedUrl('file.jpg', '')).rejects.toThrow(BadRequestException)
      expect(mockUploadService.getPresignedUploadUrl).not.toHaveBeenCalled()
    })

    it('throws BadRequestException when both params are missing', async () => {
      await expect(controller.getPresignedUrl('', '')).rejects.toThrow(BadRequestException)
    })

    it('propagates error from service', async () => {
      mockUploadService.getPresignedUploadUrl.mockRejectedValue(new Error('S3 error'))
      await expect(controller.getPresignedUrl('f.jpg', 'image/jpeg')).rejects.toThrow('S3 error')
    })
  })

  describe('POST /upload', () => {
    it('uploads file and returns URL', async () => {
      mockUploadService.uploadImage.mockResolvedValue('https://s3/uploaded.jpg')
      const file = {
        originalname: 'image.jpg',
        buffer: Buffer.from('data'),
        mimetype: 'image/jpeg',
      } as Express.Multer.File

      const result = await controller.uploadImage(file)

      expect(result).toEqual({ url: 'https://s3/uploaded.jpg' })
      expect(mockUploadService.uploadImage).toHaveBeenCalledWith(
        file,
        expect.stringMatching(/^\d+-image\.jpg$/),
      )
    })

    it('propagates upload error from service', async () => {
      mockUploadService.uploadImage.mockRejectedValue(new Error('S3 upload failed'))
      const file = { originalname: 'f.jpg', buffer: Buffer.from('x'), mimetype: 'image/jpeg' } as Express.Multer.File

      await expect(controller.uploadImage(file)).rejects.toThrow('S3 upload failed')
    })
  })

  describe('DELETE /upload/:key', () => {
    it('deletes file by key', async () => {
      mockUploadService.deleteFile.mockResolvedValue({ message: 'Archivo my-file.jpg eliminado exitosamente.' })

      const result = await controller.deleteFile('my-file.jpg')

      expect(result.message).toContain('my-file.jpg')
      expect(mockUploadService.deleteFile).toHaveBeenCalledWith('my-file.jpg')
    })

    it('propagates error from service', async () => {
      mockUploadService.deleteFile.mockRejectedValue(new Error('not found'))

      await expect(controller.deleteFile('missing.jpg')).rejects.toThrow('not found')
    })
  })
})
