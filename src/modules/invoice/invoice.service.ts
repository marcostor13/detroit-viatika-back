import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { CreateInvoiceDto, InvoiceStatus } from './dto/create-invoice.dto'
import { UpdateInvoiceDto } from './dto/update-invoice.dto'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Invoice } from './entities/invoice.entity'
import { HttpService } from '@nestjs/axios'
import * as Tesseract from 'tesseract.js'
import * as pdfParse from 'pdf-parse'
import * as fs from 'fs'
import * as path from 'path'
import { firstValueFrom } from 'rxjs'
import { EmailService } from '../email/email.service'
import { UserService } from '../user/user.service'

interface InvoiceData {
  rucEmisor?: string
  tipoComprobante?: string // Ej: '01' para Factura, '03' para Boleta
  serie?: string
  correlativo?: string
  fechaEmision?: string // Formato YYYY-MM-DD
  montoTotal?: number
  moneda?: string
  // Otros campos si son necesarios para la API de SUNAT
}

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name)
  private readonly tempDir = path.join(process.cwd(), 'temp')

  constructor(
    @InjectModel(Invoice.name)
    private invoiceModel: Model<Invoice>,
    private readonly httpService: HttpService,
    private readonly emailService: EmailService,
    private readonly userService: UserService
  ) {
    // Asegurarse de que el directorio temporal existe y tiene permisos
    try {
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true })
      }
      // Verificar permisos de escritura
      const testFile = path.join(this.tempDir, 'test.txt')
      fs.writeFileSync(testFile, 'test')
      fs.unlinkSync(testFile)
    } catch (error) {
      this.logger.error(
        `Error al configurar directorio temporal: ${error.message}`
      )
      throw new HttpException(
        'Error al configurar el directorio temporal. Verifique los permisos.',
        HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  async create(
    createInvoiceDto: CreateInvoiceDto,
    companyId: string
  ): Promise<Invoice> {
    // Extraer fecha de emisión como Date
    let fechaEmisionDate: Date | undefined = undefined
    if ('fechaEmision' in createInvoiceDto && createInvoiceDto.fechaEmision) {
      fechaEmisionDate = new Date(createInvoiceDto.fechaEmision as any)
    } else if ((createInvoiceDto as any).data) {
      // Si viene en data como string ("DD/MM/YYYY" o "DD-MM-YYYY")
      let dataObj: any = (createInvoiceDto as any).data
      if (typeof dataObj === 'string') {
        try {
          dataObj = JSON.parse(dataObj)
        } catch {}
      }
      if (dataObj && dataObj.fechaEmision) {
        const parts = dataObj.fechaEmision.split(/[\/\-]/)
        if (parts.length === 3) {
          // DD/MM/YYYY o DD-MM-YYYY
          fechaEmisionDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`)
        }
      }
    }
    const createdInvoice = new this.invoiceModel({
      ...createInvoiceDto,
      companyId,
      status: 'PENDING',
      fechaEmision: fechaEmisionDate,
    })
    return createdInvoice.save()
  }

  async findAll(companyId: string, filters: any = {}): Promise<Invoice[]> {
    const query: any = { companyId }
    if (filters.projectId) query.projectId = filters.projectId
    if (filters.categoryId) query.categoryId = filters.categoryId
    if (filters.status) query.status = filters.status
    if (filters.dateFrom || filters.dateTo) {
      query.fechaEmision = {}
      if (filters.dateFrom) query.fechaEmision.$gte = new Date(filters.dateFrom)
      if (filters.dateTo) query.fechaEmision.$lte = new Date(filters.dateTo)
    }
    if (filters.amountMin || filters.amountMax) {
      query.montoTotal = {}
      if (filters.amountMin) query.montoTotal.$gte = Number(filters.amountMin)
      if (filters.amountMax) query.montoTotal.$lte = Number(filters.amountMax)
    }
    return this.invoiceModel.find(query).populate('companyId').exec()
  }

  async findOne(id: string, companyId: string): Promise<Invoice> {
    const invoice = await this.invoiceModel
      .findOne({ _id: id, companyId })
      .populate('companyId')
      .exec()
    if (!invoice) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`)
    }
    return invoice
  }

  async findByClient(clientId: string): Promise<Invoice[]> {
    const invoices = await this.invoiceModel
      .find({ clientId })
      .populate('clientId')
      .populate('projectId')
      .exec()
    if (!invoices.length) {
      throw new NotFoundException(
        `No se encontraron facturas para el cliente con ID ${clientId}`
      )
    }
    return invoices
  }

  async findByProject(projectId: string): Promise<Invoice[]> {
    const invoices = await this.invoiceModel
      .find({ projectId })
      .populate('clientId')
      .populate('projectId')
      .exec()
    if (!invoices.length) {
      throw new NotFoundException(
        `No se encontraron facturas para el proyecto con ID ${projectId}`
      )
    }
    return invoices
  }

  async findByStatus(status: InvoiceStatus): Promise<Invoice[]> {
    return this.invoiceModel
      .find({ status })
      .populate('clientId')
      .populate('projectId')
      .exec()
  }

  async update(
    id: string,
    updateInvoiceDto: UpdateInvoiceDto,
    companyId: string
  ): Promise<Invoice> {
    const updatedInvoice = await this.invoiceModel
      .findOneAndUpdate({ _id: id, companyId }, updateInvoiceDto, { new: true })
      .populate('companyId')
      .exec()
    if (!updatedInvoice) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`)
    }
    return updatedInvoice
  }

  async updateStatus(
    id: string,
    status: InvoiceStatus,
    companyId: string,
    reason?: string
  ) {}

  async uploadActaAceptacion(id: string, fileBuffer: Buffer): Promise<Invoice> {
    const invoice = await this.invoiceModel.findById(id)
    if (!invoice) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`)
    }

    // Convertimos el buffer a base64 para almacenamiento seguro
    const base64File = fileBuffer.toString('base64')

    // Actualizamos la factura y retornamos el documento actualizado, garantizando el tipado correcto
    const updatedInvoice = await this.invoiceModel
      .findByIdAndUpdate(id, { actaAceptacion: base64File }, { new: true })
      .exec()

    if (!updatedInvoice) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`)
    }

    return updatedInvoice
  }

  async downloadActaAceptacion(
    id: string
  ): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = await this.invoiceModel.findById(id)
    if (!invoice) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`)
    }

    if (!invoice.actaAceptacion) {
      throw new NotFoundException(
        `No se encontró el acta de aceptación para la factura con ID ${id}`
      )
    }

    // Convertir base64 a buffer
    const buffer = Buffer.from(invoice.actaAceptacion, 'base64')
    const filename = `acta-aceptacion-${invoice.serie}-${invoice.correlativo}.pdf`

    return { buffer, filename }
  }

  async remove(id: string, companyId: string): Promise<void> {
    const result = await this.invoiceModel
      .findOneAndDelete({ _id: id, companyId })
      .exec()
    if (!result) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`)
    }
  }

  ////SUNAT

  async generateTokenSunat() {
    const api = `https://api-seguridad.sunat.gob.pe/v1/clientesextranet/${process.env.ID_SUNAT}/oauth2/token/`
    //x-www-form-urlencoded
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
    }

    const grant_type = 'client_credentials'
    const scope = 'https://api.sunat.gob.pe/v1/contribuyente/contribuyentes'
    const client_id = process.env.ID_SUNAT
    const client_secret = process.env.KEY_SUNAT

    const data = {
      grant_type: grant_type,
      scope: scope,
      client_id: client_id,
      client_secret: client_secret,
    }

    console.log(data)

    return { access_token: '1234567890' }
    // try {
    //   const response = await firstValueFrom(
    //     this.httpService.post(api, data, { headers })
    //   )
    //   return response.data
    // } catch (error) {
    //   // console.log(error)
    // }
  }

  async validateInvoiceFromImage(
    fileBuffer: Buffer,
    mimeType: string
  ): Promise<any> {
    this.logger.log('Starting file processing...')
    let extractedData: any
    let pdfBase64: string | undefined

    try {
      if (!fileBuffer || fileBuffer.length === 0) {
        throw new HttpException(
          'El archivo está vacío o no se pudo leer correctamente',
          HttpStatus.BAD_REQUEST
        )
      }

      if (mimeType === 'application/pdf') {
        pdfBase64 = fileBuffer.toString('base64')
      }

      if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
        this.logger.log(
          `Processing ${mimeType === 'application/pdf' ? 'PDF' : 'image'} with OCR...`
        )

        this.logger.debug(`File buffer length: ${fileBuffer.length}`)

        try {
          let text: string

          if (mimeType === 'application/pdf') {
            try {
              this.logger.debug('Extrayendo texto del PDF...')
              const pdfData = await pdfParse(fileBuffer)
              text = pdfData.text
              this.logger.debug(
                `Texto extraído del PDF: ${text.length} caracteres`
              )

              if (!text || text.trim().length === 0) {
                throw new Error('No se pudo extraer texto del PDF')
              }
            } catch (error) {
              this.logger.error(
                `Error al extraer texto del PDF: ${error.message}`
              )
              throw new HttpException(
                'Error al leer el PDF. Verifique que el archivo sea válido y contenga texto.',
                HttpStatus.BAD_REQUEST
              )
            }
          } else {
            // Para imágenes, usamos Tesseract como antes
            const worker = await Tesseract.createWorker('spa')
            const result = await worker.recognize(fileBuffer)
            await worker.terminate()
            text = result.data.text
          }

          if (!text || text.trim().length === 0) {
            this.logger.error('No se pudo extraer texto del archivo')
            throw new HttpException(
              'No se pudo extraer texto del archivo. Verifique que el archivo sea legible.',
              HttpStatus.BAD_REQUEST
            )
          }

          this.logger.debug(`Extracted text length: ${text.length}`)
          extractedData = this.extractDataFromText(text)

          if (!this.areEssentialDataPresent(extractedData)) {
            this.logger.warn('Essential data missing after extraction.')
            throw new HttpException(
              'No se pudieron extraer los datos necesarios del archivo. Verifique el formato.',
              HttpStatus.BAD_REQUEST
            )
          }
        } catch (error) {
          this.logger.error(`Error during processing: ${error.message}`)
          throw new HttpException(
            'Error al procesar el archivo. Verifique que el archivo sea legible.',
            HttpStatus.BAD_REQUEST
          )
        }
      } else if (mimeType === 'application/xml' || mimeType === 'text/xml') {
        // Procesamiento de XML
        this.logger.log('Processing XML file...')
        throw new HttpException(
          'Procesamiento de XML aún no implementado.',
          HttpStatus.NOT_IMPLEMENTED
        )
      }

      // Llamada al API de SUNAT solo si tenemos datos extraídos
      if (extractedData) {
        this.logger.log('Calling SUNAT validation service...', extractedData)
        const sunatApiUrl = `https://api.sunat.gob.pe/v1/contribuyente/contribuyentes/10450256451/validarcomprobante`
        const sunatToken = await this.generateTokenSunat()

        if (!sunatApiUrl || !sunatToken) {
          this.logger.error('SUNAT API configuration missing')
          throw new HttpException(
            'Configuración de SUNAT incompleta. Contacte al administrador.',
            HttpStatus.INTERNAL_SERVER_ERROR
          )
        }

        const params = {
          numRuc: extractedData.rucEmisor,
          codComp: extractedData.tipoComprobante,
          numeroSerie: extractedData.serie,
          numero: extractedData.correlativo,
          fechaEmision: extractedData.fechaEmision,
          monto: extractedData.montoTotal?.toFixed(2),
        }

        const headers = {
          Authorization: `Bearer ${sunatToken.access_token}`,
          'Content-Type': 'application/json',
        }

        this.logger.debug(
          `Requesting SUNAT: URL=${sunatApiUrl}, Params=${JSON.stringify(params)}`
        )

        try {
          const response = await firstValueFrom(
            this.httpService.post(sunatApiUrl, params, { headers })
          )

          this.logger.log(`SUNAT response status: ${response}`)

          const validationResult = this.interpretSunatResponse(response.data)

          // Crear la factura con el PDF si está disponible
          const createdInvoice = await this.create(
            {
              ...extractedData,
              state: validationResult.status,
              pdfFile: pdfBase64, // Guardar el PDF en base64
            },
            extractedData.companyId
          )

          return {
            message: 'Validación completada.',
            status: validationResult.status,
            details: validationResult.details,
            extractedData: extractedData,
            invoiceId: createdInvoice._id,
          }
        } catch (error) {
          console.log(error)
          this.logger.error(`SUNAT API Error: ${error}`, error.stack)
          throw new HttpException(
            'Error en la comunicación con SUNAT. Por favor, intente nuevamente más tarde.',
            HttpStatus.SERVICE_UNAVAILABLE
          )
        }
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }
      this.logger.error(`Processing failed: ${error.message}`, error.stack)
      throw new HttpException(
        'Error procesando el archivo. Por favor, intente nuevamente.',
        HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  // --- Funciones Auxiliares ---

  private extractDataFromText(text: string): InvoiceData {
    this.logger.log('Attempting data extraction using RegEx...')
    const data: InvoiceData = {}

    // RUC Emisor (Busca "RUC:" seguido de 11 dígitos)
    let match = text.match(/R\.?U\.?C\.?\s*:?\s*(\d{11})/i)
    if (match) data.rucEmisor = match[1]
    // Si no, intenta buscar solo 11 dígitos (menos preciso)
    if (!data.rucEmisor) {
      match = text.match(/(\b\d{11}\b)/)
      if (match) data.rucEmisor = match[1]
    }

    // Tipo de Comprobante, Serie y Correlativo
    // Intenta buscar diferentes formatos de serie y correlativo
    // Formato 1: E001-19220608417061
    match = text.match(/\b([A-Z]\d{3})\s*[-–—]\s*(\d{1,20})\b/i)
    if (match) {
      data.serie = match[1].toUpperCase()
      data.correlativo = match[2]
      // Determinar tipo basado en la letra inicial de la serie
      if (data.serie.startsWith('F'))
        data.tipoComprobante = '01' // Factura
      else if (data.serie.startsWith('B'))
        data.tipoComprobante = '03' // Boleta
      else if (data.serie.startsWith('E')) data.tipoComprobante = '01' // Factura Electrónica
    }

    // Fecha Emisión (Busca DD/MM/YYYY o DD-MM-YYYY)
    match = text.match(
      /Fecha\s*(?:de\s*)?Emisi[oó]n\s*:?\s*(\d{1,2})[\s\/-](\d{1,2})[\s\/-](\d{4})/i
    )
    if (!match) {
      // Intenta buscar la fecha sin el texto "Fecha Emisión" cerca
      match = text.match(/(\d{1,2})[\s\/-](\d{1,2})[\s\/-](\d{4})/)
    }
    if (match) {
      // Asegura formato YYYY-MM-DD para consistencia
      const day = match[1].padStart(2, '0')
      const month = match[2].padStart(2, '0')
      const year = match[3]
      if (
        parseInt(year) > 1990 &&
        parseInt(month) >= 1 &&
        parseInt(month) <= 12 &&
        parseInt(day) >= 1 &&
        parseInt(day) <= 31
      ) {
        data.fechaEmision = `${day}/${month}/${year}`
      }
    }

    // Monto Total (Busca variantes de "TOTAL" seguido de una moneda y un número con decimales)
    match = text.match(
      /(?:IMPORTE\s*TOTAL|SUMA\s*TOTAL|MONTO\s*TOTAL|VALOR\s*TOTAL)\s*:(?:(S\/|PEN|USD|\$)\s*)?\s*([\d,]+\.\d{2})\b/i
    )
    if (match) {
      // Limpia comas de miles y convierte a número
      const amountString = match[2].replace(/,/g, '')
      data.montoTotal = parseFloat(amountString)
      data.moneda = match[1] || 'S/' // Si no se encuentra moneda, asumimos PEN
    }

    this.logger.debug(`Extraction Results: ${JSON.stringify(data)}`)
    return data
  }

  private areEssentialDataPresent(data: InvoiceData): boolean {
    const requiredFields: (keyof InvoiceData)[] = [
      'rucEmisor',
      'tipoComprobante',
      'serie',
      'correlativo',
      'fechaEmision',
      'montoTotal',
    ]
    const missing = requiredFields.filter(
      field =>
        data[field] === undefined || data[field] === null || data[field] === ''
    )
    if (missing.length > 0) {
      this.logger.warn(`Missing essential fields: ${missing.join(', ')}`)
      return false
    }
    // Validación adicional simple (ej: RUC longitud)
    if (data.rucEmisor?.length !== 11) {
      this.logger.warn(`Invalid RUC length: ${data.rucEmisor}`)
      return false
    }
    return true
  }

  // Función para interpretar la respuesta específica de SUNAT
  private interpretSunatResponse(sunatData: any): {
    status: string
    details: any
    message: string
  } {
    this.logger.log('Interpreting SUNAT response...', sunatData)
    // --- ¡ESTO DEPENDE TOTALMENTE DE LA API DE SUNAT! ---
    // Analiza la estructura de 'sunatData' y determina el estado.
    // Ejemplo hipotético:
    if (sunatData.success === true && sunatData.data?.estadoCp === '0') {
      // '1' podría ser ACEPTADO
      return {
        status: 'VALIDO_ACEPTADO',
        details: sunatData.data,
        message: 'El comprobante es válido y fue facturado a esta empresa.',
      }
    } else if (sunatData.success === true && sunatData.data?.estadoCp === '1') {
      // '0' podría ser RECHAZADO o ANULADO
      return {
        status: 'VALIDO_NO_PERTENECE',
        details: sunatData.data,
        message:
          'El comprobante es válido, pero no fue facturado a esta empresa.',
      }
    } else if (sunatData.cod === '98') {
      // Código hipotético para "no encontrado"
      return {
        status: 'NO_ENCONTRADO',
        details: sunatData.msg || 'El comprobante no existe en SUNAT.',
        message: 'El comprobante no existe en SUNAT.',
      }
    } else {
      // Otros errores o casos
      this.logger.warn(
        `Uninterpretable SUNAT response: ${JSON.stringify(sunatData)}`
      )
      return {
        status: 'ERROR_SUNAT',
        details: sunatData,
        message: 'Error al validar el comprobante.',
      }
    }
  }

  async sendInvoiceUploadedNotification(
    email: string,
    invoiceNumber: string,
    providerName: string
  ) {
    try {
      this.logger.debug(`Enviando notificación de factura subida a ${email}`)
      await this.emailService.sendInvoiceNotification(email, {
        providerName,
        invoiceNumber,
        date: new Date().toISOString(),
        type: 'pdf',
      })
      this.logger.debug(
        `Notificación de factura subida enviada exitosamente a ${email}`
      )
      return { success: true, message: 'Notificación enviada exitosamente' }
    } catch (error) {
      this.logger.error(`Error al enviar notificación a ${email}:`, error)
      throw new HttpException(
        {
          message: 'Error al enviar notificación',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  async uploadInvoiceAndActa(files: Express.Multer.File[], user: any) {
    if (!files || files.length !== 2) {
      throw new HttpException(
        'Debe subir exactamente dos archivos: la factura y el acta de aceptación',
        HttpStatus.BAD_REQUEST
      )
    }

    try {
      // El primer archivo es la factura, el segundo es el acta
      const [invoiceFile, actaFile] = files

      // Validar la factura
      const validationResult = await this.validateInvoiceFromImage(
        invoiceFile.buffer,
        invoiceFile.mimetype
      )

      // Crear la factura
      const invoice = await this.create(
        {
          ...validationResult,
          status: 'PENDING',
        },
        validationResult.companyId
      )

      // Obtener usuarios con roles específicos para enviar notificaciones

      return {
        success: true,
        message: 'Archivos subidos exitosamente',
        data: invoice,
      }
    } catch (error) {
      this.logger.error(
        `Error al subir archivos: ${error.message}`,
        error.stack
      )
      throw error
    }
  }

  async sendActaUploadedNotification(
    email: string,
    invoiceNumber: string,
    providerName: string
  ) {
    try {
      this.logger.debug(`Enviando notificación de acta subida a ${email}`)
      await this.emailService.sendActaNotification(email, {
        providerName,
        invoiceNumber,
        date: new Date().toISOString(),
      })
      this.logger.debug(
        `Notificación de acta subida enviada exitosamente a ${email}`
      )
      return { success: true, message: 'Notificación enviada exitosamente' }
    } catch (error) {
      this.logger.error(`Error al enviar notificación a ${email}:`, error)
      throw new HttpException(
        {
          message: 'Error al enviar notificación',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      )
    }
  }

  async rejectInvoice(invoiceId: string, rejectionReason: string) {}

  async updatePaymentStatus(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    rejectionReason?: string
  ) {
    // try {
    //   this.logger.debug(
    //     `[DEBUG] Iniciando actualización de estado de pago de factura ${id} a ${status}`
    //   )
    //   const invoice = await this.invoiceModel.findById(id)
    //   if (!invoice) {
    //     this.logger.error(`Factura con ID ${id} no encontrada`)
    //     throw new NotFoundException(`Factura con ID ${id} no encontrada`)
    //   }
    //   invoice.paymentStatus = status
    //   if (status === 'REJECTED' && rejectionReason) {
    //     invoice.rejectionReason = rejectionReason
    //   }
    //   const updatedInvoice = await invoice.save()
    //   this.logger.debug(
    //     `[DEBUG] Estado de pago actualizado: ${JSON.stringify(
    //       {
    //         id: updatedInvoice._id,
    //         paymentStatus: updatedInvoice.paymentStatus,
    //         providerName: updatedInvoice.providerName,
    //         invoiceNumber: updatedInvoice.invoiceNumber,
    //         rejectionReason: updatedInvoice.rejectionReason,
    //       },
    //       null,
    //       2
    //     )}`
    //   )
    //   // Obtener todos los proveedores activos
    //   const providers = (
    //     await this.usersService.findAll(invoice.companyId)
    //   ).filter(u => u.role === UserRole.PROVIDER && u.isActive)
    //   // Enviar notificación a todos los proveedores
    //   for (const provider of providers) {
    //     try {
    //       await this.emailService.sendInvoiceDecisionNotification(
    //         provider.email,
    //         {
    //           providerName: updatedInvoice.rucEmisor,
    //           invoiceNumber: `${updatedInvoice.serie}-${updatedInvoice.correlativo}`,
    //           date: updatedInvoice.fechaEmision
    //             ? new Date(updatedInvoice.fechaEmision).toISOString()
    //             : '',
    //           type: updatedInvoice.tipoComprobante,
    //           status: status,
    //           rejectionReason:
    //             status === 'REJECTED' ? rejectionReason : undefined,
    //         }
    //       )
    //       this.logger.debug(
    //         `[DEBUG] Notificación enviada exitosamente a ${provider.email}`
    //       )
    //     } catch (error) {
    //       this.logger.error(
    //         `[DEBUG] Error al enviar notificación a ${provider.email}: ${error.message}`,
    //         error.stack
    //       )
    //     }
    //   }
    //   return updatedInvoice
    // } catch (error) {
    //   this.logger.error(
    //     `Error al actualizar estado de pago de factura ${id}: ${error.message}`
    //   )
    //   throw new HttpException(
    //     error.message,
    //     error.status || HttpStatus.INTERNAL_SERVER_ERROR
    //   )
    // }
  }
}
