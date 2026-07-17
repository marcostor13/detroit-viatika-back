import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Category, CategorySchema } from './entities/category.entity'
import {
  CategoryProfile,
  CategoryProfileSchema,
} from '../category-profile/entities/category-profile.entity'
import { CategoryService } from './category.service'
import { CategoryController } from './category.controller'
import { AuditLogModule } from '../audit-log/audit-log.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Category.name, schema: CategorySchema },
      // Solo lectura/escritura de categoryIds: se usa para vincular una
      // categoría recién creada por carga masiva a un Perfil de Categoría
      // (por nombre), creándolo si no existe.
      { name: CategoryProfile.name, schema: CategoryProfileSchema },
    ]),
    AuditLogModule,
  ],
  controllers: [CategoryController],
  providers: [CategoryService],
  exports: [CategoryService, MongooseModule],
})
export class CategoryModule {}
