import { BadRequestException } from '@nestjs/common'
import { LocalStrategy } from './local.strategy'

const mockAuthService = {
  validateUser: jest.fn(),
}

describe('LocalStrategy', () => {
  let strategy: LocalStrategy

  beforeEach(() => {
    jest.clearAllMocks()
    strategy = new LocalStrategy(mockAuthService as any)
  })

  it('is defined', () => {
    expect(strategy).toBeDefined()
  })

  it('validate() returns user when credentials are valid', async () => {
    const user = { _id: 'u1', email: 'a@b.com' }
    mockAuthService.validateUser.mockResolvedValue(user)
    const result = await strategy.validate('a@b.com', 'pass123')
    expect(result).toBe(user)
  })

  it('validate() throws BadRequestException when validateUser returns null', async () => {
    mockAuthService.validateUser.mockResolvedValue(null)
    await expect(strategy.validate('bad@b.com', 'wrongpass')).rejects.toThrow(BadRequestException)
  })

  it('validate() calls authService.validateUser with email and password', async () => {
    mockAuthService.validateUser.mockResolvedValue({ _id: 'u1' })
    await strategy.validate('a@b.com', 'mypass')
    expect(mockAuthService.validateUser).toHaveBeenCalledWith('a@b.com', 'mypass')
  })
})
