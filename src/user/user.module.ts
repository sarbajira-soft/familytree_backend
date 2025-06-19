import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { UserController } from './user.controller';
import { UserService } from './user.service';

import { User } from './model/user.model';
import { UserProfile } from './model/user-profile.model';
import { Invite } from './model/invite.model';
import { Family } from '../family/model/family.model';
import { FamilyMember } from '../family/model/family-member.model';
import { MailService } from '../utils/mail.service';

@Module({
  imports: [
    SequelizeModule.forFeature([
      User,
      UserProfile,
      Family,
      FamilyMember,
      Invite
    ]),
  ],
  controllers: [UserController],
  providers: [UserService, MailService],
  exports: [UserService],
})
export class UserModule {}
