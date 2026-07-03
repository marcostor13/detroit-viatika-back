import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import {
  CategoryGroup,
  CategoryGroupDocument,
} from './entities/category-group.entity'
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
        categoryIds: (dto.categoryIds || []).map(id => new Types.ObjectId(id)),
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
      this.logger.error(
        `Error al obtener grupos: ${error.message}`,
        error.stack
      )
      throw error
    }
  }

  async findOne(id: string, clientId: string): Promise<CategoryGroupDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`ID de grupo inválido: ${id}`)
    }
    const clientIdObject = new Types.ObjectId(clientId)
    try {
      const group = await this.groupModel
        .findOne({ _id: id, clientId: clientIdObject })
        .exec()
      if (!group)
        throw new NotFoundException(`Grupo con ID ${id} no encontrado`)
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
      if (dto.description !== undefined)
        updateData.description = dto.description
      if (dto.categoryIds !== undefined) {
        updateData.categoryIds = dto.categoryIds.map(
          id => new Types.ObjectId(id)
        )
      }

      const updated = await this.groupModel
        .findOneAndUpdate({ _id: id, clientId: clientIdObject }, updateData, {
          new: true,
        })
        .exec()

      if (!updated)
        throw new NotFoundException(`Grupo con ID ${id} no encontrado`)
      return updated
    } catch (error) {
      this.logger.error(
        `Error al actualizar grupo: ${error.message}`,
        error.stack
      )
      throw error
    }
  }

  /** Agrega una categoría a un perfil por nombre (case-insensitive). Devuelve true si el perfil existe. */
  async addCategoryToGroupByName(
    categoryId: string,
    perfilName: string,
    clientId: string
  ): Promise<boolean> {
    const name = (perfilName || '').trim()
    if (!name) return false
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const group = await this.groupModel.findOne({
      clientId: new Types.ObjectId(clientId),
      name: new RegExp(`^${escaped}$`, 'i'),
    })
    if (!group) return false
    await this.groupModel.updateOne(
      { _id: group._id },
      { $addToSet: { categoryIds: new Types.ObjectId(categoryId) } }
    )
    return true
  }

  /** Perfiles por ids (scopeados al cliente). */
  async findByIds(
    ids: string[],
    clientId: string
  ): Promise<CategoryGroupDocument[]> {
    const valid = (ids || [])
      .filter(id => Types.ObjectId.isValid(id))
      .map(id => new Types.ObjectId(id))
    if (!valid.length) return []
    return this.groupModel
      .find({ _id: { $in: valid }, clientId: new Types.ObjectId(clientId) })
      .exec()
  }

  /** _ids (string) de los perfiles que contienen alguna de las categorías dadas. */
  async findIdsContainingAnyCategory(
    categoryIds: string[],
    clientId: string
  ): Promise<string[]> {
    const valid = (categoryIds || [])
      .filter(id => Types.ObjectId.isValid(id))
      .map(id => new Types.ObjectId(id))
    if (!valid.length) return []
    const groups = await this.groupModel
      .find(
        { clientId: new Types.ObjectId(clientId), categoryIds: { $in: valid } },
        { _id: 1 }
      )
      .exec()
    return groups.map(g => String(g._id))
  }

  /**
   * Sincroniza la pertenencia de una categoría a los perfiles indicados (M:N):
   * la agrega a los perfiles seleccionados y la quita de los demás.
   */
  async setCategoryMembership(
    categoryId: string,
    perfilIds: string[],
    clientId: string
  ): Promise<void> {
    const clientIdObject = new Types.ObjectId(clientId)
    const catObj = new Types.ObjectId(categoryId)
    const targetIds = (perfilIds || [])
      .filter(id => Types.ObjectId.isValid(id))
      .map(id => new Types.ObjectId(id))

    if (targetIds.length) {
      await this.groupModel
        .updateMany(
          { _id: { $in: targetIds }, clientId: clientIdObject },
          { $addToSet: { categoryIds: catObj } }
        )
        .exec()
    }
    await this.groupModel
      .updateMany(
        {
          clientId: clientIdObject,
          _id: { $nin: targetIds },
          categoryIds: catObj,
        },
        { $pull: { categoryIds: catObj } }
      )
      .exec()
  }

  async remove(id: string, clientId: string): Promise<void> {
    const clientIdObject = new Types.ObjectId(clientId)
    try {
      const result = await this.groupModel
        .findOneAndDelete({ _id: id, clientId: clientIdObject })
        .exec()
      if (!result)
        throw new NotFoundException(`Grupo con ID ${id} no encontrado`)
    } catch (error) {
      this.logger.error(
        `Error al eliminar grupo: ${error.message}`,
        error.stack
      )
      throw error
    }
  }
}
