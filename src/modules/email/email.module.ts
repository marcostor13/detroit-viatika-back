import { Module, Logger } from '@nestjs/common'
import { EmailService } from './email.service'
import { EmailController } from './email.controller'
import { MailerModule } from '@nestjs-modules/mailer'
import { MongooseModule } from '@nestjs/mongoose'
import { join } from 'path'
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter'
import { Client, ClientSchema } from '../client/entities/client.entity'

@Module({
  imports: [
    MailerModule.forRootAsync({
      useFactory: () => {
        const config = {
          transport: {
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            auth: {
              user: process.env.USER_EMAIL,
              pass: process.env.PASSWORD_EMAIL,
            },
          },
          defaults: {
            from: process.env.USER_EMAIL,
          },
          template: {
            dir: join(process.cwd(), 'src/modules/email/templates'),
            adapter: new HandlebarsAdapter(),
            options: {
              strict: true,
            },
          },
        }
        return config
      },
    }),
    MongooseModule.forFeature([{ name: Client.name, schema: ClientSchema }]),
  ],
  controllers: [EmailController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
