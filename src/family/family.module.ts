import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';
import { FamilyMemberController } from './family-member.controller';
import { FamilyMemberService } from './family-member.service ';
import { Family } from './model/family.model';
import { FamilyMember } from './model/family-member.model';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { MailService } from '../utils/mail.service';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Family,
      User,
      FamilyMember,
      UserProfile,
    ]),
  ],
  controllers: [FamilyController, FamilyMemberController],
  providers: [FamilyService, MailService, FamilyMemberService],
  exports: [FamilyService],
})
export class FamilyModule {}
