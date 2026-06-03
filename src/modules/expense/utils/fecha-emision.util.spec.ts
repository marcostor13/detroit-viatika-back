import {
  formatFechaEmisionDdMmYyyy,
  parseFechaEmisionInput,
  normalizeFechaEmisionInDataJson,
} from './fecha-emision.util'

describe('fecha-emision.util', () => {
  it('parsea dd-MM-yyyy como día/mes/año', () => {
    const d = parseFechaEmisionInput('05-01-2026')
    expect(d?.getUTCFullYear()).toBe(2026)
    expect(d?.getUTCMonth()).toBe(0)
    expect(d?.getUTCDate()).toBe(5)
  })

  it('parsea dd/MM/yyyy', () => {
    expect(formatFechaEmisionDdMmYyyy('05/01/2026')).toBe('05/01/2026')
  })

  it('formatea yyyy-MM-dd a dd/MM/yyyy', () => {
    expect(formatFechaEmisionDdMmYyyy('2026-01-05')).toBe('05/01/2026')
  })

  it('no confunde dd-MM-yyyy con formato US (evita 01 may)', () => {
    expect(formatFechaEmisionDdMmYyyy('05-01-2026')).toBe('05/01/2026')
  })

  it('normaliza fechaEmision dentro de data JSON', () => {
    const out = normalizeFechaEmisionInDataJson(
      JSON.stringify({ fechaEmision: '05-01-2026', serie: 'F001' })
    )
    const parsed = JSON.parse(out!)
    expect(parsed.fechaEmision).toBe('05/01/2026')
  })
})
