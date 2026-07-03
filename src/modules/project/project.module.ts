import { Module } from '@nestjs/common'
import { ProjectService } from './project.service'
import { ProjectController } from './project.controller'
import { MongooseModule } from '@nestjs/mongoose'
import { Project, ProjectSchema } from './entities/project.entity'
import { AuditLogModule } from '../audit-log/audit-log.module'
import { CategoryGroupModule } from '../category-group/category-group.module'

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Project.name, schema: ProjectSchema }]),
    AuditLogModule,
    CategoryGroupModule,
  ],
  controllers: [ProjectController],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
