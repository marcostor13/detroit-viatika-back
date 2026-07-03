import {
  Controller,
  Post,
  Get,
  Query,
  UploadedFile,
  UseInterceptors,
  ParseFilePipe,
  MaxFileSizeValidator,
  BadRequestException,
  Delete,
  Param,
} from '@nestjs/common'
import { UploadService } from './upload.service'
import { FileInterceptor } from '@nestjs/platform-express'

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Get('presigned-url')
  async getPresignedUrl(
    @Query('filename') filename: string,
    @Query('contentType') contentType: string,
  ): Promise<{ presignedUrl: string; fileUrl: string }> {
    if (!filename || !contentType) {
      throw new BadRequestException('filename y contentType son requeridos')
    }
    return this.uploadService.getPresignedUploadUrl(filename, contentType)
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } })
  ) // 'file' debe coincidir con el nombre del campo en el FormData del frontend
  async uploadImage(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10MB max
        ],
        exceptionFactory: errors => {
          throw new BadRequestException(errors)
        },
      })
    )
    file: Express.Multer.File
  ): Promise<{ url: string }> {
    const fileName = `${Date.now()}-${file.originalname}`
    const fileUrl = await this.uploadService.uploadImage(file, fileName)
    return { url: fileUrl }
  }

  @Delete(':key')
  async deleteFile(@Param('key') key: string) {
    return this.uploadService.deleteFile(key)
  }
}
