import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Origen (`scheme://host:port`) del front que disparó la petición HTTP en curso.
 *
 * Sirve para que los enlaces de los correos apunten al mismo front desde el que
 * se originó la acción: un único backend puede atender a la vez `localhost`,
 * el front de desarrollo y el de producción, y cada correo debe llevar el
 * enlace correcto sin depender de una URL fija por entorno.
 *
 * Se guarda en `AsyncLocalStorage` (API nativa de Node, sin dependencias
 * nuevas) para no tener que arrastrar el `Request` por todas las firmas hasta
 * `EmailService`. Fuera de una petición HTTP —tareas programadas, seeds— el
 * store está vacío y quien lo consulte debe recurrir a su valor por defecto.
 */
const store = new AsyncLocalStorage<{ origin: string }>()

/** Normaliza a `scheme://host[:port]`, o `''` si no es una URL utilizable. */
export function toOrigin(value?: string | null): string {
  const raw = value?.trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.origin
  } catch {
    return ''
  }
}

export function runWithRequestOrigin<T>(origin: string, fn: () => T): T {
  return store.run({ origin }, fn)
}

/** Origen del front de la petición en curso, o `''` si no hay ninguna. */
export function getRequestOrigin(): string {
  return store.getStore()?.origin ?? ''
}
