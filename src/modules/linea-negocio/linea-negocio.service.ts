import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import {
  LineaNegocio,
  LineaNegocioDocument,
} from './entities/linea-negocio.entity'
import { CreateLineaNegocioDto } from './dto/create-linea-negocio.dto'
import { UpdateLineaNegocioDto } from './dto/update-linea-negocio.dto'

@Injectable()
export class LineaNegocioService {
  constructor(
    @InjectModel(LineaNegocio.name)
    private lineaNegocioModel: Model<LineaNegocioDocument>
  ) {}

  private buildDuplicateCodeMessage(code: string): string {
    return `Ya existe una línea de negocio con el código "${code}". Usa un código diferente.`
  }

  private async ensureUniqueCode(
    code: string,
    clientId: Types.ObjectId,
    excludeId?: string
  ): Promise<void> {
    const filter: Record<string, unknown> = { code, clientId }
    if (excludeId) {
      filter['_id'] = { $ne: new Types.ObjectId(excludeId) }
    }
    const existing = await this.lineaNegocioModel.findOne(filter).exec()
    if (existing) {
      throw new BadRequestException(this.buildDuplicateCodeMessage(code))
    }
  }

  private rethrowDuplicateCodeError(error: unknown, code: string): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    ) {
      throw new BadRequestException(this.buildDuplicateCodeMessage(code))
    }
    throw error
  }

  async create(dto: CreateLineaNegocioDto, clientId: string) {
    const name = dto.name?.trim()
    const code = dto.code?.trim()
    if (!name) throw new BadRequestException('El nombre es obligatorio')
    if (!code) throw new BadRequestException('El código es obligatorio')

    const clientIdObject = new Types.ObjectId(clientId)
    await this.ensureUniqueCode(code, clientIdObject)

    try {
      return await this.lineaNegocioModel.create({
        name,
        code,
        isActive: dto.isActive ?? true,
        clientId: clientIdObject,
      })
    } catch (error) {
      this.rethrowDuplicateCodeError(error, code)
    }
  }

  async findAll(clientId: string) {
    const clientIdObject = new Types.ObjectId(clientId)
    return this.lineaNegocioModel
      .find({ clientId: clientIdObject })
      .sort({ name: 1 })
      .exec()
  }

  async findOne(id: string, clientId: string) {
    const linea = await this.lineaNegocioModel
      .findOne({
        _id: new Types.ObjectId(id),
        clientId: new Types.ObjectId(clientId),
      })
      .exec()
    if (!linea) {
      throw new NotFoundException('Línea de negocio no encontrada')
    }
    return linea
  }

  async update(id: string, dto: UpdateLineaNegocioDto, clientId: string) {
    const clientIdObject = new Types.ObjectId(clientId)
    const payload: UpdateLineaNegocioDto = { ...dto }
    delete payload.clientId

    if (typeof payload.name === 'string') {
      payload.name = payload.name.trim()
      if (!payload.name) delete payload.name
    }
    if (typeof payload.code === 'string') {
      payload.code = payload.code.trim()
      if (!payload.code) {
        delete payload.code
      } else {
        await this.ensureUniqueCode(payload.code, clientIdObject, id)
      }
    }

    let linea: LineaNegocioDocument | null
    try {
      linea = await this.lineaNegocioModel
        .findOneAndUpdate(
          { _id: new Types.ObjectId(id), clientId: clientIdObject },
          payload,
          { new: true }
        )
        .exec()
    } catch (error) {
      this.rethrowDuplicateCodeError(error, payload.code ?? dto.code ?? '')
    }

    if (!linea) {
      throw new NotFoundException('Línea de negocio no encontrada')
    }
    return linea
  }

  async remove(id: string, clientId: string) {
    const result = await this.lineaNegocioModel
      .findOneAndDelete({
        _id: new Types.ObjectId(id),
        clientId: new Types.ObjectId(clientId),
      })
      .exec()
    if (!result) {
      throw new NotFoundException('Línea de negocio no encontrada')
    }
    return result
  }
}
