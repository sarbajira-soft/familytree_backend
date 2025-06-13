import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { PostController } from './post.controller';
import { PostService } from './post.service';
import { Post } from './model/post.model'; // Assuming your Post model is named PostModel
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Post,
      User,
      UserProfile,
    ]),
  ],
  controllers: [PostController],
  providers: [PostService],
  exports: [PostService],
})
export class PostModule {}
