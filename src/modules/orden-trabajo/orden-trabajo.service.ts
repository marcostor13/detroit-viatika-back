import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import {
  OrdenTrabajo,
  OrdenTrabajoDocument,
} from './entities/orden-trabajo.entity'
import { Project } from '../project/entities/project.entity'
import { CreateOrdenTrabajoDto } from './dto/create-orden-trabajo.dto'
import { UpdateOrdenTrabajoDto } from './dto/update-orden-trabajo.dto'

/** Escapa una cadena para usarla literalmente dentro de una RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface IBulkCreateResult {
  created: number
  errors: { row: number; reason: string }[]
}

@Injectable()
export class OrdenTrabajoService {
  constructor(
    @InjectModel(OrdenTrabajo.name)
    private ordenTrabajoModel: Model<OrdenTrabajoDocument>,
    @InjectModel(Project.name)
    private projectModel: Model<any>
  ) {}

  /**
   * Verifica que el centro de costo exista y pertenezca a la empresa. Devuelve
   * su ObjectId listo para persistir. Evita relacionar la OT con un centro de
   * costo de otra empresa (aislamiento multitenant).
   */
  private async assertCostCenter(
    costCenterId: string,
    clientId: Types.ObjectId
  ): Promise<Types.ObjectId> {
    if (!Types.ObjectId.isValid(costCenterId)) {
      throw new BadRequestException('El centro de costo no es válido')
    }
    const exists = await this.projectModel
      .exists({ _id: new Types.ObjectId(costCenterId), clientId })
      .exec()
    if (!exists) {
      throw new BadRequestException(
        'El centro de costo no existe o no pertenece a esta empresa'
      )
    }
    return new Types.ObjectId(costCenterId)
  }

  /**
   * La unicidad del nombre es POR EMPRESA (clientId) y sin distinguir
   * mayúsculas/minúsculas. Otra empresa puede tener el mismo nombre.
   */
  private async ensureUniqueNombre(
    nombre: string,
    clientId: Types.ObjectId,
    excludeId?: Types.ObjectId
  ): Promise<void> {
    const filter: Record<string, unknown> = {
      clientId,
      nombre: { $regex: `^${escapeRegExp(nombre)}$`, $options: 'i' },
    }
    if (excludeId) {
      filter._id = { $ne: excludeId }
    }
    const exists = await this.ordenTrabajoModel.exists(filter).exec()
    if (exists) {
      throw new BadRequestException(
        `Ya existe una orden de trabajo con el nombre "${nombre}" en esta empresa`
      )
    }
  }

  async create(dto: CreateOrdenTrabajoDto, clientId: string) {
    const nombre = dto.nombre?.trim()
    if (!nombre) {
      throw new BadRequestException('El nombre de la OT es obligatorio')
    }

    const clientIdObject = new Types.ObjectId(clientId)
    const costCenterId = await this.assertCostCenter(
      dto.costCenterId,
      clientIdObject
    )
    await this.ensureUniqueNombre(nombre, clientIdObject)

    try {
      return await this.ordenTrabajoModel.create({
        nombre,
        costCenterId,
        isActive: dto.isActive ?? true,
        clientId: clientIdObject,
      })
    } catch (error: any) {
      // Red de seguridad ante una carrera: el índice único { nombre, clientId }
      // rechaza el duplicado aunque dos creaciones lleguen a la vez.
      if (error?.code === 11000) {
        throw new BadRequestException(
          `Ya existe una orden de trabajo con el nombre "${nombre}" en esta empresa`
        )
      }
      throw error
    }
  }

  /**
   * Resuelve un centro de costo por texto (código o nombre) para la carga
   * masiva, donde el archivo Excel no puede traer un ObjectId. Prueba primero
   * `code` (match exacto, case-insensitive) y si no hay resultado prueba
   * `name` (también case-insensitive) — ambos scoped a la empresa.
   */
  private async resolveCostCenterByKey(
    key: string,
    clientId: Types.ObjectId
  ): Promise<Types.ObjectId | null> {
    const trimmed = key.trim()
    if (!trimmed) return null
    const rx = { $regex: `^${escapeRegExp(trimmed)}$`, $options: 'i' }
    const byCode = await this.projectModel
      .findOne({ clientId, code: rx })
      .select('_id')
      .exec()
    if (byCode) return byCode._id
    const byName = await this.projectModel
      .findOne({ clientId, name: rx })
      .select('_id')
      .exec()
    return byName ? byName._id : null
  }

  /**
   * Carga masiva desde Excel (regla: mismo patrón que `CategoryService.bulkCreate`
   * — no aborta el lote completo por una fila mala, acumula errores por fila).
   * A diferencia de Category, cada fila tiene una referencia foránea
   * (`costCenterId`) que el archivo solo puede expresar como texto (código o
   * nombre del centro de costo), así que se resuelve por fila antes de crear.
   */
  async bulkCreate(
    rows: Array<{ nombre: string; costCenterKey: string; isActive?: boolean }>,
    clientId: string
  ): Promise<IBulkCreateResult> {
    const result: IBulkCreateResult = { created: 0, errors: [] }
    const clientIdObject = new Types.ObjectId(clientId)
    const seenNombres = new Set<string>()

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNumber = i + 2 // Excel: fila 1 = encabezado
      const nombre = row.nombre?.trim()

      if (!nombre) {
        result.errors.push({ row: rowNumber, reason: 'El campo Nombre es obligatorio' })
        continue
      }
      const nombreKey = nombre.toLowerCase()
      if (seenNombres.has(nombreKey)) {
        result.errors.push({
          row: rowNumber,
          reason: `Nombre "${nombre}" repetido en este mismo archivo`,
        })
        continue
      }
      if (!row.costCenterKey?.trim()) {
        result.errors.push({
          row: rowNumber,
          reason: 'El campo Centro de Costo es obligatorio',
        })
        continue
      }

      try {
        const costCenterId = await this.resolveCostCenterByKey(
          row.costCenterKey,
          clientIdObject
        )
        if (!costCenterId) {
          result.errors.push({
            row: rowNumber,
            reason: `Centro de costo "${row.costCenterKey}" no encontrado en esta empresa`,
          })
          continue
        }
        await this.ensureUniqueNombre(nombre, clientIdObject)
        await this.ordenTrabajoModel.create({
          nombre,
          costCenterId,
          isActive: row.isActive ?? true,
          clientId: clientIdObject,
        })
        seenNombres.add(nombreKey)
        result.created++
      } catch (error: any) {
        const reason =
          error?.code === 11000
            ? `Ya existe una orden de trabajo con el nombre "${nombre}" en esta empresa`
            : error?.message || 'Error desconocido'
        result.errors.push({ row: rowNumber, reason })
      }
    }

    return result
  }

  async findAll(
    clientId: string,
    opts?: { page?: number; limit?: number; search?: string; costCenterId?: string }
  ) {
    const clientIdObject = new Types.ObjectId(clientId)
    const filter: Record<string, unknown> = { clientId: clientIdObject }

    if (opts?.costCenterId && Types.ObjectId.isValid(opts.costCenterId)) {
      filter.costCenterId = new Types.ObjectId(opts.costCenterId)
    }
    if (opts?.search) {
      filter.nombre = new RegExp(escapeRegExp(opts.search), 'i')
    }

    const usePagination = opts?.page !== undefined || opts?.limit !== undefined
    const page = opts?.page ?? 1
    const limit = opts?.limit ?? 20
    const skip = (page - 1) * limit

    const [data, total] = await Promise.all([
      this.ordenTrabajoModel
        .find(filter)
        .populate('costCenterId', 'code name isActive')
        .sort({ createdAt: -1 })
        .skip(usePagination ? skip : 0)
        .limit(usePagination ? limit : 0)
        .exec(),
      this.ordenTrabajoModel.countDocuments(filter).exec(),
    ])

    if (usePagination) {
      return { data, total, page, pages: Math.ceil(total / limit), limit }
    }
    return data
  }

  async findOne(id: string, clientId: string) {
    const orden = await this.ordenTrabajoModel
      .findOne({
        _id: new Types.ObjectId(id),
        clientId: new Types.ObjectId(clientId),
      })
      .populate('costCenterId', 'code name isActive')
      .exec()
    if (!orden) {
      throw new NotFoundException('Orden de trabajo no encontrada')
    }
    return orden
  }

  async update(id: string, dto: UpdateOrdenTrabajoDto, clientId: string) {
    const clientIdObject = new Types.ObjectId(clientId)
    const idObject = new Types.ObjectId(id)

    const payload: Record<string, unknown> = {}

    if (typeof dto.nombre === 'string') {
      const nombre = dto.nombre.trim()
      if (!nombre) {
        throw new BadRequestException('El nombre de la OT no puede quedar vacío')
      }
      await this.ensureUniqueNombre(nombre, clientIdObject, idObject)
      payload.nombre = nombre
    }
    if (dto.costCenterId) {
      payload.costCenterId = await this.assertCostCenter(
        dto.costCenterId,
        clientIdObject
      )
    }
    if (typeof dto.isActive === 'boolean') {
      payload.isActive = dto.isActive
    }

    let orden: OrdenTrabajoDocument | null
    try {
      orden = await this.ordenTrabajoModel
        .findOneAndUpdate(
          { _id: idObject, clientId: clientIdObject },
          payload,
          { new: true }
        )
        .populate('costCenterId', 'code name isActive')
        .exec()
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new BadRequestException(
          `Ya existe una orden de trabajo con el nombre "${String(
            payload.nombre ?? ''
          )}" en esta empresa`
        )
      }
      throw error
    }

    if (!orden) {
      throw new NotFoundException('Orden de trabajo no encontrada')
    }
    return orden
  }

  async remove(id: string, clientId: string) {
    const result = await this.ordenTrabajoModel
      .findOneAndDelete({
        _id: new Types.ObjectId(id),
        clientId: new Types.ObjectId(clientId),
      })
      .exec()
    if (!result) {
      throw new NotFoundException('Orden de trabajo no encontrada')
    }
    return result
  }
}
