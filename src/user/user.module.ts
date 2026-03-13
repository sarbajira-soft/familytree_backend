import { Module, forwardRef } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { UserController } from './user.controller';
import { UserLookupController } from './user-lookup.controller';
import { UserConsentController } from './user-consent.controller';
import { UserService } from './user.service';

import { User } from './model/user.model';
import { UserProfile } from './model/user-profile.model';
import { Invite } from './model/invite.model';
import { Family } from '../family/model/family.model';
import { FamilyMember } from '../family/model/family-member.model';
import { FamilyLink } from '../family/model/family-link.model';
import { FamilyTree } from '../family/model/family-tree.model';
import { Religion } from '../religion/model/religion.model';
import { Language } from '../language/model/language.model';
import { Gothram } from '../gothram/model/gothram.model';
import { MailService } from '../utils/mail.service';
import { MedusaCustomerSyncService } from '../medusa/medusa-customer-sync.service';
import { Gallery } from '../gallery/model/gallery.model';
import { Post } from '../post/model/post.model';
import { Event } from '../event/model/event.model';

import { NotificationModule } from '../notification/notification.module';
import { Notification } from '../notification/model/notification.model';
import { UploadModule } from '../uploads/upload.module';
import { BlockingModule } from '../blocking/blocking.module';
import { AccountRecoveryToken } from './model/account-recovery-token.model';
import { UserAccountCleanupService } from './user-account-cleanup.service';
import { FamilyModule } from '../family/family.module';
import { ContentVisibilityService } from './content-visibility.service';

@Module({
  imports: [
    forwardRef(() => FamilyModule),
    forwardRef(() => UploadModule),
    BlockingModule,
    SequelizeModule.forFeature([
      User,
      UserProfile,
      Family,
      FamilyMember,
      FamilyLink,
      FamilyTree,
      Invite,
      Religion,
      Language,
      Gothram,
      Notification,
      Gallery,
      Post,
      Event,
      AccountRecoveryToken,
    ]),
    forwardRef(() => NotificationModule),
    UploadModule,
  ],
  controllers: [UserController, UserLookupController, UserConsentController],
  providers: [UserService, MailService, MedusaCustomerSyncService, UserAccountCleanupService, ContentVisibilityService],
  exports: [UserService, ContentVisibilityService],
})
export class UserModule {}
