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
    // Se comprueban ambos: el alias preserva compatibilidad con endpoints que
    // solo listan el rol antiguo (Administrador), pero sin descartar el rol
    // real (Coordinador) para los endpoints que lo exigen específicamente
    // (p.ej. aprobación de viáticos) — de lo contrario un Coordinador nunca
    // podría pasar un @Roles(ROLES.COORDINADOR).
    return requiredRoles.some(role => role === rawRole || role === effectiveRole)
  }
}
