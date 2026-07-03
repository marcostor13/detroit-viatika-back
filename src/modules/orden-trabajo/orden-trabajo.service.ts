import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import {
  OrdenTrabajo,
  OrdenTrabajoCounter,
  OrdenTrabajoCounterDocument,
  OrdenTrabajoDocument,
} from './entities/orden-trabajo.entity'
import { CreateOrdenTrabajoDto } from './dto/create-orden-trabajo.dto'
import { UpdateOrdenTrabajoDto } from './dto/update-orden-trabajo.dto'
import { buildOtCodigo, OT_DEPARTAMENTO_CODES } from './constants/orden-trabajo.constants'

@Injectable()
export class OrdenTrabajoService {
  constructor(
    @InjectModel(OrdenTrabajo.name)
    private ordenTrabajoModel: Model<OrdenTrabajoDocument>,
    @InjectModel(OrdenTrabajoCounter.name)
    private counterModel: Model<OrdenTrabajoCounterDocument>
  ) {}

  /**
   * Incrementa atómicamente el contador del (clientId, departamento) y
   * devuelve el nuevo correlativo. findOneAndUpdate + $inc + upsert es
   * atómico en Mongo, así que dos creaciones simultáneas del mismo
   * departamento nunca reciben el mismo número.
   */
  private async nextCorrelativo(
    clientId: Types.ObjectId,
    departamento: string
  ): Promise<number> {
    const counter = await this.counterModel
      .findOneAndUpdate(
        { clientId, departamento },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      )
      .exec()
    return counter.seq
  }

  async create(dto: CreateOrdenTrabajoDto, clientId: string) {
    const departamento = dto.departamento?.trim().toUpperCase()
    if (!departamento || !OT_DEPARTAMENTO_CODES.includes(departamento as any)) {
      throw new BadRequestException('El departamento no es válido')
    }

    const clientIdObject = new Types.ObjectId(clientId)
    const correlativo = await this.nextCorrelativo(clientIdObject, departamento)
    const codigo = buildOtCodigo(departamento, correlativo)

    return this.ordenTrabajoModel.create({
      departamento,
      correlativo,
      codigo,
      descripcion: dto.descripcion?.trim() || undefined,
      isActive: dto.isActive ?? true,
      clientId: clientIdObject,
    })
  }

  async findAll(
    clientId: string,
    opts?: { page?: number; limit?: number; search?: string; departamento?: string }
  ) {
    const clientIdObject = new Types.ObjectId(clientId)
    const filter: Record<string, unknown> = { clientId: clientIdObject }

    if (opts?.departamento) {
      filter.departamento = opts.departamento.trim().toUpperCase()
    }
    if (opts?.search) {
      const re = new RegExp(opts.search, 'i')
      filter.$or = [{ codigo: re }, { descripcion: re }]
    }

    const usePagination = opts?.page !== undefined || opts?.limit !== undefined
    const page = opts?.page ?? 1
    const limit = opts?.limit ?? 20
    const skip = (page - 1) * limit

    const [data, total] = await Promise.all([
      this.ordenTrabajoModel
        .find(filter)
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
      .findOne({ _id: new Types.ObjectId(id), clientId: new Types.ObjectId(clientId) })
      .exec()
    if (!orden) {
      throw new NotFoundException('Orden de trabajo no encontrada')
    }
    return orden
  }

  async update(id: string, dto: UpdateOrdenTrabajoDto, clientId: string) {
    const payload: UpdateOrdenTrabajoDto = { ...dto }
    if (typeof payload.descripcion === 'string') {
      payload.descripcion = payload.descripcion.trim()
    }

    const orden = await this.ordenTrabajoModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), clientId: new Types.ObjectId(clientId) },
        payload,
        { new: true }
      )
      .exec()

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
