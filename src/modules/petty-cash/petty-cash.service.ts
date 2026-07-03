import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { PettyCash, PettyCashDocument } from './entities/petty-cash.entity'
import { CreatePettyCashDto } from './dto/create-petty-cash.dto'
import { EmailService } from '../email/email.service'
import { UserService } from '../user/user.service'

@Injectable()
export class PettyCashService {
  constructor(
    @InjectModel(PettyCash.name)
    private readonly model: Model<PettyCashDocument>,
    private readonly emailService: EmailService,
    private readonly userService: UserService
  ) {}

  private async generateCode(
    clientId: string,
    period: string
  ): Promise<string> {
    const prefix = `CCH-${period}-`
    const last = await this.model
      .findOne({
        clientId: new Types.ObjectId(clientId),
        code: { $regex: `^${prefix}` },
      })
      .sort({ code: -1 })
      .lean()
      .exec()
    let seq = 1
    if (last?.code) {
      const parts = last.code.split('-')
      seq = (parseInt(parts[parts.length - 1], 10) || 0) + 1
    }
    return `${prefix}${String(seq).padStart(3, '0')}`
  }

  async create(
    dto: CreatePettyCashDto,
    createdBy: string
  ): Promise<PettyCashDocument> {
    if (dto.fundAmount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a S/ 0')
    }
    const existing = await this.model
      .findOne({
        responsibleId: new Types.ObjectId(dto.responsibleId),
        clientId: new Types.ObjectId(dto.clientId),
        period: dto.period,
        status: { $in: ['pending_funding', 'active'] },
      })
      .exec()
    if (existing) {
      throw new BadRequestException(
        'El responsable ya tiene una caja chica activa para este período'
      )
    }
    const code = await this.generateCode(dto.clientId, dto.period)
    const doc = await this.model.create({
      code,
      responsibleId: new Types.ObjectId(dto.responsibleId),
      clientId: new Types.ObjectId(dto.clientId),
      period: dto.period,
      fundAmount: dto.fundAmount,
      spentAmount: 0,
      maxPerExpense: dto.maxPerExpense,
      maxPerDay: dto.maxPerDay,
      allowedCategories: dto.allowedCategories || [],
      status: 'pending_funding',
      expenses: [],
    })
    const responsible = await this.userService.findEmailNameClient(
      dto.responsibleId
    )
    if (
      responsible?.email &&
      (await this.userService.isEmailEnabled(dto.responsibleId))
    ) {
      this.emailService
        .sendCajaChicaCreada(responsible.email, {
          clientId: dto.clientId,
          recipientName: responsible.name,
          code,
          period: dto.period,
          fundAmount: dto.fundAmount,
        })
        .catch(() => {})
    }
    return doc
  }

