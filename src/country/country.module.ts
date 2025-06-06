import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { CountryController } from './country.controller';
import { CountryService } from './country.service';

import { Country } from './model/country.model';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Country,
    ]),
  ],
  controllers: [CountryController],
  providers: [CountryService],
  exports: [CountryService],
})
export class CountryModule {}
