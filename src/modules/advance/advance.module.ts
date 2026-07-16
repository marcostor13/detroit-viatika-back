import { Module, forwardRef } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AdvanceService } from './advance.service'
import { AdvanceController } from './advance.controller'
import { PaymentBatchService } from './payment/payment-batch.service'
import { Advance, AdvanceSchema } from './entities/advance.entity'
import { ExpenseReportModule } from '../expense-report/expense-report.module'
import { AuditLogModule } from '../audit-log/audit-log.module'
import { ProjectModule } from '../project/project.module'
import { CategoryModule } from '../category/category.module'
import { UserModule } from '../user/user.module'
import { EmailModule } from '../email/email.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { ClientModule } from '../client/client.module'

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Advance.name, schema: AdvanceSchema }]),
    forwardRef(() => ExpenseReportModule),
    AuditLogModule,
    ProjectModule,
    CategoryModule,
    UserModule,
    EmailModule,
    NotificationsModule,
    ClientModule,
  ],
  controllers: [AdvanceController],
  providers: [AdvanceService, PaymentBatchService],
  exports: [AdvanceService],
})
export class AdvanceModule {}
