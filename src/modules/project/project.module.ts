import { Module } from '@nestjs/common'
import { ProjectService } from './project.service'
import { ProjectController } from './project.controller'
import { MongooseModule } from '@nestjs/mongoose'
import { Project, ProjectSchema } from './entities/project.entity'
import {
  LineaNegocio,
  LineaNegocioSchema,
} from '../linea-negocio/entities/linea-negocio.entity'
import { User, UserSchema } from '../user/schemas/user.schema'
import { AuditLogModule } from '../audit-log/audit-log.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      // Solo lectura: se usan para resolver "Línea de Negocio" y "Aprobador
      // N1/N2/N3" por nombre/email al importar centros de costo desde Excel.
      { name: LineaNegocio.name, schema: LineaNegocioSchema },
      { name: User.name, schema: UserSchema },
    ]),
    AuditLogModule,
  ],
  controllers: [ProjectController],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
