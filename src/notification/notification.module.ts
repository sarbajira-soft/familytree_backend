import { Module, forwardRef } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ScheduleModule } from '@nestjs/schedule';

import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationScheduler } from './notification.scheduler';

import { MailService } from '../utils/mail.service';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { FamilyMember } from '../family/model/family-member.model';
import { Notification } from './model/notification.model';
import { NotificationRecipient } from './model/notification-recipients.model';
import { FamilyModule } from '../family/family.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Notification,
      NotificationRecipient,
      User,
      UserProfile,
      FamilyMember,
    ]),
    ScheduleModule.forRoot(),
    forwardRef(() => FamilyModule),
    forwardRef(() => UserModule),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService, 
    NotificationScheduler, 
    MailService,
    {
      provide: 'SEQUELIZE',
      useExisting: Sequelize,
    },
  ],
  exports: [
    NotificationService, 
    MailService,
    SequelizeModule,
  ],
})
export class NotificationModule {}
