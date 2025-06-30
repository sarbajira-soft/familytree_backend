import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ScheduleModule } from '@nestjs/schedule'; //  Required for SchedulerRegistry

import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationScheduler } from './notification.scheduler';

import { MailService } from '../utils/mail.service';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { FamilyMember } from '../family/model/family-member.model';
import { Notification } from './model/notification.model';
import { NotificationRecipient } from './model/notification-recipients.model';

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
  ],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationScheduler, MailService],
  exports: [NotificationService, MailService],
})
export class NotificationModule {}
