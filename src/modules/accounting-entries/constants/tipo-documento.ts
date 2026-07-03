/**
 * Códigos de tipo de documento del sistema contable (Contanet).
 * Fuente: codigos.md (catálogo entregado por Contabilidad).
 *
 * | Código | Sigla | Documento               |
 * |--------|-------|-------------------------|
 * | 94     | PM    | Planilla de Movilidad   |
 * | 66     | CC    | Comprobante de Caja     |
 * | 01     | FT    | Factura                 |
 * | 03     | BV    | Boleta                  |
 * | 12     | TK    | Ticket                  |
 * | 00     | RC    | Recibos diversos        |
 * | 00     | DJ    | Declaración Jurada      |
 * | 00     | OT    | Otros                   |
 */
export const TIPO_DOCUMENTO = {
  FT: '01',
  BV: '03',
  TK: '12',
  CC: '66',
  PM: '94',
  RC: '00',
  DJ: '00',
  OT: '00',
} as const

/**
 * Resuelve el "Codigo Tipo Document" de Contanet para un gasto.
 * Para `expenseType: 'factura'` se afina con el tipo real leído del
 * comprobante (una boleta o ticket subidos como factura llevan su código).
 */
export function resolveCodTipDoc(
  expense: {
    expenseType?: string
    subTipo?: string
    comprobanteDetallado?: Record<string, any>
  },
  dataTipoComprobante?: string
): string {
  switch (expense.expenseType) {
    case 'planilla_movilidad':
      return TIPO_DOCUMENTO.PM
    case 'comprobante_caja':
      return TIPO_DOCUMENTO.CC
    case 'recibo_caja':
      return TIPO_DOCUMENTO.RC
    case 'otros_gastos': {
      const sub = (expense.subTipo || '').toUpperCase()
      if (sub === 'TK') return TIPO_DOCUMENTO.TK
      // RC / DJ / OT comparten el código 00.
      return TIPO_DOCUMENTO.OT
    }
    default: {
      const tipo = String(
        expense.comprobanteDetallado?.comprobante?.tipo ||
          dataTipoComprobante ||
          ''
      ).toLowerCase()
      if (tipo.includes('bolet')) return TIPO_DOCUMENTO.BV
      if (tipo.includes('ticket') || tipo.includes('tique'))
        return TIPO_DOCUMENTO.TK
      return TIPO_DOCUMENTO.FT
    }
  }
}
