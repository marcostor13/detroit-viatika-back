import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { jwtConstants } from '../constants/jwt.constants'
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConstants.secret, // Define este valor en un archivo de constantes o variable de entorno
    })
  }

  async validate(payload: any) {
    return {
      _id: payload.userId,
      email: payload.email,
      roles: payload.roles,
      clientId: payload.clientId,
      permissions: payload.permissions || {
        modules: [],
        canApproveL1: false,
        canApproveL2: false,
        categoryIds: [],
      },
    }
  }
}
