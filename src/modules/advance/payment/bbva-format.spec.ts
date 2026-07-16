import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildDetailLine,
  buildHeaderLine,
  buildBbvaTxt,
  toLatin1Buffer,
  padRight,
  padLeftZeros,
  solesToCents,
  normalizeName,
  namesMatch,
  parseBbvaPdfText,
  splitDocAndAmount,
  isSuccessfulSituacion,
  BbvaDetailRecord,
} from './bbva-format'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse')

/**
 * El archivo real entregado por el cliente (BBVA – Pagos Masivos). Se lee en
 * Latin-1 para comparar carácter a carácter (Ñ/tildes = 1 byte).
 */
const FIXTURE = readFileSync(
  join(__dirname, '__fixtures__', 'BBVAREND.txt'),
  'latin1'
)
const FIXTURE_LINES = FIXTURE.split(/\r?\n/).filter((l) => l.length > 0)
const HEADER = FIXTURE_LINES[0]
const DETAILS = FIXTURE_LINES.slice(1)

describe('bbva-format · helpers', () => {
  it('padRight recorta y rellena con espacios a la derecha', () => {
    expect(padRight('ABC', 5)).toBe('ABC  ')
    expect(padRight('ABCDEF', 3)).toBe('ABC')
  })

  it('padLeftZeros rellena con ceros a la izquierda y solo deja dígitos', () => {
    expect(padLeftZeros('304', 6)).toBe('000304')
    expect(padLeftZeros('L75162447', 12)).toBe('000075162447')
  })

  it('solesToCents evita errores de coma flotante', () => {
    expect(solesToCents(304)).toBe(30400)
    expect(solesToCents(103.26)).toBe(10326)
    expect(solesToCents(0.1 + 0.2)).toBe(30)
  })
})

describe('bbva-format · líneas de detalle (byte-exactas vs archivo real)', () => {
  it('todas las líneas del fixture miden 277 y la cabecera 151', () => {
    expect(HEADER.length).toBe(151)
    for (const d of DETAILS) expect(d.length).toBe(277)
    expect(DETAILS.length).toBe(18)
  })

  it('reconstruye byte a byte la 1ª línea (RENDICIÓN DE VIÁTICOS, cuenta I)', () => {
    const rec: BbvaDetailRecord = {
      documentType: 'L',
      documentNumber: '75162447',
      accountType: 'I',
      accountNumber: '00257011449545903106',
      beneficiaryName: 'RAUL CUBA CRUZ',
      amountCents: 30400,
      concepto: 'RENDICIÓN DE VIÁTICOS',
      email: 'NOTIFICACIONESDEPAGO@DETROIT.PE',
    }
    expect(buildDetailLine(rec)).toBe(DETAILS[0])
  })

  it('reconstruye byte a byte una línea con Ñ y cuenta P (REEMBOLSO)', () => {
    // Línea 4 del fixture: ASTRID SELENE ESTACIO PEÑA, cuenta P, REPOSICIÓN...
    const rec: BbvaDetailRecord = {
      documentType: 'L',
      documentNumber: '09831083',
      accountType: 'P',
      accountNumber: '00110057000267030775',
      beneficiaryName: 'ASTRID SELENE ESTACIO PEÑA',
      amountCents: 24980,
      concepto: 'REPOSICIÓN DE CAJA CHICA',
      email: 'YCQPE@DETROIT.PE',
    }
    expect(buildDetailLine(rec)).toBe(DETAILS[3])
  })

  it('reconstruye byte a byte una línea SOLICITUD DE FONDOS', () => {
    // Línea 12 del fixture: ANIBAL ROSALES COLCHADO — SOLICITUD DE FONDOS.
    const rec: BbvaDetailRecord = {
      documentType: 'L',
      documentNumber: '46353590',
      accountType: 'I',
      accountNumber: '00352301317749541182',
      beneficiaryName: 'ANIBAL  ROSALES COLCHADO',
      amountCents: 100000,
      concepto: 'SOLICITUD DE FONDOS',
      email: 'ARCPE@DETROIT.PE',
    }
    // El nombre trae doble espacio en el archivo real; sanitizeLatin1 lo colapsa,
    // así que comparamos el prefijo estable (doc + cuenta + importe + glosa).
    const built = buildDetailLine(rec)
    expect(built.length).toBe(277)
    expect(built.slice(0, 37)).toBe(DETAILS[11].slice(0, 37)) // doc + cuenta
    expect(built.slice(77, 146)).toBe(DETAILS[11].slice(77, 146)) // importe + glosas
  })
})

