import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SequelizeModule } from '@nestjs/sequelize';

import { AdminController } from './admin.controller';
import { AdminAuditLogService } from './admin-audit-log.service';
import { AdminService } from './admin.service';
import { AdminJwtStrategy } from './auth/admin-jwt.strategy';
import { AdminJwtAuthGuard } from './auth/admin-jwt-auth.guard';
import { AdminRolesGuard } from './auth/admin-roles.guard';
import { AdminAuditLog } from './model/admin-audit-log.model';
import { AdminLogin } from './model/admin-login.model';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Post } from '../post/model/post.model';
import { PostLike } from '../post/model/post-like.model';
import { PostComment } from '../post/model/post-comment.model';
import { Gallery } from '../gallery/model/gallery.model';
import { GalleryAlbum } from '../gallery/model/gallery-album.model';
import { GalleryLike } from '../gallery/model/gallery-like.model';
import { GalleryComment } from '../gallery/model/gallery-comment.model';
import { Event } from '../event/model/event.model';
import { FamilyMember } from '../family/model/family-member.model';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';
import { AdminPostsController } from './posts/admin-posts.controller';
import { AdminPostsService } from './posts/admin-posts.service';
import { AdminGalleriesController } from './galleries/admin-galleries.controller';
import { AdminGalleriesService } from './galleries/admin-galleries.service';
import { UploadModule } from '../uploads/upload.module';

@Module({
  imports: [
    SequelizeModule.forFeature([
      AdminLogin,
      AdminAuditLog,
      User,
      UserProfile,
      Post,
      PostLike,
      PostComment,
      Gallery,
      GalleryAlbum,
      GalleryLike,
      GalleryComment,
      Event,
      FamilyMember,
    ]),
    UploadModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const secret =
          configService.get<string>('JWT_SECRET') || process.env.JWT_SECRET;

        if (!secret) {
          throw new Error('JWT_SECRET is not set');
        }

        return {
          secret,
          signOptions: { expiresIn: '1d' },
        };
      },
    }),
  ],
  controllers: [AdminController, AdminUsersController, AdminPostsController, AdminGalleriesController],
  providers: [
    AdminService,
    AdminAuditLogService,
    AdminUsersService,
    AdminPostsService,
    AdminGalleriesService,
    AdminJwtStrategy,
    AdminJwtAuthGuard,
    AdminRolesGuard,
  ],
  exports: [AdminService],
})
export class AdminModule {}
