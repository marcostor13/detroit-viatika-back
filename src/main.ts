import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import * as dns from 'node:dns'

/**
 * En algunos entornos Windows, Node resuelve SRV de `mongodb+srv://` contra DNS que
 * responden ECONNREFUSED, mientras el sistema (PowerShell) sí resuelve. Opcional:
 * NODE_DNS_SERVERS=8.8.8.8,1.1.1.1
 */
function applyOptionalNodeDnsServers(): void {
  const raw = process.env.NODE_DNS_SERVERS?.trim()
  if (!raw) return
  const servers = raw.split(/[\s,]+/).filter(Boolean)
  if (servers.length === 0) return
  dns.setServers(servers)
}

async function bootstrap() {
  applyOptionalNodeDnsServers()
  const app = await NestFactory.create(AppModule)
  app.setGlobalPrefix('api')
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
  // Configurar timeouts antes de empezar a escuchar conexiones.
  const server = app.getHttpServer()
  server.setTimeout(300000)
  server.keepAliveTimeout = 300000
  server.headersTimeout = 301000
  await app.listen(process.env.PORT ?? 3000)
}
bootstrap()
