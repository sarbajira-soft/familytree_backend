import { Module, forwardRef } from '@nestjs/common';
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
import { UploadModule } from '../uploads/upload.module';
import { BlockingModule } from '../blocking/blocking.module';
import { FamilyMember } from '../family/model/family-member.model';
 
@Module({
  imports: [
    SequelizeModule.forFeature([
      Gallery,
      GalleryAlbum, 
      GalleryLike, 
      GalleryComment, 
      User, 
      UserProfile,
      FamilyMember,
    ]),
    NotificationModule,
    BlockingModule,
    forwardRef(() => UploadModule)
  ],
  controllers: [GalleryController],
  providers: [GalleryService],
  exports: [GalleryService],
})
export class GalleryModule {}
