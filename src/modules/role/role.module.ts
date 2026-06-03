import { forwardRef, Module } from '@nestjs/common'
import { RoleService } from './role.service'
import { RoleController } from './role.controller'
import { Role, RoleSchema } from './entities/role.entity'
import { MongooseModule } from '@nestjs/mongoose'
import { UserModule } from '../user/user.module'
import { JwtService } from '@nestjs/jwt'
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Role.name, schema: RoleSchema }]),
    forwardRef(() => UserModule),
  ],
  controllers: [RoleController],
  providers: [RoleService, JwtService],
  exports: [RoleService],
})
export class RoleModule {}
