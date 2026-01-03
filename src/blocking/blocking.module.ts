import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../user/model/user.model';
import { BlockingController } from './blocking.controller';
import { BlockingService } from './blocking.service';
import { UserBlock } from './model/user-block.model';

@Module({
  imports: [SequelizeModule.forFeature([UserBlock, User])],
  controllers: [BlockingController],
  providers: [BlockingService],
  exports: [BlockingService, SequelizeModule],
})
export class BlockingModule {}
