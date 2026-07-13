/**
 * Formato de archivo BBVA — Pagos Masivos / Pago a Proveedores (BBVA Net Cash).
 *
 * Módulo PURO (sin dependencias de Nest/Mongo) para poder testearlo byte a byte
 * contra el archivo real entregado por el cliente (`__fixtures__/BBVAREND.txt`).
 *
 * Hechos del formato (verificados con el archivo real — ver docs/formato-txt-banco.md):
 *  - Texto de ANCHO FIJO (no delimitado). Sin separadores.
 *  - Codificación Latin-1 / Windows-1252 (Ñ y tildes en 1 byte). NO UTF-8.
 *  - Fin de línea CRLF.
 *  - Cabecera: 1 línea de 151 chars, empieza con `75`.
 *  - Detalle: 1 línea por beneficiario de 277 chars, empieza con `002`.
 *  - Importe en céntimos, entero, alineado a la derecha con ceros.
 *  - Textos alineados a la izquierda, rellenados con espacios.
 *  - Glosa corta = glosa larga truncada a 12.
 */

export type BbvaDocType = 'R' | 'L' | 'P' | 'E' | 'M'
export type BbvaAccountType = 'I' | 'P'

/** Un abono (línea de detalle) a generar. */
export interface BbvaDetailRecord {
  /** Tipo de documento: R=RUC, L=DNI, P=Pasaporte, E=C.Extranjería, M=C.Id.Militar. */
  documentType: BbvaDocType
  /** N° de documento (se recorta/rellena a 12). */
  documentNumber: string
  /** Tipo de cuenta: I=Interbancaria (CCI otro banco), P=Propia BBVA. */
  accountType: BbvaAccountType
  /** N° de cuenta / CCI de 20 dígitos. */
  accountNumber: string
  /** Nombre del beneficiario (mayúsculas, se recorta/rellena a 40). */
  beneficiaryName: string
  /** Importe en céntimos (entero). */
  amountCents: number
  /** Glosa larga / concepto (ej. `RENDICIÓN DE VIÁTICOS`, `REEMBOLSO`, `SOLICITUD DE FONDOS`). */
  concepto: string
  /** Email de aviso del beneficiario. */
  email: string
}

export interface BbvaHeaderMeta {
  /** Cuenta de cargo de la empresa (Client.paymentAccount). Se rellena a 21. */
  chargeAccount: string
  /** Moneda ISO (default PEN). */
  currency?: string
  /** Descripción de la planilla (ej. `PROVEEDORES SOL 02 JUNIO`). Máx. 24. */
  description: string
  /** N° de registros de detalle. */
  recordCount: number
  /** Importe total en céntimos. */
  totalCents: number
}

// ── Anchos de campo (detalle) ────────────────────────────────────────────────
const DETAIL_LEN = 277
const HEADER_LEN = 151
const W = {
  docNumber: 12,
  accountNumber: 20,
  beneficiary: 40,
  amount: 15,
  glosaCorta: 12,
  glosaLarga: 40,
  email: 80,
  reserved: 32, // pos 228-259 (ceros)
  detailFiller: 18, // pos 260-277 (espacios)
} as const

// ── Helpers de relleno ───────────────────────────────────────────────────────

/** Recorta a `len` y rellena con espacios a la derecha (texto alineado a izq). */
export function padRight(value: string, len: number): string {
  const s = (value ?? '').slice(0, len)
  return s + ' '.repeat(Math.max(len - s.length, 0))
}

/** Rellena con ceros a la izquierda (números). Recorta por la izquierda si excede. */
export function padLeftZeros(value: string, len: number): string {
  const digits = (value ?? '').replace(/\D/g, '')
  if (digits.length >= len) return digits.slice(digits.length - len)
  return '0'.repeat(len - digits.length) + digits
}

/**
 * Sanitiza textos para el archivo: mayúsculas y sin caracteres no representables
 * en Latin-1. Conserva Ñ y tildes (el archivo real las trae). Colapsa espacios y
 * quita saltos/controles.
 */
