import { BadRequestException, Injectable } from '@nestjs/common'
import { CreateClientDto } from './dto/create-client.dto'
import { UpdateClientDto } from './dto/update-client.dto'
import { Client, ClientDocument, ClientNotificationSettings } from './entities/client.entity'
import { ClientSession, Model } from 'mongoose'
import { InjectModel } from '@nestjs/mongoose'

@Injectable()
export class ClientService {
  constructor(
    @InjectModel(Client.name) private clientModel: Model<ClientDocument>
  ) {}

  private normalizeCodigo(codigo: string): string {
    return codigo.trim().toUpperCase()
  }

  private normalizeClientPayload<T extends CreateClientDto | UpdateClientDto>(
    dto: T
  ): T {
    return {
      ...dto,
      address: dto.address?.trim() ?? '',
      phone: dto.phone?.trim() ?? '',
      email: dto.email?.trim() ?? '',
      logo: dto.logo?.trim() ?? '',
    }
  }

  private buildDuplicateCodigoMessage(codigo: string): string {
    return `Ya existe una empresa con el código "${codigo}". Usa un código diferente.`
  }

  private async ensureUniqueCodigo(
    codigo: string,
    excludeClientId?: string
  ): Promise<void> {
    const filter: Record<string, unknown> = { codigo }
    if (excludeClientId) {
      filter['_id'] = { $ne: excludeClientId }
    }

    const existing = await this.clientModel.findOne(filter).exec()
    if (existing) {
      throw new BadRequestException(this.buildDuplicateCodigoMessage(codigo))
    }
  }

  private rethrowDuplicateCodigoError(error: unknown, codigo: string): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    ) {
      throw new BadRequestException(this.buildDuplicateCodigoMessage(codigo))
    }
    throw error
  }

  async create(createClientDto: CreateClientDto, session?: ClientSession) {
    const codigo = this.normalizeCodigo(createClientDto.codigo)
    await this.ensureUniqueCodigo(codigo)

    const payload = { ...this.normalizeClientPayload(createClientDto), codigo }
    console.log('[ClientService.create] payload:', JSON.stringify({ email: payload.email, phone: payload.phone, address: payload.address }))

    try {
      if (session) {
        const client = new this.clientModel(payload)
        return client.save({ session })
      }
      return this.clientModel.create(payload)
    } catch (error) {
      this.rethrowDuplicateCodigoError(error, codigo)
    }
  }

  findAll() {
    return this.clientModel.find().exec()
  }

  findOne(id: string) {
    return this.clientModel.findById(id).exec()
  }

  async update(id: string, updateClientDto: UpdateClientDto) {
    const payload = this.normalizeClientPayload({ ...updateClientDto })
    console.log('[ClientService.update] payload:', JSON.stringify({ email: payload.email, phone: payload.phone, address: payload.address }))

    if (payload.codigo !== undefined) {
      const codigo = this.normalizeCodigo(payload.codigo)
      await this.ensureUniqueCodigo(codigo, id)
      payload.codigo = codigo
    }

    try {
      return await this.clientModel
        .findByIdAndUpdate(id, payload, { new: true })
        .exec()
    } catch (error) {
      if (payload.codigo) {
        this.rethrowDuplicateCodigoError(error, payload.codigo)
      }
      throw error
    }
  }

  remove(id: string) {
    return this.clientModel.findByIdAndDelete(id).exec()
  }

  updateNotificationSettings(id: string, settings: ClientNotificationSettings) {
    return this.clientModel
      .findByIdAndUpdate(id, { notificationSettings: settings }, { new: true })
      .exec()
  }
}
