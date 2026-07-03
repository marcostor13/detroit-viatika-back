import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import {
  AccountingConfig,
  AccountingConfigDocument,
} from './entities/accounting-config.entity'
import { CreateAccountingConfigDto } from './dto/create-accounting-config.dto'
import { UpdateAccountingConfigDto } from './dto/update-accounting-config.dto'

@Injectable()
export class AccountingConfigService {
  private readonly logger = new Logger(AccountingConfigService.name)

  constructor(
    @InjectModel(AccountingConfig.name)
    private accountingConfigModel: Model<AccountingConfigDocument>
  ) {}

  /** Devuelve la config del cliente o null si aún no existe. */
  async findByClient(clientId: string) {
    return this.accountingConfigModel.findOne({ clientId }).lean().exec()
  }

  /**
   * Crea o actualiza (upsert) la configuración contable de una empresa.
   * Hay una sola config por clientId; el upsert evita duplicados.
   */
  async upsert(
    clientId: string,
    dto: CreateAccountingConfigDto | UpdateAccountingConfigDto
  ) {
    const { clientId: _omit, ...rest } = dto as CreateAccountingConfigDto
    return this.accountingConfigModel
      .findOneAndUpdate(
        { clientId },
        { $set: { ...rest, clientId } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      )
      .lean()
      .exec()
  }

  /**
   * Config efectiva: la del cliente fusionada con un documento por defecto.
   * Garantiza que el motor de asientos siempre tenga las constantes Contanet.
   */
  async getEffective(clientId: string): Promise<AccountingConfigDocument> {
    const existing = await this.accountingConfigModel
      .findOne({ clientId })
      .lean()
      .exec()
    if (existing) return existing as unknown as AccountingConfigDocument
    // Documento en memoria con los defaults del schema (sin persistir).
    const draft = new this.accountingConfigModel({ clientId })
    return draft.toObject() as unknown as AccountingConfigDocument
  }

  /** Resuelve la cuenta contable 104 a partir del número de cuenta bancaria. */
  async resolveBankAccount(clientId: string, nroCuenta: string) {
    const config = await this.findByClient(clientId)
    return config?.bankAccounts?.find(b => b.nroCuenta === nroCuenta) ?? null
  }
}
