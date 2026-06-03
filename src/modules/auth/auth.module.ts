import { Module } from '@nestjs/common'
import { AuthService } from './auth.service'
import { UserModule } from '../user/user.module'
import { PassportModule } from '@nestjs/passport'
import { JwtModule } from '@nestjs/jwt'
import { jwtConstants } from './constants/jwt.constants'
import { LocalStrategy } from './strategies/local.strategy'
import { JwtStrategy } from './strategies/jwt.strategy'
import { AuthController } from './auth.controller'
import { GoogleStrategy } from './strategies/google.strategy'
import { ClientModule } from '../client/client.module'
import { RoleModule } from '../role/role.module'
import { DatabaseSeederService } from './database-seeder.service'
import { MongooseModule } from '@nestjs/mongoose'
import { User, UserSchema } from '../user/schemas/user.schema'
import { Category, CategorySchema } from '../category/entities/category.entity'

@Module({
  imports: [
    UserModule,
    RoleModule,
    ClientModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Category.name, schema: CategorySchema },
    ]),
    PassportModule,
    JwtModule.register({
      secret: jwtConstants.secret,
      signOptions: { expiresIn: '24h' },
    }),
  ],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    GoogleStrategy,
    DatabaseSeederService,
  ],
  controllers: [AuthController],
  exports: [AuthService, DatabaseSeederService],
})
export class AuthModule {}
