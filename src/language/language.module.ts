import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { LanguageController } from './language.controller';
import { LanguageService } from './language.service';

import { Language } from './model/language.model';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Language,
    ]),
  ],
  controllers: [LanguageController],
  providers: [LanguageService],
  exports: [LanguageService],
})
export class LanguageModule {}
