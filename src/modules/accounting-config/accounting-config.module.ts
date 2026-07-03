import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AccountingConfigService } from './accounting-config.service'
import { AccountingConfigController } from './accounting-config.controller'
import {
  AccountingConfig,
  AccountingConfigSchema,
} from './entities/accounting-config.entity'
import { AuditLogModule } from '../audit-log/audit-log.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AccountingConfig.name, schema: AccountingConfigSchema },
    ]),
    AuditLogModule,
  ],
  controllers: [AccountingConfigController],
  providers: [AccountingConfigService],
  exports: [AccountingConfigService],
})
export class AccountingConfigModule {}
