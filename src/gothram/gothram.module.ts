import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { GothramController } from './gothram.controller';
import { GothramService } from './gothram.service';

import { Gothram } from './model/gothram.model';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Gothram,
    ]),
  ],
  controllers: [GothramController],
  providers: [GothramService],
  exports: [GothramService],
})
export class GothramModule {}
