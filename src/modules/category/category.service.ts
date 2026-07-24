import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Category, CategoryDocument } from './entities/category.entity'
import {
  CategoryProfile,
  CategoryProfileDocument,
} from '../category-profile/entities/category-profile.entity'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'

/**
 * Collation para ordenar nombres de categoría alfabéticamente en español.
 * `strength: 1` ignora tildes y mayúsculas, de modo que "Útiles" y "alimentación"
 * caen donde un humano los espera y no al final por su byte UTF-8.
 */
const CATEGORY_NAME_COLLATION = { locale: 'es', strength: 1 } as const

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
  cuentaDestino6x?: string
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
  warnings: { row: number; reason: string }[]
}

@Injectable()
export class CategoryService {
  private readonly logger = new Logger(CategoryService.name)

  constructor(
    @InjectModel(Category.name)
    private categoryModel: Model<CategoryDocument>,
    @InjectModel(CategoryProfile.name)
    private categoryProfileModel: Model<CategoryProfileDocument>
  ) {}

  async create(
    createCategoryDto: CreateCategoryDto
  ): Promise<CategoryDocument> {
    const clientIdObject = new Types.ObjectId(createCategoryDto.clientId)
    try {
      if (!createCategoryDto.key && createCategoryDto.name) {
        createCategoryDto.key = await this.generateUniqueKey(
          createCategoryDto.name,
          clientIdObject
        )
      }

      const newCategory = new this.categoryModel({
        ...createCategoryDto,
        clientId: clientIdObject,
      })
      return await newCategory.save()
    } catch (error) {
      if (error?.code === 11000) {
        throw new ConflictException(
          'Ya existe una categoría con esa clave. Cambia el nombre o la clave.'
        )
      }
      this.logger.error(
        `Error al crear categoría: ${error.message}`,
        error.stack
      )
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
      // Orden alfabético con collation español: sin tildes ni mayúsculas de por
      // medio. Además estabiliza la paginación (skip/limit sin sort no garantiza
      // un orden consistente entre páginas en MongoDB).
      const docs = await this.categoryModel
        .find(filter)
        .collation(CATEGORY_NAME_COLLATION)
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .exec()

      const data: ICategoryItem[] = docs.map(doc => {
        const d = doc.toObject() as CategoryDocument & { _id: Types.ObjectId }
        return {
          _id: d._id.toString(),
          name: d.name,
          key: d.key,
          description: d.description,
          cuenta: d.cuenta,
          cuentaDestino6x: d.cuentaDestino6x,
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
      this.logger.error(
        `Error al obtener categorías: ${error.message}`,
        error.stack
      )
      throw error
    }
  }

  async findAllFlat(
    clientId: string,
    filterCategoryIds?: string[]
  ): Promise<CategoryDocument[]> {
    const clientIdObject = new Types.ObjectId(clientId)
    try {
      const filter: Record<string, unknown> = { clientId: clientIdObject }

      // undefined => sin filtro (todas). Array (incluso vacío) => solo esas (vacío = ninguna).
      if (filterCategoryIds !== undefined) {
        filter._id = {
          $in: filterCategoryIds.map(id => new Types.ObjectId(id)),
        }
      }

      return await this.categoryModel
        .find(filter)
        .collation(CATEGORY_NAME_COLLATION)
        .sort({ name: 1 })
        .exec()
    } catch (error) {
      this.logger.error(
        `Error al obtener categorías (flat): ${error.message}`,
        error.stack
      )
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
      this.logger.error(
        `Error al obtener categoría: ${error.message}`,
        error.stack
      )
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
      this.logger.error(
        `Error al obtener categoría por clave: ${error.message}`,
        error.stack
      )
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
        updateCategoryDto.key = await this.generateUniqueKey(
          updateCategoryDto.name,
          clientIdObject,
          id
        )
      }

      const updatedCategory = await this.categoryModel
        .findOneAndUpdate(
          { _id: id, clientId: clientIdObject },
          updateCategoryDto,
          { new: true }
        )
        .exec()

      if (!updatedCategory) {
        throw new NotFoundException(`Categoría con ID ${id} no encontrada`)
      }

      return updatedCategory
    } catch (error) {
      if (error instanceof NotFoundException) throw error
      if (error?.code === 11000) {
        throw new ConflictException(
          'Ya existe una categoría con esa clave. Cambia el nombre o la clave.'
        )
      }
      this.logger.error(
        `Error al actualizar categoría: ${error.message}`,
        error.stack
      )
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
      this.logger.error(
        `Error al eliminar categoría: ${error.message}`,
        error.stack
      )
      throw error
    }
  }

  async bulkCreate(
    rows: Array<{
      name: string
      cuenta?: string
      cuentaDestino6x?: string
      description?: string
      observaciones?: string
      limit?: number | null
      perfil?: string
    }>,
    clientId: string
  ): Promise<IBulkCreateResult> {
    const result: IBulkCreateResult = { created: 0, errors: [], warnings: [] }
    const clientIdObject = new Types.ObjectId(clientId)

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNumber = i + 2 // Excel row (1 = header, data starts at 2)

      if (!row.name || !row.name.trim()) {
        result.errors.push({
          row: rowNumber,
          reason: 'El campo Nombre es obligatorio',
        })
        continue
      }

      try {
        const key = await this.generateUniqueKey(
          row.name.trim(),
          clientIdObject
        )
        const newCategory = await this.categoryModel.create({
          name: row.name.trim(),
          key,
          cuenta: row.cuenta?.trim() || undefined,
          cuentaDestino6x: row.cuentaDestino6x?.trim() || undefined,
          description: row.description?.trim() || undefined,
          observaciones: row.observaciones?.trim() || undefined,
          limit: row.limit != null && !isNaN(row.limit) ? row.limit : null,
          isActive: true,
          clientId: clientIdObject,
        })
        result.created++

        const perfilName = row.perfil?.trim()
        if (perfilName) {
          try {
            await this.categoryProfileModel
              .findOneAndUpdate(
                { name: perfilName, clientId: clientIdObject },
                {
                  $addToSet: { categoryIds: newCategory._id },
                  $setOnInsert: { name: perfilName, clientId: clientIdObject },
                },
                { new: true, upsert: true }
              )
              .exec()
          } catch (profileError: any) {
            result.warnings.push({
              row: rowNumber,
              reason: `Categoría creada pero no se pudo vincular al perfil "${perfilName}": ${profileError?.message || 'error desconocido'}`,
            })
          }
        }
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

  /**
   * Genera un `key` único por cliente a partir del nombre. El nombre puede
   * repetirse legítimamente —p. ej. dos "Planilla de movilidad" con distinta
   * cuenta: una de Servicios (91x) y otra de Comercial (92x)— pero el índice
   * { key, clientId } es único, así que se añade un sufijo -2, -3… cuando el
   * slug base ya está tomado. Antes esto reventaba con un E11000 crudo
   * (Internal Server Error) al crear la segunda.
   */
  private async generateUniqueKey(
    name: string,
    clientId: Types.ObjectId,
    excludeId?: string
  ): Promise<string> {
    const base = this.generateKey(name)
    if (!base) return base
    // base solo contiene [a-z0-9-], por lo que es seguro en el regex.
    const filter: Record<string, unknown> = {
      clientId,
      key: { $regex: `^${base}(-\\d+)?$` },
    }
    if (excludeId) filter._id = { $ne: new Types.ObjectId(excludeId) }
    const taken = new Set(
      (await this.categoryModel.find(filter).select('key').lean().exec())
        .map(d => (d as { key?: string }).key)
        .filter((k): k is string => !!k)
    )
    if (!taken.has(base)) return base
    let n = 2
    while (taken.has(`${base}-${n}`)) n++
    return `${base}-${n}`
  }
}
