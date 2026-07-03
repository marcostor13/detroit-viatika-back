import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { MongooseModule } from '@nestjs/mongoose'
import { ConfigModule } from '@nestjs/config'
import { UserModule } from './modules/user/user.module'
import { AuthModule } from './modules/auth/auth.module'
import { RoleModule } from './modules/role/role.module'
import { ClientModule } from './modules/client/client.module'
import { ProjectModule } from './modules/project/project.module'
import { CategoryModule } from './modules/category/category.module'
import { InvoiceModule } from './modules/invoice/invoice.module'
import { EmailModule } from './modules/email/email.module'
import { SunatConfigModule } from './modules/sunat-config/sunat-config.module'
import { ExpenseModule } from './modules/expense/expense.module'
import { UploadModule } from './modules/upload/upload.module'
import { ExpenseReportModule } from './modules/expense-report/expense-report.module'
import { AdvanceModule } from './modules/advance/advance.module'
import { AuditLogModule } from './modules/audit-log/audit-log.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { AiModule } from './modules/ai/ai.module'
import { PettyCashModule } from './modules/petty-cash/petty-cash.module'
import { CategoryGroupModule } from './modules/category-group/category-group.module'
import { ScheduleModule } from '@nestjs/schedule'
import { SchedulerModule } from './modules/scheduler/scheduler.module'
import { DashboardModule } from './modules/dashboard/dashboard.module'
import { LineaNegocioModule } from './modules/linea-negocio/linea-negocio.module'
import { CajaChicaReportModule } from './modules/caja-chica-report/caja-chica-report.module'
import { AccountingConfigModule } from './modules/accounting-config/accounting-config.module'
import { AccountingEntriesModule } from './modules/accounting-entries/accounting-entries.module'
import { ExchangeRateModule } from './modules/exchange-rate/exchange-rate.module'
import { SaldoModule } from './modules/saldo/saldo.module'
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRoot(process.env.MONGO_URI as string, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    }),
    AuthModule,
    UserModule,
    RoleModule,
    ClientModule,
    ProjectModule,
    CategoryModule,
    InvoiceModule,
    EmailModule,
    SunatConfigModule,
    ExpenseModule,
    UploadModule,
    ExpenseReportModule,
    AdvanceModule,
    AuditLogModule,
    NotificationsModule,
    AiModule,
    PettyCashModule,
    CategoryGroupModule,
    ScheduleModule.forRoot(),
    SchedulerModule,
    DashboardModule,
    LineaNegocioModule,
    CajaChicaReportModule,
    AccountingConfigModule,
    AccountingEntriesModule,
    ExchangeRateModule,
    SaldoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
