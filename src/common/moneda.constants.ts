/** Catálogo mínimo de monedas soportadas para viáticos. Código = código SUNAT usado en AccountingConfig. */
export const MONEDA_SYMBOLS: Record<string, string> = {
  '01': 'S/',
  '02': '$',
}

export const DEFAULT_MONEDA = '01'

export function monedaSymbol(code?: string | null): string {
  return MONEDA_SYMBOLS[code ?? DEFAULT_MONEDA] ?? MONEDA_SYMBOLS[DEFAULT_MONEDA]
}
