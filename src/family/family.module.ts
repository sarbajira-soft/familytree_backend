import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';
import { Family } from './model/family.model';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { MailService } from '../utils/mail.service';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Family,
      User,
      UserProfile,
    ]),
  ],
  controllers: [FamilyController],
  providers: [FamilyService, MailService],
  exports: [FamilyService],
})
export class FamilyModule {}
