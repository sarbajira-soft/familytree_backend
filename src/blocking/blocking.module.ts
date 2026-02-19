import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { FtUserBlock } from './model/user-block.model';
import { BlockingService } from './blocking.service';
import { BlockReadService } from './services/block/block.read.service';
import { BlockWriteService } from './services/block/block.write.service';
import { BlockBlockController } from './controllers/block/block.block.controller';
import { BlockUnblockController } from './controllers/block/block.unblock.controller';
import { BlockListController } from './controllers/block/block.list.controller';

@Module({
  imports: [SequelizeModule.forFeature([FtUserBlock, User, UserProfile])],
  controllers: [
    BlockBlockController,
    BlockUnblockController,
    BlockListController,
  ],
  providers: [BlockingService, BlockReadService, BlockWriteService],
  exports: [BlockingService, BlockReadService, SequelizeModule],
})
export class BlockingModule {}
