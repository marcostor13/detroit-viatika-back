import { JwtAuthGuard } from './jwt-auth.guard'
import { AuthGuard } from '@nestjs/passport'

describe('JwtAuthGuard', () => {
  it('is defined', () => {
    const guard = new JwtAuthGuard()
    expect(guard).toBeDefined()
  })

  it('extends AuthGuard jwt', () => {
    expect(JwtAuthGuard.prototype).toBeInstanceOf(AuthGuard('jwt'))
  })
})