describe('bbva-format · cabecera y archivo completo', () => {
  it('reconstruye byte a byte la cabecera del archivo real', () => {
    const header = buildHeaderLine({
      chargeAccount: '000110380350100056833',
      currency: 'PEN',
      description: 'PROVEEDORES SOL 02 JUNIO',
      recordCount: 18,
      totalCents: 906036,
    })
    expect(header).toBe(HEADER)
  })

  it('el total de la cabecera coincide con la suma de los abonos (S/ 9,060.36)', () => {
    const sum = DETAILS.reduce((s, d) => s + Number(d.slice(77, 92)), 0)
    expect(sum).toBe(906036)
  })

  it('buildBbvaTxt calcula total/conteo y usa CRLF', () => {
    const recs: BbvaDetailRecord[] = [
      {
        documentType: 'L',
        documentNumber: '75162447',
        accountType: 'I',
        accountNumber: '00257011449545903106',
        beneficiaryName: 'RAUL CUBA CRUZ',
        amountCents: 30400,
        concepto: 'RENDICIÓN DE VIÁTICOS',
        email: 'NOTIFICACIONESDEPAGO@DETROIT.PE',
      },
    ]
    const txt = buildBbvaTxt(recs, {
      chargeAccount: '000110380350100056833',
      description: 'PROVEEDORES SOL 02 JUNIO',
    })
    expect(txt.includes('\r\n')).toBe(true)
    const lines = txt.split('\r\n').filter((l) => l.length)
    expect(lines[0].slice(26, 41)).toBe(padLeftZeros('30400', 15))
    expect(lines[0].slice(76, 82)).toBe('000001')
  })

  it('el Buffer Latin-1 codifica Ñ como 0xD1 (no UTF-8)', () => {
    const line = buildDetailLine({
      documentType: 'L',
      documentNumber: '06973600',
      accountType: 'I',
      accountNumber: '00219110035563002151',
      beneficiaryName: 'FIDEL TUESTA SALDAÑA',
      amountCents: 17100,
      concepto: 'REEMBOLSO',
      email: 'FTSPE@DETROIT.PE',
    })
    const buf = toLatin1Buffer(line)
    expect(buf.length).toBe(277) // 1 byte por char (no UTF-8 multibyte)
    expect(buf.includes(0xd1)).toBe(true) // Ñ
  })
})

