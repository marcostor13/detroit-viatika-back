import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { PettyCashService } from './petty-cash.service'
import { PettyCashController } from './petty-cash.controller'
import { PettyCash, PettyCashSchema } from './entities/petty-cash.entity'
import { EmailModule } from '../email/email.module'
import { UserModule } from '../user/user.module'
import { AuditLogModule } from '../audit-log/audit-log.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PettyCash.name, schema: PettyCashSchema },
    ]),
    EmailModule,
    UserModule,
    AuditLogModule,
  ],
  controllers: [PettyCashController],
  providers: [PettyCashService],
  exports: [PettyCashService],
})
export class PettyCashModule {}
