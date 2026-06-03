import { Module } from '@nestjs/common'
import { ExpenseService } from './expense.service'
import { ExpenseController } from './expense.controller'
import { ExpenseSchema } from './entities/expense.entity'
import { Expense } from './entities/expense.entity'
import { MongooseModule } from '@nestjs/mongoose'
import { EmailModule } from '../email/email.module'
import { CategoryModule } from '../category/category.module'
import { ProjectModule } from '../project/project.module'
import { UserModule } from '../user/user.module'
import { SunatConfigModule } from '../sunat-config/sunat-config.module'
import { HttpModule } from '@nestjs/axios'
import { UploadModule } from '../upload/upload.module'
import { ExpenseReportModule } from '../expense-report/expense-report.module'
import { AuditLogModule } from '../audit-log/audit-log.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { Client, ClientSchema } from '../client/entities/client.entity'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Expense.name, schema: ExpenseSchema },
      { name: Client.name, schema: ClientSchema },
    ]),
    EmailModule,
    CategoryModule,
    ProjectModule,
    UserModule,
    SunatConfigModule,
    HttpModule,
    UploadModule,
    ExpenseReportModule,
    AuditLogModule,
    NotificationsModule,
  ],
  controllers: [ExpenseController],
  providers: [ExpenseService],
  exports: [ExpenseService],
})
export class ExpenseModule {}
