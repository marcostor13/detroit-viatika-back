import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

const ROLE_ALIASES: Record<string, string> = {
  Coordinador: 'Administrador', // backward compat for existing JWTs issued before role rename
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ])
    if (!requiredRoles || requiredRoles.length === 0) {
      return true
    }
    const request = context.switchToHttp().getRequest()
    const user = request.user
    if (!user?.roles?.length) return false

    const rawRole: string = user.roles[0]
    const effectiveRole = ROLE_ALIASES[rawRole] ?? rawRole
    return requiredRoles.some(role => effectiveRole === role)
  }
}
