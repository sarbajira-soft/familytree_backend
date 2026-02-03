import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { JwtModule } from '@nestjs/jwt';
import { PostController } from './post.controller';
import { PostService } from './post.service';
import { PostGateway } from './post.gateway';
import { Post } from './model/post.model';
import { PostLike } from './model/post-like.model';
import { PostComment } from './model/post-comment.model';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { FamilyMember } from '../family/model/family-member.model';
import { FamilyLink } from '../family/model/family-link.model';
import { NotificationModule } from '../notification/notification.module';
import { UploadModule } from '../uploads/upload.module';
import { BlockingModule } from '../blocking/blocking.module';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Post,
      PostLike,
      PostComment,
      User,
      UserProfile,
      FamilyMember,
      FamilyLink,
    ]),
    NotificationModule,
    UploadModule,
    BlockingModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [PostController],
  providers: [PostService, PostGateway],
  exports: [PostService, PostGateway],
})
export class PostModule {} 
