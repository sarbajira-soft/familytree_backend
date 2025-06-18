import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { FamilyController } from './family.controller';
import { FamilyPositionController } from './family-position.controller';
import { FamilyService } from './family.service';
import { FamilyMemberController } from './family-member.controller';
import { FtRelationshipTranslationController } from './relationship-translate.controller';
import { FamilyMemberService } from './family-member.service ';
import { Family } from './model/family.model';
import { FtFamilyPosition } from './model/family-position.model';
import { FtRelationshipTranslation } from './model/relationship-translations.model';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { MailService } from '../utils/mail.service';

@Module({
  imports: [
    SequelizeModule.forFeature([
      FtFamilyPosition,
      FtRelationshipTranslation,
      Family,
      User,
      UserProfile,
    ]),
  ],
  controllers: [FamilyController, FamilyMemberController],
  providers: [FamilyService, MailService, FamilyMemberService],
  exports: [FamilyService],
})
export class FamilyModule {}
