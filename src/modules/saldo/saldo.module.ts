import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Saldo, SaldoSchema } from './entities/saldo.entity'
import { SaldoService } from './saldo.service'
import { SaldoController } from './saldo.controller'
import { NotificationsModule } from '../notifications/notifications.module'
import { AuditLogModule } from '../audit-log/audit-log.module'

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Saldo.name, schema: SaldoSchema }]),
    NotificationsModule,
    AuditLogModule,
  ],
  controllers: [SaldoController],
  providers: [SaldoService],
  exports: [SaldoService],
})
export class SaldoModule {}
