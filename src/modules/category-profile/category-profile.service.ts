import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import {
  CategoryProfile,
  CategoryProfileDocument,
} from './entities/category-profile.entity'
import { CreateCategoryProfileDto } from './dto/create-category-profile.dto'
import { UpdateCategoryProfileDto } from './dto/update-category-profile.dto'

@Injectable()
export class CategoryProfileService {
  private readonly logger = new Logger(CategoryProfileService.name)

  constructor(
    @InjectModel(CategoryProfile.name)
    private readonly profileModel: Model<CategoryProfileDocument>
  ) {}

  private toObjectIds(ids?: string[]): Types.ObjectId[] {
    return (ids ?? [])
      .filter(id => Types.ObjectId.isValid(id))
      .map(id => new Types.ObjectId(id))
  }

  async create(
    dto: CreateCategoryProfileDto
  ): Promise<CategoryProfileDocument> {
    try {
      const profile = new this.profileModel({
        name: dto.name.trim(),
        description: dto.description?.trim() || undefined,
        categoryIds: this.toObjectIds(dto.categoryIds),
        clientId: new Types.ObjectId(dto.clientId),
      })
      return await profile.save()
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new BadRequestException(
          'Ya existe un perfil de categoría con ese nombre.'
        )
      }
      this.logger.error(`Error al crear perfil: ${error.message}`, error.stack)
      throw error
    }
  }

  async findAllByClient(clientId: string): Promise<CategoryProfileDocument[]> {
    return this.profileModel
      .find({ clientId: new Types.ObjectId(clientId) })
      .sort({ name: 1 })
      .exec()
  }

  async findOne(
    id: string,
    clientId: string
  ): Promise<CategoryProfileDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`ID de perfil inválido: ${id}`)
    }
    const profile = await this.profileModel
      .findOne({ _id: id, clientId: new Types.ObjectId(clientId) })
      .exec()
    if (!profile) {
      throw new NotFoundException(`Perfil con ID ${id} no encontrado`)
    }
    return profile
  }

  async update(
    id: string,
    dto: UpdateCategoryProfileDto,
    clientId: string
  ): Promise<CategoryProfileDocument> {
    const update: Record<string, unknown> = {}
    if (dto.name !== undefined) update.name = dto.name.trim()
    if (dto.description !== undefined) update.description = dto.description.trim()
    if (dto.categoryIds !== undefined)
      update.categoryIds = this.toObjectIds(dto.categoryIds)

    try {
      const updated = await this.profileModel
        .findOneAndUpdate(
          { _id: id, clientId: new Types.ObjectId(clientId) },
          { $set: update },
          { new: true }
        )
        .exec()
      if (!updated) {
        throw new NotFoundException(`Perfil con ID ${id} no encontrado`)
      }
      return updated
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new BadRequestException(
          'Ya existe un perfil de categoría con ese nombre.'
        )
      }
      throw error
    }
  }

  async remove(id: string, clientId: string): Promise<void> {
    const result = await this.profileModel
      .findOneAndDelete({ _id: id, clientId: new Types.ObjectId(clientId) })
      .exec()
    if (!result) {
      throw new NotFoundException(`Perfil con ID ${id} no encontrado`)
    }
  }
}
