import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SequelizeModule } from '@nestjs/sequelize';
import { ScheduleModule } from '@nestjs/schedule';

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
import { EventImage } from '../event/model/event-image.model';
import { FamilyMember } from '../family/model/family-member.model';
import { Family } from '../family/model/family.model';
import { FamilyTree } from '../family/model/family-tree.model';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';
import { AdminPostsController } from './posts/admin-posts.controller';
import { AdminPostsService } from './posts/admin-posts.service';
import { AdminGalleriesController } from './galleries/admin-galleries.controller';
import { AdminGalleriesService } from './galleries/admin-galleries.service';
import { AdminEventsController } from './events/admin-events.controller';
import { AdminEventsService } from './events/admin-events.service';
import { AdminFamiliesController } from './families/admin-families.controller';
import { AdminFamiliesService } from './families/admin-families.service';
import { AdminS3Controller } from './s3/admin-s3.controller';
import { AdminS3Service } from './s3/admin-s3.service';
import { AdminRetailController } from './retail/admin-retail.controller';
import { AdminRetailService } from './retail/admin-retail.service';
import { UploadModule } from '../uploads/upload.module';
import { GalleryModule } from '../gallery/gallery.module';
import { MedusaCustomerSyncService } from '../medusa/medusa-customer-sync.service';
import { CommentRetentionService } from './retention/comment-retention.service';
import { CommentRetentionScheduler } from './retention/comment-retention.scheduler';
import { UserModule } from '../user/user.module';

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
      EventImage,
      FamilyMember,
      Family,
      FamilyTree,
    ]),
    ScheduleModule.forRoot(),
    UploadModule,
    GalleryModule,
    UserModule,
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
  controllers: [AdminController, AdminUsersController, AdminPostsController, AdminGalleriesController, AdminEventsController, AdminFamiliesController, AdminS3Controller, AdminRetailController],
  providers: [
    AdminService,
    AdminAuditLogService,
    AdminUsersService,
    AdminPostsService,
    AdminGalleriesService,
    AdminEventsService,
    AdminFamiliesService,
    AdminS3Service,
    AdminRetailService,
    MedusaCustomerSyncService,
    CommentRetentionService,
    CommentRetentionScheduler,
    AdminJwtStrategy,
    AdminJwtAuthGuard,
    AdminRolesGuard,
  ],
  exports: [AdminService],
})
export class AdminModule {}
