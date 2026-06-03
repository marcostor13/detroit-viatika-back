import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { InvoiceController } from './invoice.controller'
import { InvoiceService } from './invoice.service'
import { Invoice, InvoiceSchema } from './entities/invoice.entity'
import { ProjectModule } from '../project/project.module'
import { HttpModule } from '@nestjs/axios'
import { EmailModule } from '../email/email.module'
import { UserModule } from '../user/user.module'
import { AuditLogModule } from '../audit-log/audit-log.module'

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Invoice.name, schema: InvoiceSchema }]),
    ProjectModule,
    HttpModule,
    EmailModule,
    UserModule,
    AuditLogModule,
  ],
  controllers: [InvoiceController],
  providers: [InvoiceService],
  exports: [InvoiceService],
})
export class InvoiceModule {}
