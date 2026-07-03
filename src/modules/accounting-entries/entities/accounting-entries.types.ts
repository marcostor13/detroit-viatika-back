import { ContanetLine } from './contanet-columns'

export type AsientoTipo =
  | 'solicitud'
  | 'compra'
  | 'aplicacion'
  | 'devolucion'
  | 'reembolso'

/** Resultado de validar el cuadre de un lote de asientos. */
export interface CuadreError {
  relacionado: number
  totalDebe: number
  totalHaber: number
  diferencia: number
}

export interface AsientoLote {
  tipo: AsientoTipo
  /** Líneas listas para exportar (ya con correlativo y relacionado). */
  lines: ContanetLine[]
  /** Errores de cuadre detectados (vacío si todo cuadra). */
  cuadreErrors: CuadreError[]
}

/** Archivo generado para descarga. */
export interface GeneratedFile {
  filename: string
  /** Contenido base64 del .xlsx. */
  base64: string
  tipo: AsientoTipo
  asientosCount: number
  cuadreErrors: CuadreError[]
}
