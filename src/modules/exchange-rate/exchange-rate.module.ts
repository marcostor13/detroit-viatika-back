import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ExchangeRateService } from './exchange-rate.service'
import {
  ExchangeRate,
  ExchangeRateSchema,
} from './entities/exchange-rate.entity'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
    ]),
  ],
  providers: [ExchangeRateService],
  exports: [ExchangeRateService],
})
export class ExchangeRateModule {}
