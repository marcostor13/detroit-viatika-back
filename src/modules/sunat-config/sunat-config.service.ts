import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { ClientSession, Model } from 'mongoose'
import {
  SunatConfig,
  SunatConfigDocument,
} from './entities/sunat-config.entity'
import { CreateSunatConfigDto } from './dto/create-sunat-config.dto'
import { UpdateSunatConfigDto } from './dto/update-sunat-config.dto'

@Injectable()
export class SunatConfigService {
  private readonly logger = new Logger(SunatConfigService.name)

  constructor(
    @InjectModel(SunatConfig.name)
    private sunatConfigModel: Model<SunatConfigDocument>
  ) {}

  async create(
    createSunatConfigDto: CreateSunatConfigDto,
    session?: ClientSession
  ) {
    try {
      const query = this.sunatConfigModel.findOne({
        clientId: createSunatConfigDto.clientId,
      })
      if (session) {
        query.session(session)
      }
      const existingConfig = await query.exec()
      if (existingConfig) {
        throw new Error('Ya existe configuración SUNAT para esta empresa')
      }
      const sunatConfig = new this.sunatConfigModel({
        ...createSunatConfigDto,
      })
      const result = await sunatConfig.save(session ? { session } : undefined)
      return result
    } catch (error) {
      throw error
    }
  }

  async findOne(clientId: string) {
    const config = await this.sunatConfigModel.findOne({ clientId }).exec()
    return config ?? null
  }

  async update(_id: string, updateSunatConfigDto: UpdateSunatConfigDto) {
    try {
      const config = await this.sunatConfigModel
        .findOneAndUpdate(
          { _id },
          { $set: updateSunatConfigDto },
          { new: true }
        )
        .exec()

      if (!config) {
        throw new NotFoundException('No se encontró configuración SUNAT')
      }
      return config
    } catch (error) {
      throw error
    }
  }

  async remove(_id: string) {
    try {
      const result = await this.sunatConfigModel
        .findOneAndDelete({ _id })
        .exec()
      if (!result) {
        throw new NotFoundException('No se encontró configuración SUNAT')
      }
      return result
    } catch (error) {
      throw new NotFoundException('Error al eliminar configuración SUNAT')
    }
  }

  async getActiveCredentials(clientId: string) {
    try {
      const config = await this.sunatConfigModel
        .findOne({
          clientId,
          isActive: true,
        })
        .exec()

      if (!config) {
        throw new NotFoundException(
          'No se encontraron credenciales SUNAT activas'
        )
      }
      return {
        clientId: config.clientIdSunat,
        clientSecret: config.clientSecret,
      }
    } catch (error) {
      throw error
    }
  }

  async getCredentials(clientId: string) {
    try {
      const config = await this.sunatConfigModel
        .findOne({
          clientId,
        })
        .exec()

      if (!config) {
        throw new NotFoundException(
          'No se encontraron credenciales SUNAT activas'
        )
      }
      return {
        _id: config._id,
        clientId: config.clientIdSunat,
        clientSecret: config.clientSecret,
        ruc: config.ruc,
      }
    } catch (error) {
      throw error
    }
  }
}
