import { JwtStrategy } from './jwt.strategy'

describe('JwtStrategy', () => {
  let strategy: JwtStrategy

  beforeEach(() => {
    strategy = new JwtStrategy()
  })

  it('is defined', () => {
    expect(strategy).toBeDefined()
  })

  it('validate() returns user object from payload', async () => {
    const payload = {
      userId: 'user-id-123',
      email: 'test@test.com',
      roles: ['Colaborador'],
      clientId: 'client-id-456',
      permissions: {
        modules: ['tesoreria'],
        canApproveL1: true,
        canApproveL2: false,
      },
    }
    const result = await strategy.validate(payload)
    expect(result).toEqual({
      _id: 'user-id-123',
      email: 'test@test.com',
      roles: ['Colaborador'],
      clientId: 'client-id-456',
      permissions: {
        modules: ['tesoreria'],
        canApproveL1: true,
        canApproveL2: false,
      },
    })
  })

  it('validate() sets default permissions when not present in payload', async () => {
    const payload = {
      userId: 'u1',
      email: 'x@x.com',
      roles: ['Colaborador'],
      clientId: 'c1',
    }
    const result = await strategy.validate(payload)
    expect(result.permissions).toEqual({
      modules: [],
      canApproveL1: false,
      canApproveL2: false,
      categoryIds: [],
    })
  })

  it('validate() maps userId to _id', async () => {
    const payload = {
      userId: 'abc',
      email: 'a@b.com',
      roles: [],
      clientId: 'c1',
    }
    const result = await strategy.validate(payload)
    expect(result._id).toBe('abc')
  })
})
