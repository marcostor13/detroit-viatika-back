/**
 * Prompt de clasificación de deducibilidad de cargos ≠ IGV de una factura.
 * Solo se invoca cuando el comprobante trae `otrosTributos` u `otrosCargos`
 * que no se pudieron clasificar de forma determinista (recargo al consumo,
 * ISC e ICBPER se resuelven sin IA). Un único request batcheado por rendición.
 *
 * Series de control interno de gastos NO deducibles (fuente: nodeducible.md,
 * TUO de la Ley del Impuesto a la Renta):
 *  - 0001: documentación sustentatoria que no cumple requisitos del
 *          Reglamento de Comprobantes de Pago (art. 44 inc. j).
 *  - 0003: multas, recargos, intereses moratorios y sanciones del Sector
 *          Público (art. 44 inc. c).
 *  - 0008: exceso de gasto de movilidad de trabajadores (art. 37 inc. a.1).
 */
export interface CargoContext {
  idx: number
  /** Origen del cargo en el comprobante: 'otrosTributos' | 'otrosCargos'. */
  concepto: string
  monto: number
  proveedor?: string
  descripcion?: string
  items?: string[]
  leyendas?: string
  observaciones?: string
}

export function buildDeducibilidadPrompt(cargos: CargoContext[]): string {
  const cargosText = cargos
    .map(
      c => `${c.idx}. Concepto: ${c.concepto} | Monto: S/ ${c.monto}
   Proveedor: ${c.proveedor || 'desconocido'}
   Descripción del gasto: ${c.descripcion || 'sin descripción'}
   Items del comprobante: ${(c.items ?? []).join('; ') || 'sin detalle'}
   Leyendas: ${c.leyendas || '-'}
   Observaciones: ${c.observaciones || '-'}`
    )
    .join('\n\n')

  return `Eres un contador público peruano experto en el Impuesto a la Renta (TUO de la Ley del Impuesto a la Renta, vigente a 2026).

Cada entrada es un cargo adicional (distinto al IGV) que aparece en una factura de gastos de viáticos. Determina si el cargo es DEDUCIBLE o NO DEDUCIBLE para el impuesto a la renta.

CLASIFICACIÓN DE GASTOS NO DEDUCIBLES (serie de control interno):
| Serie | Motivo |
|-------|--------|
| 0001  | Documentación sustentatoria que no cumple requisitos y características del Reglamento de Comprobantes de Pago (art. 44 inc. j) |
| 0003  | Multas, recargos, intereses moratorios previstos en el Código Tributario y sanciones aplicadas por el Sector Público (art. 44 inc. c) |
| 0008  | Exceso de gasto de movilidad de trabajadores (art. 37 inc. a.1) |

CARGOS A CLASIFICAR:
${cargosText}

INSTRUCCIONES:
- Cargos operativos normales (comisiones, portes, seguros, embalaje, delivery, propinas de servicio facturadas, tributos municipales trasladados como parte del servicio) son DEDUCIBLES.
- Multas, intereses moratorios, recargos del Código Tributario o sanciones del Sector Público son NO DEDUCIBLES con serie 0003.
- Si el cargo evidencia un documento que no cumple requisitos del Reglamento de Comprobantes de Pago, es NO DEDUCIBLE con serie 0001.
- Excesos de movilidad de trabajadores son NO DEDUCIBLES con serie 0008.
- Si el contexto es insuficiente para afirmar que NO es deducible, clasifícalo como deducible.
- Responde ÚNICAMENTE con un JSON array, sin texto adicional ni markdown:

[{"idx":1,"deducible":true,"serie":null},{"idx":2,"deducible":false,"serie":"0003"}]`
}
