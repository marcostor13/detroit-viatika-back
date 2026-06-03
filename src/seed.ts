import { NestFactory } from '@nestjs/core'
import { DatabaseSeederService } from './modules/auth/database-seeder.service'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule)
  const seeder = app.get(DatabaseSeederService)

  console.log('--- Starting Seeding Process ---')
  await seeder.onApplicationBootstrap()
  console.log('--- Seeding Process Completed ---')

  await app.close()
}

bootstrap().catch(err => {
  console.error('Seeding failed:', err)
  process.exit(1)
})
