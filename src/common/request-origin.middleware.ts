import { Injectable, NestMiddleware } from '@nestjs/common'
import { Request, Response, NextFunction } from 'express'
import { runWithRequestOrigin, toOrigin } from './request-origin.context'

/**
 * Deja disponible el origen del front durante toda la petición (ver
 * `request-origin.context.ts`).
 *
 * `Origin` lo manda el navegador en peticiones cross-origin —el caso normal
 * aquí, porque el front y la API viven en dominios distintos—. Si falta se usa
 * `Referer`, del que solo se conserva el origen. Ambas cabeceras las controla
 * el cliente, así que este middleware NO decide si son de fiar: solo las
 * transporta. La validación contra la lista de orígenes permitidos ocurre en
 * `EmailService.getPublicAppBaseUrl()`, justo antes de escribir el enlace.
 */
@Injectable()
export class RequestOriginMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const origin =
      toOrigin(req.headers.origin) || toOrigin(req.headers.referer)
    runWithRequestOrigin(origin, () => next())
  }
}
