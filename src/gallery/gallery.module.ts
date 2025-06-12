import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { GalleryController } from './gallery.controller';
import { GalleryService } from './gallery.service';
import { Gallery } from './model/gallery.model';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';

@Module({
  imports: [SequelizeModule.forFeature([Gallery, User, UserProfile])],
  controllers: [GalleryController],
  providers: [GalleryService],
  exports: [GalleryService],
})
export class GalleryModule {}
