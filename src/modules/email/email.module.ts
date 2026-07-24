import { Module, Logger } from '@nestjs/common'
import { EmailService } from './email.service'
import { EmailController } from './email.controller'
import { MailerModule } from '@nestjs-modules/mailer'
import { MongooseModule } from '@nestjs/mongoose'
import { join } from 'path'
import * as fs from 'fs'
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter'
import { Client, ClientSchema } from '../client/entities/client.entity'

@Module({
  imports: [
    MailerModule.forRootAsync({
      useFactory: () => {
        const provider = (process.env.EMAIL_PROVIDER ?? 'gmail').toLowerCase()
        const user = process.env.USER_EMAIL
        const pass = process.env.PASSWORD_EMAIL
        const smtpProviders: Record<string, object> = {
          gmail: {
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            auth: { user, pass },
          },
          outlook: {
            host: 'smtp.office365.com',
            port: 587,
            secure: false,
            requireTLS: true,
            auth: { user, pass },
            tls: { ciphers: 'SSLv3', rejectUnauthorized: false },
          },
        }
        const transport = smtpProviders[provider] ?? smtpProviders['gmail']
        const logger = new Logger('EmailModule')
        logger.log(`Proveedor SMTP: ${provider}, user: ${user}`)
        return {
          transport,
          defaults: {
            from: user,
          },
          template: (() => {
            const dist = join(process.cwd(), 'dist/modules/email/templates')
            const src = join(process.cwd(), 'src/modules/email/templates')
            const dir = fs.existsSync(dist) ? dist : src
            return {
              dir,
              adapter: new HandlebarsAdapter({
                // Helper de comparación usado por plantillas de factura
                // (`{{#if (eq status "APPROVED")}}`). Sin registrarlo, esas
                // plantillas fallaban al renderizar.
                eq: (a: unknown, b: unknown) => a === b,
              }),
              options: {
                strict: true,
              },
              // Header/footer compartidos (VD-81): una sola línea de diseño
              // para todos los correos. Ver templates/partials/*.hbs.
              partials: {
                dir: join(dir, 'partials'),
                options: {
                  strict: true,
                },
              },
            }
          })(),
        }
      },
    }),
    MongooseModule.forFeature([{ name: Client.name, schema: ClientSchema }]),
  ],
  controllers: [EmailController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
