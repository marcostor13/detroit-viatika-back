/**
 * Departamentos válidos para la Orden de Trabajo (OT) y su código de 3 letras
 * usado en la estructura LIM-{departamento}-{correlativo}.
 */
export const OT_DEPARTAMENTOS = [
  { code: 'TAL', label: 'Taller' },
  { code: 'SCA', label: 'Servicios de Campo' },
  { code: 'SMI', label: 'Servicios de Minería' },
  { code: 'ICO', label: 'Ingeniería y Confiabilidad' },
  { code: 'ABA', label: 'Abastecimientos' },
  { code: 'COM', label: 'Departamento Comercial' },
] as const

export type OtDepartamentoCode = (typeof OT_DEPARTAMENTOS)[number]['code']

export const OT_DEPARTAMENTO_CODES: OtDepartamentoCode[] = OT_DEPARTAMENTOS.map(
  d => d.code
)

export const OT_PREFIJO = 'LIM'
export const OT_CORRELATIVO_DIGITS = 6

/** Construye el código completo: LIM-TAL-000001 */
export function buildOtCodigo(
  departamento: string,
  correlativo: number
): string {
  return `${OT_PREFIJO}-${departamento}-${String(correlativo).padStart(
    OT_CORRELATIVO_DIGITS,
    '0'
  )}`
}