  async registerFunding(
    id: string,
    funding: {
      transferDate: string
      amount: number
      operationNumber: string
      receiptUrl: string
    },
    registeredBy: string
  ): Promise<PettyCashDocument> {
    const doc = await this.model.findById(id).exec()
    if (!doc) throw new NotFoundException(`Caja chica ${id} no encontrada`)
    if (doc.status !== 'pending_funding') {
      throw new BadRequestException(
        'Solo se puede fondear una caja en estado pending_funding'
      )
    }
    if (funding.amount !== doc.fundAmount) {
      throw new BadRequestException(
        `El monto del fondeo (${funding.amount}) debe coincidir con el monto aprobado (${doc.fundAmount})`
      )
    }
    const updated = await this.model
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: 'active',
            funding: {
              transferDate: new Date(funding.transferDate),
              amount: funding.amount,
              operationNumber: funding.operationNumber,
              receiptUrl: funding.receiptUrl,
              registeredBy,
              registeredAt: new Date(),
            },
          },
        },
        { new: true }
      )
      .exec()
    const responsible = await this.userService.findEmailNameClient(
      doc.responsibleId.toString()
    )
    if (
      responsible?.email &&
      (await this.userService.isEmailEnabled(doc.responsibleId.toString()))
    ) {
      this.emailService
        .sendCajaChicaFondeada(responsible.email, {
          clientId: doc.clientId?.toString(),
          recipientName: responsible.name,
          code: doc.code,
          fundAmount: doc.fundAmount,
        })
        .catch(() => {})
    }
    return updated!
  }

  async addExpense(
    id: string,
    expenseId: string,
    amount: number,
    category?: string
  ): Promise<PettyCashDocument> {
    const doc = await this.model.findById(id).exec()
    if (!doc) throw new NotFoundException(`Caja chica ${id} no encontrada`)
    if (doc.status !== 'active') {
      throw new BadRequestException(
        'Solo se pueden registrar gastos en una caja activa'
      )
    }
    const errors = this.validateExpenseRules(doc, amount, category)
    if (errors.length > 0) {
      throw new BadRequestException(errors.join(' | '))
    }
    const updated = await this.model
      .findByIdAndUpdate(
        id,
        {
          $push: {
            expenses: {
              expenseId: new Types.ObjectId(expenseId),
              amount,
              registeredAt: new Date(),
              category,
            },
          },
          $inc: { spentAmount: amount },
        },
        { new: true }
      )
      .exec()
    return updated!
  }

  validateExpenseRules(
    doc: PettyCashDocument,
    amount: number,
    category?: string
  ): string[] {
    const errors: string[] = []
    const available = doc.fundAmount - doc.spentAmount
    if (amount > available) {
      errors.push(
        `Saldo insuficiente. Disponible: S/ ${available.toFixed(2)}, solicitado: S/ ${amount}`
      )
    }
    if (doc.maxPerExpense && amount > doc.maxPerExpense) {
      errors.push(
        `El gasto (S/ ${amount}) supera el tope por comprobante (S/ ${doc.maxPerExpense})`
      )
    }
    if (doc.allowedCategories && doc.allowedCategories.length > 0 && category) {
      if (!doc.allowedCategories.includes(category)) {
        errors.push(
          `La categoría "${category}" no está permitida en esta caja chica`
        )
      }
    }
    if (doc.maxPerDay) {
      const today = new Date().toISOString().slice(0, 10)
      const todayTotal = doc.expenses
        .filter(e => {
          const d =
            e.registeredAt instanceof Date
              ? e.registeredAt
              : new Date(e.registeredAt)
          return d.toISOString().slice(0, 10) === today
        })
        .reduce((sum, e) => sum + e.amount, 0)
      if (todayTotal + amount > doc.maxPerDay) {
        errors.push(
          `Tope diario superado. Ya se gastaron S/ ${todayTotal.toFixed(2)} hoy (máximo S/ ${doc.maxPerDay})`
        )
      }
    }
    return errors
  }

  async close(id: string, closedBy: string): Promise<PettyCashDocument> {
    const doc = await this.model.findById(id).exec()
    if (!doc) throw new NotFoundException(`Caja chica ${id} no encontrada`)
    if (doc.status !== 'active') {
      throw new BadRequestException('Solo se puede cerrar una caja activa')
    }
    const updated = await this.model
      .findByIdAndUpdate(
        id,
        { $set: { status: 'closed', closedAt: new Date(), closedBy } },
        { new: true }
      )
      .exec()
    return updated!
  }

  async findOne(id: string): Promise<PettyCashDocument> {
    const doc = await this.model
      .findById(id)
      .populate('responsibleId', 'name email')
      .exec()
    if (!doc) throw new NotFoundException(`Caja chica ${id} no encontrada`)
    return doc
  }

  async findAllByClient(clientId: string): Promise<PettyCashDocument[]> {
    return this.model
      .find({ clientId: new Types.ObjectId(clientId) })
      .populate('responsibleId', 'name email')
      .sort({ createdAt: -1 })
      .exec()
  }

  async findByResponsible(
    responsibleId: string,
    clientId: string
  ): Promise<PettyCashDocument[]> {
    return this.model
      .find({
        responsibleId: new Types.ObjectId(responsibleId),
        clientId: new Types.ObjectId(clientId),
      })
      .sort({ createdAt: -1 })
      .exec()
  }
}
