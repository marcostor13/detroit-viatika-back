import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { OrdenTrabajoService } from './orden-trabajo.service'
import { OrdenTrabajoController } from './orden-trabajo.controller'
import {
  OrdenTrabajo,
  OrdenTrabajoSchema,
} from './entities/orden-trabajo.entity'
import { Project, ProjectSchema } from '../project/entities/project.entity'
import { AuditLogModule } from '../audit-log/audit-log.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrdenTrabajo.name, schema: OrdenTrabajoSchema },
      // Solo lectura: se usa para validar que el centro de costo exista y
      // pertenezca a la empresa al crear/editar una OT.
      { name: Project.name, schema: ProjectSchema },
    ]),
    AuditLogModule,
  ],
  controllers: [OrdenTrabajoController],
  providers: [OrdenTrabajoService],
  exports: [OrdenTrabajoService],
})
export class OrdenTrabajoModule {}
