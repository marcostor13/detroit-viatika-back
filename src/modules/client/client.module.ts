import { Module } from '@nestjs/common'
import { ClientService } from './client.service'
import { ClientController } from './client.controller'
import { MongooseModule } from '@nestjs/mongoose'
import { Client, ClientSchema } from './entities/client.entity'
import { JwtService } from '@nestjs/jwt'
import { UserModule } from '../user/user.module'
import { EmailModule } from '../email/email.module'
import { RoleModule } from '../role/role.module'
import { ClientOnboardingService } from './client-onboarding.service'

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Client.name, schema: ClientSchema }]),
    UserModule,
    EmailModule,
    RoleModule,
  ],
  controllers: [ClientController],
  providers: [ClientService, ClientOnboardingService, JwtService],
  exports: [ClientService],
})
export class ClientModule {}
