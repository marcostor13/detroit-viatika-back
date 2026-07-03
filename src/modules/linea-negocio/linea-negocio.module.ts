import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { LineaNegocioService } from './linea-negocio.service'
import { LineaNegocioController } from './linea-negocio.controller'
import {
  LineaNegocio,
  LineaNegocioSchema,
} from './entities/linea-negocio.entity'
import { AuditLogModule } from '../audit-log/audit-log.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LineaNegocio.name, schema: LineaNegocioSchema },
    ]),
    AuditLogModule,
  ],
  controllers: [LineaNegocioController],
  providers: [LineaNegocioService],
  exports: [LineaNegocioService],
})
export class LineaNegocioModule {}