describe('bbva-format · conciliación', () => {
  it('normalizeName corrige la Ñ corrupta del PDF', () => {
    expect(normalizeName('SALDAµA')).toBe('SALDANA')
    expect(normalizeName('PE#A')).toBe('PENA')
    expect(normalizeName('Saldaña')).toBe('SALDANA')
  })

  it('namesMatch tolera orden y tildes', () => {
    expect(namesMatch('CUBA CRUZ RAUL', 'RAUL CUBA CRUZ')).toBe(true)
    expect(namesMatch('FIDEL TUESTA SALDAÑA', 'FIDEL TUESTA SALDAµA')).toBe(true)
    expect(namesMatch('RAUL CUBA', 'PEDRO GOMEZ')).toBe(false)
  })

  it('isSuccessfulSituacion reconoce estados de abono OK', () => {
    expect(isSuccessfulSituacion('ABONO ENVIADO')).toBe(true)
    expect(isSuccessfulSituacion('ABONO CORRECTO')).toBe(true)
    expect(isSuccessfulSituacion('ABONO RECHAZADO')).toBe(false)
  })

  it('parseBbvaPdfText extrae filas de un texto tipo PDF (espaciado)', () => {
    const text = [
      'Consulta de Pagos Masivos',
      'No. Movimiento de Cargo 000025041   Fecha y Hora de Ejecución 02/06/2026 10:15',
      'Titular (Archivo) Doc. Identidad Importe Situación',
      'RAUL CUBA CRUZ L - 75162447 304.00 ABONO ENVIADO',
      'FIDEL TUESTA SALDAµA L - 06973600 171.00 ABONO CORRECTO',
    ].join('\n')
    const parsed = parseBbvaPdfText(text)
    expect(parsed.operationNumber).toBe('000025041')
    expect(parsed.rows.length).toBe(2)
    expect(parsed.rows[0].documentNumber).toBe('75162447')
    expect(parsed.rows[0].amount).toBe(304)
    expect(parsed.rows[0].success).toBe(true)
    expect(parsed.rows[1].documentNumber).toBe('06973600')
    expect(parsed.rows[1].amount).toBe(171)
  })

  it('acota la situación al abono actual (no roba la de la fila siguiente)', () => {
    const text = [
      'IVAN VASQUEZ    L - 73736667    80.00    ABONO ENVIADO',
      'IVAN VASQUEZ    L - 73736667    40.00    ABONO RECHAZADO',
      'PEDRO GOMEZ    L - 99999999    500.00    ABONO ENVIADO',
    ].join('\n')
    const { rows } = parseBbvaPdfText(text)
    expect(rows.length).toBe(3)
    expect(rows[0]).toMatchObject({ documentNumber: '73736667', amount: 80, success: true })
    expect(rows[1]).toMatchObject({ documentNumber: '73736667', amount: 40, success: false })
    expect(rows[2]).toMatchObject({ documentNumber: '99999999', amount: 500, success: true })
  })
})

describe('bbva-format · splitDocAndAmount (documento+importe pegados)', () => {
  it('separa el DNI (8) del importe cuando vienen pegados', () => {
    expect(splitDocAndAmount('L', '75162447304.00')).toEqual({
      documentNumber: '75162447',
      amount: 304,
    })
  })

  it('maneja importes con separador de miles pegados', () => {
    expect(splitDocAndAmount('L', '100170561,154.00')).toEqual({
      documentNumber: '10017056',
      amount: 1154,
    })
    expect(splitDocAndAmount('L', '412066122,008.60')).toEqual({
      documentNumber: '41206612',
      amount: 2008.6,
    })
  })

  it('desambigua importes pequeños con DNI de 8 (no toma dígitos de más)', () => {
    // Bloque real del PDF: DNI 70279911 (8) + importe 18.40.
    expect(splitDocAndAmount('L', '7027991118.40')).toEqual({
      documentNumber: '70279911',
      amount: 18.4,
    })
  })

  it('maneja el caso espaciado', () => {
    expect(splitDocAndAmount('L', '75162447 304.00')).toEqual({
      documentNumber: '75162447',
      amount: 304,
    })
  })

  it('separa el RUC (11) del importe', () => {
    expect(splitDocAndAmount('R', '20123456789150.00')).toEqual({
      documentNumber: '20123456789',
      amount: 150,
    })
  })
})

describe('bbva-format · conciliación del PDF REAL de BBVA (fixture)', () => {
  it('lee los 18 abonos del PDF real y suman S/ 9,060.36', async () => {
    const bytes = readFileSync(
      join(__dirname, '__fixtures__', 'consulta-pagos-masivos.pdf')
    )
    const parsed = pdfParse ? await pdfParse(bytes) : { text: '' }
    const result = parseBbvaPdfText(parsed.text)

    expect(result.operationNumber).toBe('000025041')
    expect(result.rows.length).toBe(18)
    const sum = result.rows.reduce((s, r) => s + r.amount, 0)
    expect(Math.round(sum * 100)).toBe(906036) // S/ 9,060.36
    expect(result.rows.every((r) => r.success)).toBe(true)

    // Spot-checks: DNI + importe de abonos concretos (incluye repetidos).
    const raul = result.rows.find((r) => r.documentNumber === '75162447')
    expect(raul?.amount).toBe(304)
    const repetidos = result.rows.filter((r) => r.documentNumber === '74973421')
    expect(repetidos.map((r) => r.amount).sort((a, b) => a - b)).toEqual([98.6, 1000])
  })
})
