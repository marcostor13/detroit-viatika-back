import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { SunatConfigService } from './sunat-config.service'
import { SunatConfigController } from './sunat-config.controller'
import { SunatConfig, SunatConfigSchema } from './entities/sunat-config.entity'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SunatConfig.name, schema: SunatConfigSchema },
    ]),
  ],
  controllers: [SunatConfigController],
  providers: [SunatConfigService],
  exports: [SunatConfigService],
})
export class SunatConfigModule {}
