import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { CreateProjectDto } from './dto/create-project.dto'
import { UpdateProjectDto } from './dto/update-project.dto'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Project, ProjectDocument } from './entities/project.entity'

@Injectable()
export class ProjectService {
  constructor(
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>
  ) {}

  private generateCode(name: string): string {
    return name
      .toUpperCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 20)
  }

  private buildDuplicateCodeMessage(code: string): string {
    return `Ya existe un centro de costo con el código "${code}". Usa un código diferente.`
  }

  private async ensureUniqueCode(
    code: string,
    clientId: Types.ObjectId,
    excludeProjectId?: string
  ): Promise<void> {
    const filter: Record<string, unknown> = { code, clientId }
    if (excludeProjectId) {
      filter['_id'] = { $ne: new Types.ObjectId(excludeProjectId) }
    }

    const existingProject = await this.projectModel.findOne(filter).exec()
    if (existingProject) {
      throw new BadRequestException(this.buildDuplicateCodeMessage(code))
    }
  }

  private rethrowDuplicateCodeError(error: unknown, code: string): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    ) {
      throw new BadRequestException(this.buildDuplicateCodeMessage(code))
    }

    throw error
  }

  private toResponse(project: ProjectDocument) {
    const ln: any = project.lineaNegocioId
    const lineaNegocioId =
      ln && typeof ln === 'object' && ln._id
        ? String(ln._id)
        : ln
          ? String(ln)
          : undefined
    const lineaNegocio =
      ln && typeof ln === 'object' && ln.name
        ? { _id: String(ln._id), name: ln.name, code: ln.code }
        : undefined
    const av: any = project.approverId
    const approverId =
      av && typeof av === 'object' && av._id
        ? String(av._id)
        : av
          ? String(av)
          : undefined
    const approver =
      av && typeof av === 'object' && av.name
        ? { _id: String(av._id), name: av.name, email: av.email }
        : undefined
    const approverLevels = (project.approverLevels ?? []).map(lvl => ({
      level: lvl.level,
      userIds: (lvl.userIds ?? []).map((u: any) =>
        u && typeof u === 'object' && u._id
          ? { _id: String(u._id), name: u.name, email: u.email }
          : { _id: String(u) }
      ),
    }))
    return {
      _id: project._id,
      name: project.name,
      code: project.code,
      isActive: project.isActive,
      client: project.clientId,
      clientName: project.clientName,
      lineaNegocioId,
      lineaNegocio,
      committedAdvanceTotal: project.committedAdvanceTotal ?? 0,
      approverId,
      approver,
      approverLevels,
    }
  }

  private toApproverLevelDocs(
    approverLevels: { level: number; userIds: string[] }[] | undefined
  ): { level: number; userIds: Types.ObjectId[] }[] | undefined {
    if (!approverLevels) return undefined
    return approverLevels
      .filter(lvl => lvl.userIds?.length)
      .map(lvl => ({
        level: lvl.level,
        userIds: lvl.userIds.map(id => new Types.ObjectId(id)),
      }))
  }

  /** Delta positivo al aprobar; negativo al registrar pago (Fase 3). */
  async adjustCommittedAdvanceTotal(
    projectId: string,
    clientId: string,
    delta: number
  ): Promise<void> {
    if (!delta) return
    const clientIdObject = new Types.ObjectId(clientId)
    const updated = await this.projectModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(projectId),
          clientId: clientIdObject,
        },
        { $inc: { committedAdvanceTotal: delta } },
        { new: true }
      )
      .exec()
    if (!updated) {
      throw new NotFoundException('Proyecto no encontrado')
    }
    const total = updated.committedAdvanceTotal ?? 0
    if (total < 0) {
      updated.committedAdvanceTotal = 0
      await updated.save()
    }
  }

  async create(createProjectDto: CreateProjectDto) {
    const clientId = new Types.ObjectId(createProjectDto.clientId)
    const code =
      createProjectDto.code?.trim() || this.generateCode(createProjectDto.name)
    await this.ensureUniqueCode(code, clientId)

    const lineaNegocioId = createProjectDto.lineaNegocioId?.trim()
      ? new Types.ObjectId(createProjectDto.lineaNegocioId.trim())
      : undefined
    const approverId = createProjectDto.approverId?.trim()
      ? new Types.ObjectId(createProjectDto.approverId.trim())
      : undefined
    const approverLevels = this.toApproverLevelDocs(createProjectDto.approverLevels)

    let project: ProjectDocument
    try {
      project = await this.projectModel.create({
        ...createProjectDto,
        code,
        clientId,
        lineaNegocioId,
        approverId,
        approverLevels,
      })
    } catch (error) {
      this.rethrowDuplicateCodeError(error, code)
    }

    return this.toResponse(project)
  }

  async findAll(
    clientId: string,
    opts?: {
      page?: number
      limit?: number
      search?: string
      isActive?: boolean
    }
  ) {
    const clientIdObject = new Types.ObjectId(clientId)
    const filter: any = { clientId: clientIdObject }

    if (opts?.isActive !== undefined) {
      filter.isActive = opts.isActive
    }
    if (opts?.search) {
      const re = new RegExp(opts.search, 'i')
      filter.$or = [{ name: re }, { code: re }]
    }

    const usePagination = opts?.page !== undefined || opts?.limit !== undefined
    const page = opts?.page ?? 1
    const limit = opts?.limit ?? 200
    const skip = (page - 1) * limit

    const [projects, total] = await Promise.all([
      this.projectModel
        .find(filter)
        .skip(skip)
        .limit(limit)
        .populate('clientId')
        .populate('lineaNegocioId', 'name code')
        .populate('approverId', 'name email')
        .populate('approverLevels.userIds', 'name email')
        .exec(),
      this.projectModel.countDocuments(filter).exec(),
    ])

    const data = projects.map(p => this.toResponse(p))

    if (usePagination) {
      return { data, total, page, pages: Math.ceil(total / limit), limit }
    }
    return data
  }

  async findOne(id: string, clientId: string) {
    const clientIdObject = new Types.ObjectId(clientId)
    const project = await this.projectModel
      .findOne({ _id: new Types.ObjectId(id), clientId: clientIdObject })
      .populate('clientId')
      .populate('lineaNegocioId', 'name code')
      .populate('approverId', 'name email')
      .exec()
    if (!project) {
      throw new NotFoundException('Proyecto no encontrado')
    }
    return this.toResponse(project)
  }

  /**
   * ¿Este usuario aparece como aprobador (cualquier nivel) en algún centro de
   * costo de su empresa? Reemplaza el chequeo por rol "Coordinador" — la
   * autorización real depende de estar en `approverLevels`, no del rol.
   */
  async isApproverForClient(userId: string, clientId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(clientId)) {
      return false
    }
    const exists = await this.projectModel.exists({
      clientId: new Types.ObjectId(clientId),
      'approverLevels.userIds': new Types.ObjectId(userId),
    })
    return !!exists
  }

  /** Carga varios centros de costo por ID (usado al armar la cadena de aprobación). */
  async findManyByIds(ids: string[], clientId: string): Promise<ProjectDocument[]> {
    if (!ids.length) return []
    const clientIdObject = new Types.ObjectId(clientId)
    const objectIds = ids.map(id => new Types.ObjectId(id))
    return this.projectModel
      .find({ _id: { $in: objectIds }, clientId: clientIdObject })
      .select('approverLevels')
      .exec()
  }

  async update(
    id: string,
    updateProjectDto: UpdateProjectDto,
    clientId: string
  ) {
    const clientIdObject = new Types.ObjectId(clientId)
    const updatePayload: UpdateProjectDto = { ...updateProjectDto }

    if (typeof updatePayload.code === 'string') {
      updatePayload.code = updatePayload.code.trim()
      if (!updatePayload.code) {
        delete updatePayload.code
      }
    }

    // Línea de negocio: cadena vacía/null limpia la asignación; valor válido la actualiza.
    if ('lineaNegocioId' in updatePayload) {
      const raw = (updatePayload.lineaNegocioId ?? '').toString().trim()
      ;(updatePayload as Record<string, unknown>).lineaNegocioId = raw
        ? new Types.ObjectId(raw)
        : null
    }

    // Aprobador del centro de costo: cadena vacía/null limpia la asignación.
    if ('approverId' in updatePayload) {
      const raw = (updatePayload.approverId ?? '').toString().trim()
      ;(updatePayload as Record<string, unknown>).approverId = raw
        ? new Types.ObjectId(raw)
        : null
    }

    // Niveles de aprobación: reemplazo completo del arreglo cuando se envía.
    if ('approverLevels' in updatePayload) {
      ;(updatePayload as Record<string, unknown>).approverLevels =
        this.toApproverLevelDocs(updatePayload.approverLevels) ?? []
    }

    if (updatePayload.code) {
      await this.ensureUniqueCode(updatePayload.code, clientIdObject, id)
    }

    if (updatePayload.isActive === false) {
      const activeExpenses = await (
        this.projectModel.db.model('Expense') as any
      )
        .countDocuments({
          proyectId: new Types.ObjectId(id),
          status: { $nin: ['rejected'] },
        })
        .catch(() => 0)
      if (activeExpenses > 0) {
        throw new BadRequestException(
          `Este proyecto tiene ${activeExpenses} comprobante(s) activo(s). Puede desactivarlo, pero los gastos existentes se conservarán.`
        )
      }
    }

    let project: ProjectDocument | null
    try {
      project = await this.projectModel
        .findOneAndUpdate(
          { _id: new Types.ObjectId(id), clientId: clientIdObject },
          updatePayload,
          { new: true }
        )
        .populate('clientId')
        .populate('lineaNegocioId', 'name code')
        .populate('approverId', 'name email')
        .populate('approverLevels.userIds', 'name email')
        .exec()
    } catch (error) {
      this.rethrowDuplicateCodeError(
        error,
        updatePayload.code ?? updateProjectDto.code ?? ''
      )
    }

    if (!project) {
      throw new NotFoundException('Proyecto no encontrado')
    }

    return this.toResponse(project)
  }

  async bulkImport(
    rows: Array<Record<string, any>>,
    clientId: string
  ): Promise<{ created: number; skipped: string[]; errors: string[] }> {
    let created = 0
    const skipped: string[] = []
    const errors: string[] = []
    const clientIdObj = new Types.ObjectId(clientId)

    for (const row of rows) {
      const name = String(row['Nombre Proyecto'] ?? row['name'] ?? '').trim()
      if (!name) {
        errors.push('Fila sin nombre de proyecto')
        continue
      }

      const code =
        String(row['Código'] ?? row['Codigo'] ?? row['code'] ?? '').trim() ||
        this.generateCode(name)
      const clientName = String(row['Nombre Cliente'] ?? '').trim() || undefined

      try {
        const exists = await this.projectModel
          .findOne({ code, clientId: clientIdObj })
          .exec()
        if (exists) {
          skipped.push(code)
          continue
        }
        await this.projectModel.create({
          name,
          code,
          clientId: clientIdObj,
          clientName,
        })
        created++
      } catch (e: any) {
        errors.push(`${code}: ${e?.message || 'error'}`)
      }
    }
    return { created, skipped, errors }
  }

  async remove(id: string, clientId: string) {
    const clientIdObject = new Types.ObjectId(clientId)
    const result = await this.projectModel
      .findOneAndDelete({
        _id: new Types.ObjectId(id),
        clientId: clientIdObject,
      })
      .exec()
    if (!result) {
      throw new NotFoundException('Proyecto no encontrado')
    }
    return result
  }
}
