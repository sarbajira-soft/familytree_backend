import { Module, forwardRef } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { UserController } from './user.controller';
import { UserLookupController } from './user-lookup.controller';
import { UserService } from './user.service';

import { User } from './model/user.model';
import { UserProfile } from './model/user-profile.model';
import { Invite } from './model/invite.model';
import { Family } from '../family/model/family.model';
import { FamilyMember } from '../family/model/family-member.model';
import { Religion } from '../religion/model/religion.model';
import { Language } from '../language/model/language.model';
import { Gothram } from '../gothram/model/gothram.model';
import { MailService } from '../utils/mail.service';
 
import { NotificationModule } from '../notification/notification.module';
import { Notification } from '../notification/model/notification.model';
import { UploadModule } from '../uploads/upload.module';

@Module({
  imports: [
    forwardRef(() => UploadModule),
    SequelizeModule.forFeature([
      User,
      UserProfile,
      Family,
      FamilyMember,
      Invite,
      Religion,
      Language,
      Gothram,
      Notification,
    ]),
    NotificationModule,
    UploadModule,
  ],
  controllers: [UserController, UserLookupController],
  providers: [UserService, MailService],
  exports: [UserService],
})
export class UserModule {}
