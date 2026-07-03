import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import {
  AuditLog,
  AuditLogDocument,
  AuditAction,
} from './entities/audit-log.entity'

export interface CreateAuditLogDto {
  userId: string
  userName: string
  action: AuditAction
  module: string
  entityId?: string
  details?: string
  clientId?: string
  ip?: string
}

@Injectable()
export class AuditLogService {
  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>
  ) {}

  async log(data: CreateAuditLogDto): Promise<void> {
    try {
      await this.auditLogModel.create(data)
    } catch {
      // Logging errors must never break the main flow
    }
  }

  async findAll(
    clientId?: string,
    opts: {
      page?: number
      limit?: number
      module?: string
      search?: string
    } = {}
  ) {
    const filter: any = {}
    if (clientId) filter.clientId = clientId
    if (opts.module) filter.module = opts.module
    if (opts.search) {
      const re = new RegExp(opts.search, 'i')
      filter.$or = [{ userName: re }, { action: re }, { details: re }]
    }

    const page = opts.page ?? 1
    const limit = opts.limit ?? 20
    const skip = (page - 1) * limit

    const [data, total] = await Promise.all([
      this.auditLogModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.auditLogModel.countDocuments(filter),
    ])
    return { data, total, page, pages: Math.ceil(total / limit), limit }
  }
}
