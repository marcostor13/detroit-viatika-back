import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { RolesGuard } from './roles.guard'

const makeContext = (userRoles: string[]): ExecutionContext =>
  ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: { roles: userRoles } }),
    }),
  }) as unknown as ExecutionContext

describe('RolesGuard', () => {
  let guard: RolesGuard
  let reflector: Reflector

  beforeEach(() => {
    reflector = new Reflector()
    guard = new RolesGuard(reflector)
  })

  it('allows access when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined)
    expect(guard.canActivate(makeContext(['Colaborador']))).toBe(true)
  })

  it('allows access when required roles array is empty', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([])
    expect(guard.canActivate(makeContext(['Colaborador']))).toBe(true)
  })

  it('blocks access when user has no roles', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['Administrador'])
    expect(guard.canActivate(makeContext([]))).toBe(false)
  })

  it('blocks access when user is undefined on request', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['Administrador'])
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: undefined }) }),
    } as unknown as ExecutionContext
    expect(guard.canActivate(ctx)).toBe(false)
  })

  it('allows access when role matches exactly', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['Administrador'])
    expect(guard.canActivate(makeContext(['Administrador']))).toBe(true)
  })

  it('blocks access when role does not match', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['Superadministrador'])
    expect(guard.canActivate(makeContext(['Colaborador']))).toBe(false)
  })

  it('applies Coordinador -> Administrador alias for backward compat', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['Administrador'])
    expect(guard.canActivate(makeContext(['Coordinador']))).toBe(true)
  })

  it('allows access when one of multiple required roles matches', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['Administrador', 'Superadministrador'])
    expect(guard.canActivate(makeContext(['Superadministrador']))).toBe(true)
  })
})
