import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { GalleryController } from './gallery.controller';
import { GalleryService } from './gallery.service';
import { Gallery } from './model/gallery.model';
import { GalleryAlbum } from './model/gallery-album.model';
import { GalleryLike } from './model/gallery-like.model';
import { GalleryComment } from './model/gallery-comment.model';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [SequelizeModule.forFeature([
    Gallery,
    GalleryAlbum, 
    GalleryLike, 
    GalleryComment, 
    User, 
    UserProfile
  ]),
  NotificationModule
  ],
  controllers: [GalleryController],
  providers: [GalleryService],
  exports: [GalleryService],
})
export class GalleryModule {}
