import * as fs from 'fs'
import * as path from 'path'
import * as ExcelJS from 'exceljs'
import {
  CONTANET_COLUMNS,
  ContanetLine,
  FIRST_DATA_COL_INDEX,
  COL_GRUPO,
  COL_OBLIGATORIO,
  COL_TIPO_DATO,
  COL_CARACTERES,
} from './contanet-columns'
import { AsientoTipo } from './accounting-entries.types'

const TEMPLATE_MAP: Record<string, string> = {
  compra: 'compras.xlsm',
  aplicacion: 'aplicacion.xlsm',
  solicitud: 'aplicacion.xlsm',
  devolucion: 'reembolso.xlsm',
  reembolso: 'reembolso.xlsm',
}

export function resolveTemplatePath(tipo?: AsientoTipo): string | null {
  if (!tipo) return null
  const file = TEMPLATE_MAP[tipo]
  if (!file) return null
  // Assets compiled to dist/docs/asientos/ by nest-cli.json; fall back to src location for ts-node runs.
  const candidates = [
    path.join(process.cwd(), 'dist', 'docs', 'asientos', file),
    path.join(process.cwd(), 'src', 'docs', 'asientos', file),
  ]
  return candidates.find(p => fs.existsSync(p)) ?? null
}

/** Bytes del template cacheados en memoria (se leen del disco una sola vez). */
const TEMPLATE_BUFFER_CACHE = new Map<string, Buffer>()

function readTemplateBuffer(templatePath: string): Buffer {
  const cached = TEMPLATE_BUFFER_CACHE.get(templatePath)
  if (cached) return cached
  const buffer = fs.readFileSync(templatePath)
  TEMPLATE_BUFFER_CACHE.set(templatePath, buffer)
  return buffer
}

/**
 * Construye la matriz (array de arrays) que replica la hoja `sheet1` del template
 * de Contanet: encabezados en filas 2-8 y datos a partir de la fila 9.
 * El índice 0 del arreglo exterior es la fila 1 (vacía).
 * Usado como fallback cuando no hay template disponible.
 */
export function buildContanetAoa(lines: ContanetLine[]): (string | number)[][] {
  const totalCols = FIRST_DATA_COL_INDEX + CONTANET_COLUMNS.length
  const emptyRow = (): (string | number)[] => new Array(totalCols).fill('')

  const aoa: (string | number)[][] = []

  // Fila 1: vacía
  aoa.push(emptyRow())

  // Fila 2: zona a importar
  const row2 = emptyRow()
  row2[1] = 'Zona Límite a  Importar' // B
  row2[2] = 'CONTABILIDAD' // C
  aoa.push(row2)

  // Fila 3: información obligatoria (marca «(*)» por columna)
  const row3 = emptyRow()
  row3[2] = 'Información Obligatoria'
  CONTANET_COLUMNS.forEach((c, i) => {
    if (COL_OBLIGATORIO.has(c.key)) row3[FIRST_DATA_COL_INDEX + i] = '(*)'
  })
  aoa.push(row3)

  // Fila 4: tipo de dato por columna
  const row4 = emptyRow()
  row4[2] = 'Tipo de Dato'
  CONTANET_COLUMNS.forEach((c, i) => {
    row4[FIRST_DATA_COL_INDEX + i] = COL_TIPO_DATO[c.key] ?? 'Texto'
  })
  aoa.push(row4)

  // Fila 5: cantidad de caracteres por columna
  const row5 = emptyRow()
  row5[2] = 'Cantidad Caracteres'
  CONTANET_COLUMNS.forEach((c, i) => {
    const v = COL_CARACTERES[c.key]
    if (v !== undefined) row5[FIRST_DATA_COL_INDEX + i] = v
  })
  aoa.push(row5)

  // Fila 6: descripción / grupos (etiqueta al inicio de cada grupo)
  const row6 = emptyRow()
  row6[2] = 'Descripción'
  CONTANET_COLUMNS.forEach((c, i) => {
    if (COL_GRUPO[c.key]) row6[FIRST_DATA_COL_INDEX + i] = COL_GRUPO[c.key]
  })
  aoa.push(row6)

  // Fila 7: encabezados amigables
  const row7 = emptyRow()
  CONTANET_COLUMNS.forEach((c, i) => {
    row7[FIRST_DATA_COL_INDEX + i] = c.h7
  })
  aoa.push(row7)

  // Fila 8: encabezados técnicos
  const row8 = emptyRow()
  CONTANET_COLUMNS.forEach((c, i) => {
    row8[FIRST_DATA_COL_INDEX + i] = c.h8
  })
  aoa.push(row8)

  // Filas 9+: datos
  for (const line of lines) {
    const row = emptyRow()
    CONTANET_COLUMNS.forEach((c, i) => {
      const v = line[c.key]
      row[FIRST_DATA_COL_INDEX + i] = v === undefined || v === null ? '' : v
    })
    aoa.push(row)
  }

  return aoa
}

/**
 * Genera un buffer .xlsx con los asientos de Contanet.
 * Si existe un template xlsm para el tipo, lo carga con ExcelJS (que preserva
 * correctamente los estilos, colores y bordes) e inyecta los datos a partir
 * de la fila 9. Si no hay template, genera un xlsx plano desde cero.
 */
export async function buildContanetWorkbook(
  lines: ContanetLine[],
  sheetName = 'CONTABILIDAD',
  tipo?: AsientoTipo
): Promise<Buffer> {
  const templatePath = resolveTemplatePath(tipo)

  if (templatePath) {
    // Use `let` so we can null the workbook in finally to help GC
    // release the large in-memory DOM before the next tipo iteration.
    let workbook: ExcelJS.Workbook | null = new ExcelJS.Workbook()
    try {
      await workbook.xlsx.load(readTemplateBuffer(templatePath) as any)

      const worksheet = workbook.getWorksheet(sheetName)

      if (worksheet) {
        const firstCol = FIRST_DATA_COL_INDEX + 1
        const lastRow = worksheet.lastRow?.number ?? 8

        const refStyles: Array<Record<string, any>> = []
        if (lastRow >= 9) {
          const refRow = worksheet.getRow(9)
          CONTANET_COLUMNS.forEach((_, colIdx) => {
            const cell = refRow.getCell(firstCol + colIdx)
            refStyles.push({
              font: cell.font ? { ...cell.font } : undefined,
              alignment: cell.alignment ? { ...cell.alignment } : undefined,
              numFmt: cell.numFmt || undefined,
            })
          })
          worksheet.spliceRows(9, lastRow - 8)
        }

        lines.forEach((line, idx) => {
          const row = worksheet.getRow(9 + idx)
          CONTANET_COLUMNS.forEach((col, colIdx) => {
            const v = line[col.key]
            const cell = row.getCell(firstCol + colIdx)
            cell.value = v === undefined || v === null ? null : v
            const style = refStyles[colIdx]
            if (style) {
              if (style.font) cell.font = style.font
              if (style.alignment) cell.alignment = style.alignment
              if (style.numFmt) cell.numFmt = style.numFmt
            }
          })
          row.commit()
        })

        const rawBuffer = await workbook.xlsx.writeBuffer()
        return Buffer.from(rawBuffer as ArrayBuffer)
      }
    } finally {
      workbook = null
    }
  }

  // Fallback: generar sin template (sin estilos)
  const xlsx = await import('xlsx')
  const aoa = buildContanetAoa(lines)
  const ws = xlsx.utils.aoa_to_sheet(aoa)
  const wb = xlsx.utils.book_new()
  xlsx.utils.book_append_sheet(wb, ws, sheetName)
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
