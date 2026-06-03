import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { CategoryGroup, CategoryGroupDocument } from './entities/category-group.entity'
import { CreateCategoryGroupDto } from './dto/create-category-group.dto'
import { UpdateCategoryGroupDto } from './dto/update-category-group.dto'

@Injectable()
export class CategoryGroupService {
  private readonly logger = new Logger(CategoryGroupService.name)

  constructor(
    @InjectModel(CategoryGroup.name)
    private groupModel: Model<CategoryGroupDocument>
  ) {}

  async create(dto: CreateCategoryGroupDto): Promise<CategoryGroupDocument> {
    const clientIdObject = new Types.ObjectId(dto.clientId)
    try {
      const group = new this.groupModel({
        name: dto.name,
        description: dto.description,
        clientId: clientIdObject,
        categoryIds: (dto.categoryIds || []).map((id) => new Types.ObjectId(id)),
      })
      return await group.save()
    } catch (error) {
      this.logger.error(`Error al crear grupo: ${error.message}`, error.stack)
      throw error
    }
  }

  async findAll(clientId: string): Promise<CategoryGroupDocument[]> {
    const clientIdObject = new Types.ObjectId(clientId)
    try {
      return await this.groupModel.find({ clientId: clientIdObject }).exec()
    } catch (error) {
      this.logger.error(`Error al obtener grupos: ${error.message}`, error.stack)
      throw error
    }
  }

  async findOne(id: string, clientId: string): Promise<CategoryGroupDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`ID de grupo inválido: ${id}`)
    }
    const clientIdObject = new Types.ObjectId(clientId)
    try {
      const group = await this.groupModel.findOne({ _id: id, clientId: clientIdObject }).exec()
      if (!group) throw new NotFoundException(`Grupo con ID ${id} no encontrado`)
      return group
    } catch (error) {
      this.logger.error(`Error al obtener grupo: ${error.message}`, error.stack)
      throw error
    }
  }

  async update(
    id: string,
    dto: UpdateCategoryGroupDto,
    clientId: string
  ): Promise<CategoryGroupDocument> {
    const clientIdObject = new Types.ObjectId(clientId)
    try {
      const updateData: Record<string, unknown> = {}
      if (dto.name !== undefined) updateData.name = dto.name
      if (dto.description !== undefined) updateData.description = dto.description
      if (dto.categoryIds !== undefined) {
        updateData.categoryIds = dto.categoryIds.map((id) => new Types.ObjectId(id))
      }

      const updated = await this.groupModel
        .findOneAndUpdate({ _id: id, clientId: clientIdObject }, updateData, { new: true })
        .exec()

      if (!updated) throw new NotFoundException(`Grupo con ID ${id} no encontrado`)
      return updated
    } catch (error) {
      this.logger.error(`Error al actualizar grupo: ${error.message}`, error.stack)
      throw error
    }
  }

  async remove(id: string, clientId: string): Promise<void> {
    const clientIdObject = new Types.ObjectId(clientId)
    try {
      const result = await this.groupModel
        .findOneAndDelete({ _id: id, clientId: clientIdObject })
        .exec()
      if (!result) throw new NotFoundException(`Grupo con ID ${id} no encontrado`)
    } catch (error) {
      this.logger.error(`Error al eliminar grupo: ${error.message}`, error.stack)
      throw error
    }
  }
}
