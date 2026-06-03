import { GoogleStrategy } from './google.strategy'

const mockAuthService = {}

describe('GoogleStrategy', () => {
  let strategy: GoogleStrategy

  beforeEach(() => {
    process.env.CLIENT_ID = 'test-client-id'
    process.env.CLIENT_SECRET = 'test-client-secret'
    strategy = new GoogleStrategy(mockAuthService as any)
  })

  it('is defined', () => {
    expect(strategy).toBeDefined()
  })

  it('validate() calls done with user object built from profile', async () => {
    const done = jest.fn()
    const profile = {
      emails: [{ value: 'test@google.com' }],
      displayName: 'Test User',
    }
    await strategy.validate('access-token', 'refresh-token', profile, done)
    expect(done).toHaveBeenCalledWith(null, {
      email: 'test@google.com',
      displayName: 'Test User',
      accessToken: 'access-token',
    })
  })

  it('validate() uses first email from profile emails array', async () => {
    const done = jest.fn()
    const profile = {
      emails: [{ value: 'first@test.com' }, { value: 'second@test.com' }],
      displayName: 'Multi Email',
    }
    await strategy.validate('tok', 'ref', profile, done)
    expect(done).toHaveBeenCalledWith(null, expect.objectContaining({ email: 'first@test.com' }))
  })
})