export function sanitizeLatin1(value: string): string {
  return (value ?? '')
    .toUpperCase()
    .replace(/[\r\n\t]+/g, ' ')
    // Elimina cualquier carácter fuera del rango imprimible Latin-1.
    .replace(/[^\x20-\xFF]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Convierte soles (number) a céntimos enteros de forma segura. */
export function solesToCents(amount: number): number {
  return Math.round(Number(amount ?? 0) * 100)
}

// ── Construcción de líneas ───────────────────────────────────────────────────

/** Construye una línea de DETALLE (277 chars). */
export function buildDetailLine(rec: BbvaDetailRecord): string {
  const concepto = sanitizeLatin1(rec.concepto)
  const glosaCorta = concepto.slice(0, W.glosaCorta)

  const line =
    '00' + // pos 1-2  filler
    '2' + // pos 3    tipo registro detalle
    rec.documentType + // pos 4    tipo doc
    padRight(rec.documentNumber.trim(), W.docNumber) + // pos 5-16
    rec.accountType + // pos 17   tipo cuenta
    padRight(padLeftZeros(rec.accountNumber, W.accountNumber), W.accountNumber) + // pos 18-37
    padRight(sanitizeLatin1(rec.beneficiaryName), W.beneficiary) + // pos 38-77
    padLeftZeros(String(Math.max(0, Math.round(rec.amountCents))), W.amount) + // pos 78-92
    'F' + // pos 93   flag glosa corta
    padRight(glosaCorta, W.glosaCorta) + // pos 94-105
    'N' + // pos 106  flag glosa larga
    padRight(concepto, W.glosaLarga) + // pos 107-146
    'E' + // pos 147  flag email
    padRight(sanitizeLatin1(rec.email), W.email) + // pos 148-227
    '0'.repeat(W.reserved) + // pos 228-259 reservado
    ' '.repeat(W.detailFiller) // pos 260-277 filler

  if (line.length !== DETAIL_LEN) {
    throw new Error(
      `Línea de detalle con longitud inválida (${line.length} ≠ ${DETAIL_LEN}) para ${rec.beneficiaryName}`
    )
  }
  return line
}

/** Construye la línea de CABECERA (151 chars). */
export function buildHeaderLine(meta: BbvaHeaderMeta): string {
  const currency = (meta.currency ?? 'PEN').slice(0, 3)
  const line =
    '75' + // pos 1-2   prefijo cabecera
    padRight(padLeftZeros(meta.chargeAccount, 21), 21) + // pos 3-23  cuenta de cargo
    currency + // pos 24-26 moneda
    padLeftZeros(String(Math.max(0, Math.round(meta.totalCents))), 15) + // pos 27-41 total céntimos
    'A' + // pos 42    flag
    ' '.repeat(9) + // pos 43-51
    padRight(sanitizeLatin1(meta.description), 24) + // pos 52-75 descripción
    ' ' + // pos 76
    padLeftZeros(String(meta.recordCount), 6) + // pos 77-82 N° registros
    'S' + // pos 83    flag
    '0'.repeat(18) + // pos 84-101
    ' '.repeat(50) // pos 102-151

  if (line.length !== HEADER_LEN) {
    throw new Error(
      `Cabecera con longitud inválida (${line.length} ≠ ${HEADER_LEN})`
    )
  }
  return line
}

/**
 * Construye el contenido completo del archivo (cabecera + detalles), unido con
 * CRLF. El total y el conteo de la cabecera se calculan de los registros, salvo
 * que se pasen explícitos en `metaOverride`.
 */
export function buildBbvaTxt(
  records: BbvaDetailRecord[],
  metaOverride: Omit<BbvaHeaderMeta, 'recordCount' | 'totalCents'> &
    Partial<Pick<BbvaHeaderMeta, 'recordCount' | 'totalCents'>>
): string {
  const totalCents =
    metaOverride.totalCents ??
    records.reduce((s, r) => s + Math.round(r.amountCents), 0)
  const recordCount = metaOverride.recordCount ?? records.length
  const header = buildHeaderLine({ ...metaOverride, totalCents, recordCount })
  const details = records.map(buildDetailLine)
  return [header, ...details].join('\r\n') + '\r\n'
}

/** Codifica el texto del archivo a un Buffer Latin-1 (Windows-1252). */
export function toLatin1Buffer(txt: string): Buffer {
  return Buffer.from(txt, 'latin1')
}

// ── Conciliación del PDF de retorno ──────────────────────────────────────────

export interface BbvaPdfRow {
  /** Titular tal como lo devuelve el PDF (ya normalizado para comparar). */
  titular: string
  /** DNI / número de documento extraído (solo dígitos). */
  documentNumber: string
  /** Importe en soles (2 decimales). */
  amount: number
  /** Situación (ABONO ENVIADO / ABONO CORRECTO / etc.). */
  situacion: string
  /** true si la situación indica abono exitoso. */
  success: boolean
}

export interface BbvaPdfSummary {
  rows: BbvaPdfRow[]
  /** N° de movimiento de cargo (N° de operación del lote), si se detecta. */
  operationNumber?: string
  /** Fecha/hora de ejecución del lote, si se detecta. */
  executedAt?: string
}

/**
 * Normaliza un nombre para comparar: mayúsculas, sin tildes, sin caracteres no
 * alfanuméricos, espacios colapsados. Corrige la corrupción de Ñ que el PDF de
 * BBVA suele traer (`SALDAµA`, `PE#A` → `SALDANA`, `PENA`).
 */
export function normalizeName(value: string): string {
  return (value ?? '')
    // Ñ corrupta en el PDF: µ (0xB5) y # aparecen en lugar de Ñ. Se corrige ANTES
    // de mayúsculas porque `'µ'.toUpperCase()` en JS devuelve la Mu griega (U+039C).
    .replace(/[µ#ÑñΜµΜ]/g, 'N')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * ¿Coinciden dos nombres? Tolerante al orden de tokens: coincide si comparten al
 * menos 2 tokens significativos, o todos los de la cadena más corta.
 */
export function namesMatch(a: string, b: string): boolean {
  const ta = normalizeName(a).split(' ').filter((t) => t.length > 2)
  const tb = normalizeName(b).split(' ').filter((t) => t.length > 2)
  if (!ta.length || !tb.length) return false
  const setB = new Set(tb)
  const shared = ta.filter((t) => setB.has(t)).length
  return shared >= 2 || shared === Math.min(ta.length, tb.length)
}

/** ¿La situación del PDF indica un abono exitoso? */
export function isSuccessfulSituacion(situacion: string): boolean {
  const s = (situacion ?? '').toUpperCase()
  return s.includes('ABONO ENVIADO') || s.includes('ABONO CORRECTO')
}

/** Longitud del número de documento por tipo (Perú): DNI=8, RUC=11. */
const DOC_LEN: Partial<Record<BbvaDocType, number>> = { L: 8, R: 11 }

/** Palabras de banco a descartar al extraer el titular del PDF. */
const BANK_WORDS =
  /CREDITO|DEL PERU|SCOTIABANK|INTERBANK|BBVA|CONTINENTAL|BANCO|PERU S\.?A|NACION|PICHINCHA|BIF/i

/**
 * El PDF de BBVA trae el documento y el importe PEGADOS en un solo bloque
 * (ej. `75162447304.00` = DNI 75162447 + 304.00; `100170561,154.00` = 10017056
 * + 1,154.00). Los separa usando la longitud fija del documento por tipo; si es
 * desconocida, toma el importe como el patrón decimal final y el resto como
 * documento.
 */
export function splitDocAndAmount(
  type: BbvaDocType,
  blob: string
): { documentNumber: string; amount: number } {
  const trimmed = (blob ?? '').trim()

  // Caso ESPACIADO: "75162447 304.00" (documento y monto separados).
  const spaced = trimmed.match(/^(\d[\d,]*)\s+(\d[\d,]*\.\d{2})$/)
  if (spaced) {
    return {
      documentNumber: spaced[1].replace(/\D/g, ''),
      amount: Number(spaced[2].replace(/,/g, '')),
    }
  }

  // Caso PEGADO: "75162447304.00" / "100170561,154.00". Separa por longitud fija
  // del documento según el tipo (DNI=8, RUC=11).
  const compact = trimmed.replace(/\s/g, '')
  const len = DOC_LEN[type]
  if (len && compact.replace(/[.,]/g, '').length > len) {
    return {
      documentNumber: compact.slice(0, len).replace(/\D/g, ''),
      amount: Number(compact.slice(len).replace(/,/g, '')),
    }
  }
  // Tipo de longitud desconocida: importe = patrón decimal final, doc = resto.
  const m = compact.match(/^(\d+?)(\d{1,3}(?:,\d{3})*\.\d{2})$/)
  if (m) return { documentNumber: m[1], amount: Number(m[2].replace(/,/g, '')) }
  return { documentNumber: '', amount: NaN }
}

/** Titular a mejor esfuerzo: líneas de solo letras antes del documento, sin bancos. */
function extractTitularBefore(before: string): string {
  const nameLines = before
    .split('\n')
    .map((s) => s.trim())
    .filter(
      (l) =>
        /^[A-ZÁÉÍÓÚÑµ#\s.]+$/.test(l) &&
        !BANK_WORDS.test(l) &&
        l.replace(/\s/g, '').length > 1
    )
  return normalizeName(nameLines.slice(-4).join(' '))
}

/**
 * Parser del texto extraído del PDF "Consulta de Pagos Masivos" de BBVA (vía
 * pdf-parse). El PDF real es MUY frágil: el documento y el importe salen pegados
 * (`L - 75162447304.00`), los nombres se parten en varias líneas y la situación
 * aparece en líneas aparte o pegada al importe (`249.80CORRECTO`). Por eso la
 * conciliación cruza por DNI+monto (no por el nombre) y admite un fallback
 * manual. Extrae, por abono: documento, importe y si el abono fue exitoso.
 */
export function parseBbvaPdfText(text: string): BbvaPdfSummary {
  const rows: BbvaPdfRow[] = []
  const clean = (text ?? '').replace(/\r/g, '')

  // N° de movimiento de cargo (N° de operación del lote).
  const opMatch =
    clean.match(/movimiento\s+de\s+cargo[^\d]*(\d{6,})/i) ||
    clean.match(/n[ºo°.]*\s*movimiento[^\d]*(\d{6,})/i)
  // Fecha de ejecución del lote (evita la fecha de emisión del reporte).
  const dateMatch =
    clean.match(
      /ejecuci[oó]n[^\d]*(\d{2}[/-]\d{2}[/-]\d{2,4}(?:\s*-?\s*\d{2}:\d{2}(?::\d{2})?)?)/i
    ) || clean.match(/(\d{2}[/-]\d{2}[/-]\d{2,4}\s+\d{2}:\d{2}(?::\d{2})?)/)

  // Documento + importe: PEGADOS ("L - 75162447304.00", "L - 100170561,154.00",
  // o con situación pegada "L - 09831083249.80CORRECTO") o ESPACIADOS
  // ("L - 75162447 304.00"). El grupo admite dígitos, comas, puntos y espacios,
  // y debe terminar en un importe con 2 decimales.
  const docRe = /([RLPEM])\s*-\s*([\d,. ]+\.\d{2})/g
  const hits: Array<{ index: number; end: number; type: BbvaDocType; blob: string }> = []
  let m: RegExpExecArray | null
  while ((m = docRe.exec(clean)) !== null) {
    hits.push({ index: m.index, end: m.index + m[0].length, type: m[1].toUpperCase() as BbvaDocType, blob: m[2] })
  }

  for (let k = 0; k < hits.length; k++) {
    const cur = hits[k]
    const { documentNumber, amount } = splitDocAndAmount(cur.type, cur.blob)
    if (!documentNumber || !Number.isFinite(amount) || amount <= 0) continue

    // Ventana de situación ACOTADA al abono actual: desde el fin del importe hasta
    // el inicio del siguiente documento (o +120 chars), para no “robar” la
    // situación de la fila siguiente. Un abono fallido gana sobre uno exitoso.
    const nextIdx = k + 1 < hits.length ? hits[k + 1].index : clean.length
    const sit = clean.slice(cur.end, Math.min(nextIdx, cur.end + 120)).toUpperCase()
    let success = false
    if (/RECHAZ|DEVUELT|NO\s*ABON|NO\s*PROCES|OBSERV|PENDIENT/.test(sit)) {
      success = false
    } else if (/ENVIAD|CORRECT|ABONAD|PROCESAD/.test(sit)) {
      success = true
    }

    // Titular ACOTADO entre el documento anterior y el actual (mejor esfuerzo).
    const prevEnd = k > 0 ? hits[k - 1].end : 0
    const titular = extractTitularBefore(
      clean.slice(Math.max(prevEnd, cur.index - 140), cur.index)
    )

    rows.push({
      titular,
      documentNumber,
      amount,
      situacion: success ? 'ABONO ENVIADO' : '',
      success,
    })
  }

  return {
    rows,
    operationNumber: opMatch?.[1],
    executedAt: dateMatch?.[1],
  }
}
