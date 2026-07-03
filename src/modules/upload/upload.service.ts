import { Injectable } from '@nestjs/common'
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class UploadService {
  private readonly s3Client: S3Client

  constructor(private readonly configService: ConfigService) {
    const region = this.getRegion()
    this.s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId: this.getSanitizedEnv('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.getSanitizedEnv('AWS_SECRET_ACCESS_KEY'),
      },
    })
  }

  private getSanitizedEnv(key: string): string {
    const raw = this.configService.getOrThrow<string>(key)
    return raw.trim().replace(/^['"]|['"]$/g, '')
  }

  private getRegion(): string {
    return this.getSanitizedEnv('AWS_REGION')
  }

  private isValidBucketName(name: string): boolean {
    if (!name) return false
    if (name.length < 3 || name.length > 63) return false
    if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) return false
    if (/\.\./.test(name)) return false
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(name)) return false // Evitar formato IP
    return true
  }

  private getBucketName(): string {
    const bucket = this.getSanitizedEnv('AWS_S3_BUCKET_NAME')
    if (!this.isValidBucketName(bucket)) {
      throw new Error(
        'AWS_S3_BUCKET_NAME inválido. Verifica que no tenga comillas, espacios o caracteres no permitidos.'
      )
    }
    return bucket
  }

  private encodeS3Key(key: string): string {
    return encodeURIComponent(key).replace(/%2F/g, '/')
  }

  private buildPublicUrl(bucket: string, key: string): string {
    const region = this.getRegion()
    const encodedKey = this.encodeS3Key(key)
    if (region === 'us-east-1') {
      return `https://${bucket}.s3.amazonaws.com/${encodedKey}`
    }
    return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`
  }

  async uploadImageBuffer(file: Buffer, key: string) {
    const bucketName = this.getBucketName()

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: file,
      ContentType: 'image/png',
    })

    try {
      await this.s3Client.send(command)
      return this.buildPublicUrl(bucketName, key)
    } catch (error) {
      throw new Error(`Error al subir el archivo a S3: ${error.message}`)
    }
  }

  async uploadImage(file: Express.Multer.File, key: string) {
    const bucketName = this.getBucketName()

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })

    try {
      await this.s3Client.send(command)
      return this.buildPublicUrl(bucketName, key)
    } catch (error) {
      throw new Error(`Error al subir el archivo a S3: ${error.message}`)
    }
  }

  async getPresignedUploadUrl(
    filename: string,
    contentType: string,
  ): Promise<{ presignedUrl: string; fileUrl: string }> {
    const bucketName = this.getBucketName()
    const key = `${Date.now()}-${filename}`

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
    })

    const presignedUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: 300,
    })

    return { presignedUrl, fileUrl: this.buildPublicUrl(bucketName, key) }
  }

  async deleteFile(key: string) {
    const bucketName = this.getBucketName()

    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    })

    try {
      await this.s3Client.send(command)
      return { message: `Archivo ${key} eliminado exitosamente.` }
    } catch (error) {
      throw new Error(`Error al eliminar el archivo de S3: ${error.message}`)
    }
  }
}
