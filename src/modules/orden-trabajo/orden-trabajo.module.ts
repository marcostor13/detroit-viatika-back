import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { OrdenTrabajoService } from './orden-trabajo.service'
import { OrdenTrabajoController } from './orden-trabajo.controller'
import {
  OrdenTrabajo,
  OrdenTrabajoCounter,
  OrdenTrabajoCounterSchema,
  OrdenTrabajoSchema,
} from './entities/orden-trabajo.entity'
import { AuditLogModule } from '../audit-log/audit-log.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrdenTrabajo.name, schema: OrdenTrabajoSchema },
      { name: OrdenTrabajoCounter.name, schema: OrdenTrabajoCounterSchema },
    ]),
    AuditLogModule,
  ],
  controllers: [OrdenTrabajoController],
  providers: [OrdenTrabajoService],
  exports: [OrdenTrabajoService],
})
export class OrdenTrabajoModule {}
