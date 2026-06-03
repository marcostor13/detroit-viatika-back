/**
 * Normaliza fechas de emisión de comprobantes a formato de visualización dd/MM/yyyy.
 * Acepta entradas dd-MM-yyyy, dd/MM/yyyy, yyyy-MM-dd e ISO Date.
 */

export function parseFechaEmisionInput(
  raw?: string | Date | null
): Date | null {
  if (raw == null) return null

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null
    return new Date(
      Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate())
    )
  }

  const clean = String(raw).trim()
  if (!clean) return null

  const isoDatePrefix = clean.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoDatePrefix) {
    return new Date(
      Date.UTC(
        Number(isoDatePrefix[1]),
        Number(isoDatePrefix[2]) - 1,
        Number(isoDatePrefix[3])
      )
    )
  }

  const ymdMatch = clean.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/)
  if (ymdMatch) {
    return new Date(
      Date.UTC(Number(ymdMatch[1]), Number(ymdMatch[2]) - 1, Number(ymdMatch[3]))
    )
  }

  const dmyMatch = clean.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/)
  if (dmyMatch) {
    return new Date(
      Date.UTC(Number(dmyMatch[3]), Number(dmyMatch[2]) - 1, Number(dmyMatch[1]))
    )
  }

  const parsed = new Date(clean)
  if (Number.isNaN(parsed.getTime())) return null
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
  )
}

/** Formato canónico de emisión para API y persistencia: dd/MM/yyyy */
export function formatFechaEmisionDdMmYyyy(
  raw?: string | Date | null
): string | undefined {
  const d = parseFechaEmisionInput(raw)
  if (!d) return undefined
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const year = d.getUTCFullYear()
  return `${day}/${month}/${year}`
}

export function normalizeFechaEmisionInDataJson(
  dataJson?: string | null
): string | undefined {
  if (!dataJson) return dataJson ?? undefined
  try {
    const obj = JSON.parse(dataJson) as Record<string, unknown>
    if (obj.fechaEmision != null) {
      const normalized = formatFechaEmisionDdMmYyyy(
        obj.fechaEmision as string | Date
      )
      if (normalized) obj.fechaEmision = normalized
    }
    return JSON.stringify(obj)
  } catch {
    return dataJson
  }
}

export function applyFechaEmisionDisplayToExpense<
  T extends { fechaEmision?: unknown; data?: unknown },
>(expense: T): T {
  if (!expense) return expense

  // Mongoose Documents almacenan los campos del schema en `_doc` y los exponen
  // vía getters del prototipo. `{ ...doc }` sólo copia `$__` y `_doc`, dejando
  // afuera `clientId`, `createdBy`, etc. y rompiendo verificaciones posteriores.
  const maybeDoc = expense as unknown as { toObject?: () => T }
  const source: T =
    typeof maybeDoc.toObject === 'function' ? maybeDoc.toObject() : expense
  const copy = { ...source } as T & { fechaEmision?: string; data?: unknown }
  const fromRoot = formatFechaEmisionDdMmYyyy(
    copy.fechaEmision as string | Date | undefined
  )

  let fromData: string | undefined
  const rawData = copy.data
  if (rawData != null) {
    try {
      const isString = typeof rawData === 'string'
      const obj = (
        isString ? JSON.parse(rawData as string) : rawData
      ) as Record<string, unknown>
      fromData = formatFechaEmisionDdMmYyyy(
        obj?.fechaEmision as string | Date | undefined
      )
      if (fromData) {
        obj.fechaEmision = fromData
        copy.data = isString ? JSON.stringify(obj) : obj
      }
    } catch {
      /* mantener data original */
    }
  }

  const normalized = fromRoot ?? fromData
  if (normalized) copy.fechaEmision = normalized

  return copy as T
}

export function applyFechaEmisionDisplayToExpenses<
  T extends { fechaEmision?: unknown; data?: unknown },
>(expenses: T[] | undefined | null): T[] {
  if (!Array.isArray(expenses)) return []
  return expenses.map(applyFechaEmisionDisplayToExpense)
}
