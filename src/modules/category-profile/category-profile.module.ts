import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  CategoryProfile,
  CategoryProfileSchema,
} from './entities/category-profile.entity'
import { CategoryProfileService } from './category-profile.service'
import { CategoryProfileController } from './category-profile.controller'
import { AuditLogModule } from '../audit-log/audit-log.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CategoryProfile.name, schema: CategoryProfileSchema },
    ]),
    AuditLogModule,
  ],
  controllers: [CategoryProfileController],
  providers: [CategoryProfileService],
  exports: [CategoryProfileService, MongooseModule],
})
export class CategoryProfileModule {}
