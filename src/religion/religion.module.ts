import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ReligionController } from './religion.controller';
import { ReligionService } from './religion.service';

import { Religion } from './model/religion.model';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Religion,
    ]),
  ],
  controllers: [ReligionController],
  providers: [ReligionService],
  exports: [ReligionService],
})
export class ReligionModule {}
