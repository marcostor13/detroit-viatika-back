import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { CategoryGroupController } from './category-group.controller'
import { CategoryGroupService } from './category-group.service'
import {
  CategoryGroup,
  CategoryGroupSchema,
} from './entities/category-group.entity'
import { AuditLogModule } from '../audit-log/audit-log.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CategoryGroup.name, schema: CategoryGroupSchema },
    ]),
    AuditLogModule,
  ],
  controllers: [CategoryGroupController],
  providers: [CategoryGroupService],
  exports: [CategoryGroupService],
})
export class CategoryGroupModule {}
