import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common'
import { Observable, TimeoutError, throwError } from 'rxjs'
import { catchError, timeout } from 'rxjs/operators'

/**
 * Devuelve HTTP 408 si el handler no responde dentro del plazo.
 * Colocarlo en el controller es suficiente para que NestJS devuelva la
 * respuesta (con headers CORS) ANTES de que nginx corte la conexión por
 * proxy_read_timeout, evitando el "0 Unknown Error" en el cliente.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly ms: number) {}

  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.ms),
      catchError(err => {
        if (err instanceof TimeoutError) {
          throw new RequestTimeoutException(
            'La operación tardó demasiado. Inténtalo de nuevo.'
          )
        }
        return throwError(() => err)
      })
    )
  }
}
