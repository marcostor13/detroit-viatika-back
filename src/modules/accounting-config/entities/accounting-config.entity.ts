import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

/** Tasa de IGV admitida y la cuenta contable 40 (crédito fiscal) asociada. */
export interface IgvRate {
  /** Tasa porcentual: 18, 10, 10.5… */
  tasa: number
  /** Cuenta contable 40 para esa tasa (ej. 40.1.1.100). */
  cuenta40: string
}

/** Cuenta bancaria de la empresa → resuelve la cuenta contable 104 (Caja-Bancos). */
export interface BankAccount {
  /** Nombre del banco (BCP, BBVA, etc.). */
  banco: string
  /** Número de cuenta bancaria. */
  nroCuenta: string
  /** Cuenta contable asociada (10/104), ej. 10.4.1.100. */
  cuentaContable: string
  /** Moneda de la cuenta: 01 (soles) / 02 (dólares). Por defecto 01. */
  moneda?: string
  /** CCI opcional. */
  cci?: string
  activo?: boolean
}

export interface AccountingConfigDocument extends Omit<Document, '_id'> {
  _id: string
  clientId: Types.ObjectId
  // Cuentas fijas del plan
  cuenta42: string
  cuenta79: string
  cuenta14Raiz: string
  cuenta46?: string
  // IGV
  igvRates: IgvRate[]
  inafectoKeywords: string[]
  // Defaults Contanet
  codModulo: string
  modulo: string
  fuenteCompra: string
  fuenteAplicacion: string
  fuenteCajaBancos: string
  monedaOrigen: string
  monedaRegistro: string
  identificadorCtrMda: string
  conceptoFec: string
  area?: string
  centroCosto?: string
  subCentroCosto?: string
  tipoCambio?: number
  /** Cuenta que descarga el reembolso al colaborador: '14' (default) o '46'. */
  cuentaReembolso: '14' | '46'
  bankAccounts: BankAccount[]
}

@Schema({ timestamps: true })
export class AccountingConfig {
  @Prop({ type: Types.ObjectId, ref: 'Client', required: true, unique: true })
  clientId: Types.ObjectId

  // --- Cuentas fijas del plan de cuentas ---
  /** Cuentas por pagar comerciales — terceros (total del comprobante). */
  @Prop({ default: '42.1.2.100' })
  cuenta42: string

  /** Cargas imputables a cuentas de costos y gastos (enlace destino). */
  @Prop({ default: '79.1.1.100' })
  cuenta79: string

  /** Raíz de Cuentas por cobrar al personal (14). Se completa con la subcuenta del colaborador. */
  @Prop({ default: '14.1.3.100' })
  cuenta14Raiz: string

  /** Cuenta por pagar diversas — terceros (alternativa de reembolso). */
  @Prop({ required: false })
  cuenta46?: string

  // --- IGV ---
  @Prop({
    type: [
      {
        tasa: { type: Number, required: true },
        cuenta40: { type: String, required: true },
        _id: false,
      },
    ],
    default: [{ tasa: 18, cuenta40: '40.1.1.100' }],
  })
  igvRates: IgvRate[]

  /** Palabras clave que marcan condición inafecta (recargo al consumo, servicio, D.L. 25988, propina…). */
  @Prop({
    type: [String],
    default: [
      'recargo al consumo',
      'recargo consumo',
      'rc',
      'servicio',
      'd.l. 25988',
      'propina',
    ],
  })
  inafectoKeywords: string[]

  // --- Constantes / defaults Contanet ---
  /** Cod. Módulo (Cod_MR). Para Viático SIEMPRE 03. */
  @Prop({ default: '03' })
  codModulo: string

  /** Módulo (Ncorto). CT = Contabilidad. */
  @Prop({ default: 'CT' })
  modulo: string

  /** Fuente para el registro de compra. RC = Registro de Compras. */
  @Prop({ default: 'RC' })
  fuenteCompra: string

  /** Fuente para la aplicación. LD = Libro Diario. */
  @Prop({ default: 'LD' })
  fuenteAplicacion: string

  /** Fuente para movimientos de dinero (solicitud, devolución, reembolso). CB = Caja-Bancos. */
  @Prop({ default: 'CB' })
  fuenteCajaBancos: string

  @Prop({ default: '01' })
  monedaOrigen: string

  @Prop({ default: '01' })
  monedaRegistro: string

  @Prop({ default: 'A' })
  identificadorCtrMda: string

  /** Concepto Flujo Efectivo Contable (Tabla 8). 1 = Operación. */
  @Prop({ default: '1' })
  conceptoFec: string

  /** Área por defecto (col Y), ej. 010101. Puede sobreescribirse por proyecto. */
  @Prop({ required: false })
  area?: string

  /** Centro de costo por defecto (col T), ej. SC. */
  @Prop({ required: false })
  centroCosto?: string

  /** Sub-centro de costo por defecto (col U/V). */
  @Prop({ required: false })
  subCentroCosto?: string

  /** Tipo de cambio por defecto cuando aplica moneda extranjera. */
  @Prop({ default: 1 })
  tipoCambio?: number

  /** Cuenta que descarga el reembolso al colaborador. '14' por defecto (confirmado por template). */
  @Prop({ default: '14', enum: ['14', '46'] })
  cuentaReembolso: '14' | '46'

  // --- Bancos de la empresa ---
  @Prop({
    type: [
      {
        banco: { type: String, required: true },
        nroCuenta: { type: String, required: true },
        cuentaContable: { type: String, required: true },
        moneda: { type: String, default: '01' },
        cci: { type: String, required: false },
        activo: { type: Boolean, default: true },
        _id: false,
      },
    ],
    default: [],
  })
  bankAccounts: BankAccount[]
}

export const AccountingConfigSchema =
  SchemaFactory.createForClass(AccountingConfig)
