import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { PostController } from './post.controller';
import { PostService } from './post.service';
import { Post } from './model/post.model';
import { PostLike } from './model/post-like.model';
import { PostComment } from './model/post-comment.model';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { NotificationModule } from '../notification/notification.module';
<<<<<<< HEAD
import { UploadModule } from '../uploads/upload.module';
=======
>>>>>>> fa20b5721992d820e302d3d2fc2499aeea5908fb

@Module({
  imports: [
    SequelizeModule.forFeature([
      Post,
      PostLike,
      PostComment,
      User,
      UserProfile,
    ]),
<<<<<<< HEAD
    NotificationModule,
    UploadModule
=======
    NotificationModule
>>>>>>> fa20b5721992d820e302d3d2fc2499aeea5908fb
  ],
  controllers: [PostController],
  providers: [PostService],
  exports: [PostService],
})
export class PostModule {}
