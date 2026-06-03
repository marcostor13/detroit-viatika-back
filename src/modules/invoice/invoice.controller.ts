import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
  UseInterceptors,
  UploadedFile,
  HttpException,
  Res,
  UploadedFiles,
  Req,
  Put,
  Query,
} from '@nestjs/common'
import { InvoiceService } from './invoice.service'
import { CreateInvoiceDto, InvoiceStatus } from './dto/create-invoice.dto'
import { UpdateInvoiceDto } from './dto/update-invoice.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express'
import { Response } from 'express'
import { ROLES } from '../auth/enums/roles.enum'
import { Roles } from '../auth/decorators/roles.decorador'
import { AuditLogService } from '../audit-log/audit-log.service'

@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SUPER_ADMIN, ROLES.ADMIN)
export class InvoiceController {
  private readonly logger = new Logger(InvoiceController.name)

  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly auditLogService: AuditLogService
  ) {}

  @Get('token-sunat')
  getToken() {
    return this.invoiceService.generateTokenSunat()
  }

  @Post('validate-from-image')
  @UseInterceptors(
    FileInterceptor('invoiceImage', {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
      fileFilter: (req, file, callback) => {
        const allowedMimeTypes = [
          'image/jpeg',
          'image/png',
          'image/gif',
          'application/pdf',
          'application/xml',
          'text/xml',
        ]
        if (allowedMimeTypes.includes(file.mimetype)) {
          callback(null, true)
        } else {
          callback(new Error('Tipo de archivo no soportado'), false)
        }
      },
    })
  )
  async validateInvoice(@UploadedFile() file: Express.Multer.File) {
    this.logger.log(`Received file: ${file?.originalname}, size: ${file?.size}`)

    if (!file || !file.buffer) {
      this.logger.error('No file uploaded or file buffer is missing')
      throw new HttpException(
        'No se recibió ningún archivo o el archivo está corrupto.',
        HttpStatus.BAD_REQUEST
      )
    }

    try {
      const result = await this.invoiceService.validateInvoiceFromImage(
        file.buffer,
        file.mimetype
      )
      this.logger.log(
        `Validation result for ${file.originalname}: ${JSON.stringify(result)}`
      )
      return result
    } catch (error) {
      this.logger.error(
        `Error processing file ${file.originalname}: ${error.message}`,
        error.stack
      )
      if (error instanceof HttpException) {
        throw error
      }
      throw new HttpException(
        'Error procesando el archivo o validando la factura.',
        HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createInvoiceDto: CreateInvoiceDto, @Req() req: any) {
    const clientId = req.user.clientId
    const result = await this.invoiceService.create(createInvoiceDto, clientId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'create_invoice',
      module: 'invoices',
      entityId: result?._id?.toString(),
      clientId,
    })
    return result
  }

  @Get()
  findAll(@Req() req: any, @Query() query: any) {
    const clientId = req.user.clientId
    return this.invoiceService.findAll(clientId, query)
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    const clientId = req.user.clientId
    return this.invoiceService.findOne(id, clientId)
  }

  @Get('client/:client')
  findByClient(@Param('client') clientId: string) {
    return this.invoiceService.findByClient(clientId)
  }

  @Get('project/:project')
  findByProject(@Param('project') projectId: string) {
    return this.invoiceService.findByProject(projectId)
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id') id: string,
    @Body() updateInvoiceDto: UpdateInvoiceDto,
    @Req() req: any
  ) {
    const companyId = req.user.companyId
    return this.invoiceService.update(id, updateInvoiceDto, companyId)
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: InvoiceStatus; reason?: string },
    @Req() req: any
  ) {
    const companyId = req.user.companyId
    const result = await this.invoiceService.updateStatus(
      id,
      body.status,
      companyId,
      body.reason
    )
    const action =
      body.status === InvoiceStatus.APPROVED
        ? 'approve_invoice'
        : body.status === InvoiceStatus.REJECTED
          ? 'reject_invoice'
          : 'approve_invoice'
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action,
      module: 'invoices',
      entityId: id,
      details: body.reason,
      clientId: companyId,
    })
    return result
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Req() req: any) {
    const companyId = req.user.companyId
    const result = await this.invoiceService.remove(id, companyId)
    this.auditLogService.log({
      userId: req.user._id || req.user.sub,
      userName: req.user.name || req.user.email,
      action: 'delete_invoice',
      module: 'invoices',
      entityId: id,
      clientId: companyId,
    })
    return result
  }

  @Post(':id/acta-aceptacion')
  @UseInterceptors(
    FileInterceptor('actaAceptacion', {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
      fileFilter: (req, file, callback) => {
        const allowedMimeTypes = ['application/pdf']
        if (allowedMimeTypes.includes(file.mimetype)) {
          callback(null, true)
        } else {
          callback(new Error('Solo se permiten archivos PDF'), false)
        }
      },
    })
  )
  async uploadActaAceptacion(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File
  ) {
    if (!file) {
      throw new HttpException(
        'No se recibió ningún archivo',
        HttpStatus.BAD_REQUEST
      )
    }
    return this.invoiceService.uploadActaAceptacion(id, file.buffer)
  }

  @Get(':id/acta-aceptacion/download')
  async downloadActaAceptacion(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } =
      await this.invoiceService.downloadActaAceptacion(id)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename=${filename}`)
    res.send(buffer)
  }

  @Get(':id/pdf')
  async getInvoicePdf(
    @Param('id') id: string,
    @Req() req: any,
    @Res() res: Response
  ) {
    const companyId = req.user.companyId
    const invoice = await this.invoiceService.findOne(id, companyId)
    if (!invoice || !invoice.pdfFile) {
      throw new HttpException('Factura no encontrada', HttpStatus.NOT_FOUND)
    }
    const buffer = Buffer.from(invoice.pdfFile, 'base64')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `inline; filename=factura-${invoice.serie}-${invoice.correlativo}.pdf`
    )
    res.send(buffer)
  }

  @Post('upload')
  @UseInterceptors(FilesInterceptor('files', 2))
  async uploadInvoiceAndActa(
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: any
  ) {
    try {
      this.logger.debug('Iniciando subida de factura y acta')
      const result = await this.invoiceService.uploadInvoiceAndActa(
        files,
        req.user
      )
      this.logger.debug('Archivos subidos exitosamente')
      return {
        success: true,
        message: 'Archivos subidos exitosamente',
        data: result,
      }
    } catch (error) {
      this.logger.error('Error al subir archivos:', error)
      throw new HttpException(
        {
          message: 'Error al subir archivos',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  @Put(':id/reject')
  async rejectInvoice(
    @Param('id') id: string,
    @Body() body: { rejectionReason: string }
  ) {
    return this.invoiceService.rejectInvoice(id, body.rejectionReason)
  }

  @Put(':id/payment-status')
  async updatePaymentStatus(
    @Param('id') id: string,
    @Body() body: { status: 'APPROVED' | 'REJECTED'; rejectionReason?: string }
  ) {
    return this.invoiceService.updatePaymentStatus(
      id,
      body.status,
      body.rejectionReason
    )
  }
}
