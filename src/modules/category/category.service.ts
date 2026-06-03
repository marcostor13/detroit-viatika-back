import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Category, CategoryDocument } from './entities/category.entity'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'

export interface IPaginatedResult<T> {
  data: T[]
  total: number
  page: number
  pages: number
  limit: number
}

export interface ICategoryItem {
  _id: string
  name: string
  key: string
  description?: string
  cuenta?: string
  observaciones?: string
  isActive: boolean
  limit: number | null
  clientId: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export interface IBulkCreateResult {
  created: number
  errors: { row: number; reason: string }[]
}

@Injectable()
export class CategoryService {
  private readonly logger = new Logger(CategoryService.name)

  constructor(
    @InjectModel(Category.name)
    private categoryModel: Model<CategoryDocument>
  ) {}

  async create(createCategoryDto: CreateCategoryDto): Promise<CategoryDocument> {
    const clientIdObject = new Types.ObjectId(createCategoryDto.clientId)
    try {
      if (!createCategoryDto.key && createCategoryDto.name) {
        createCategoryDto.key = this.generateKey(createCategoryDto.name)
      }

      const newCategory = new this.categoryModel({
        ...createCategoryDto,
        clientId: clientIdObject,
      })
      return await newCategory.save()
    } catch (error) {
      this.logger.error(`Error al crear categoría: ${error.message}`, error.stack)
      throw error
    }
  }

  async findAll(
    clientId: string,
    options: { page?: number; limit?: number; search?: string } = {}
  ): Promise<IPaginatedResult<ICategoryItem>> {
    const clientIdObject = new Types.ObjectId(clientId)
    const page = options.page && options.page > 0 ? options.page : 1
    const limit = options.limit && options.limit > 0 ? options.limit : 20
    const skip = (page - 1) * limit

    try {
      const filter: Record<string, unknown> = { clientId: clientIdObject }

      if (options.search) {
        filter.name = { $regex: options.search, $options: 'i' }
      }

      const total = await this.categoryModel.countDocuments(filter).exec()
      const docs = await this.categoryModel.find(filter).skip(skip).limit(limit).exec()

      const data: ICategoryItem[] = docs.map((doc) => {
        const d = doc.toObject() as CategoryDocument & { _id: Types.ObjectId }
        return {
          _id: d._id.toString(),
          name: d.name,
          key: d.key,
          description: d.description,
          cuenta: d.cuenta,
          observaciones: d.observaciones,
          isActive: d.isActive,
          limit: d.limit ?? null,
          clientId: d.clientId,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        }
      })

      return { data, total, page, pages: Math.ceil(total / limit), limit }
    } catch (error) {
      this.logger.error(`Error al obtener categorías: ${error.message}`, error.stack)
      throw error
    }
  }

  async findAllFlat(clientId: string, filterCategoryIds?: string[]): Promise<CategoryDocument[]> {
    const clientIdObject = new Types.ObjectId(clientId)
    try {
      const filter: Record<string, unknown> = { clientId: clientIdObject }

      if (filterCategoryIds && filterCategoryIds.length > 0) {
        filter._id = { $in: filterCategoryIds.map((id) => new Types.ObjectId(id)) }
      }

      return await this.categoryModel.find(filter).exec()
    } catch (error) {
      this.logger.error(`Error al obtener categorías (flat): ${error.message}`, error.stack)
      throw error
    }
  }

  async findOne(id: string, clientId: string): Promise<CategoryDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`ID de categoría inválido: ${id}`)
    }
    const clientIdObject = new Types.ObjectId(clientId)
    try {
      const category = await this.categoryModel
        .findOne({ _id: id, clientId: clientIdObject })
        .exec()
      if (!category) {
        throw new NotFoundException(`Categoría con ID ${id} no encontrada`)
      }
      return category
    } catch (error) {
      this.logger.error(`Error al obtener categoría: ${error.message}`, error.stack)
      throw error
    }
  }

  async findByKey(key: string, clientId: string): Promise<CategoryDocument> {
    const clientIdObject = new Types.ObjectId(clientId)
    try {
      const category = await this.categoryModel
        .findOne({ key, clientId: clientIdObject })
        .exec()
      if (!category) {
        throw new NotFoundException(`Categoría con clave ${key} no encontrada`)
      }
      return category
    } catch (error) {
      this.logger.error(`Error al obtener categoría por clave: ${error.message}`, error.stack)
      throw error
    }
  }

  async update(
    id: string,
    updateCategoryDto: UpdateCategoryDto,
    clientId: string
  ): Promise<CategoryDocument> {
    const clientIdObject = new Types.ObjectId(clientId)
    try {
      if (
        updateCategoryDto.name &&
        !updateCategoryDto.key &&
        updateCategoryDto.name !== (await this.findOne(id, clientId)).name
      ) {
        updateCategoryDto.key = this.generateKey(updateCategoryDto.name)
      }

      const updatedCategory = await this.categoryModel
        .findOneAndUpdate({ _id: id, clientId: clientIdObject }, updateCategoryDto, { new: true })
        .exec()

      if (!updatedCategory) {
        throw new NotFoundException(`Categoría con ID ${id} no encontrada`)
      }

      return updatedCategory
    } catch (error) {
      this.logger.error(`Error al actualizar categoría: ${error.message}`, error.stack)
      throw error
    }
  }

  async remove(id: string, clientId: string): Promise<void> {
    const clientIdObject = new Types.ObjectId(clientId)
    try {
      const result = await this.categoryModel
        .findOneAndDelete({ _id: id, clientId: clientIdObject })
        .exec()
      if (!result) {
        throw new NotFoundException(`Categoría con ID ${id} no encontrada`)
      }
    } catch (error) {
      this.logger.error(`Error al eliminar categoría: ${error.message}`, error.stack)
      throw error
    }
  }

  async bulkCreate(
    rows: Array<{
      name: string
      cuenta?: string
      description?: string
      observaciones?: string
      limit?: number | null
    }>,
    clientId: string
  ): Promise<IBulkCreateResult> {
    const result: IBulkCreateResult = { created: 0, errors: [] }
    const clientIdObject = new Types.ObjectId(clientId)

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNumber = i + 2 // Excel row (1 = header, data starts at 2)

      if (!row.name || !row.name.trim()) {
        result.errors.push({ row: rowNumber, reason: 'El campo Nombre es obligatorio' })
        continue
      }

      try {
        const key = this.generateKey(row.name)
        await this.categoryModel.create({
          name: row.name.trim(),
          key,
          cuenta: row.cuenta?.trim() || undefined,
          description: row.description?.trim() || undefined,
          observaciones: row.observaciones?.trim() || undefined,
          limit: row.limit != null && !isNaN(row.limit) ? row.limit : null,
          isActive: true,
          clientId: clientIdObject,
        })
        result.created++
      } catch (error) {
        const reason =
          error?.code === 11000
            ? `Ya existe una categoría con nombre similar (clave duplicada)`
            : error.message
        result.errors.push({ row: rowNumber, reason })
      }
    }

    return result
  }

  private generateKey(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  }
}
