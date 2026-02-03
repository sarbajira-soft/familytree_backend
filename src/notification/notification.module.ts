import { Module, forwardRef } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule } from '@nestjs/jwt';

import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationScheduler } from './notification.scheduler';
import { NotificationGateway } from './notification.gateway';

import { MailService } from '../utils/mail.service';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { FamilyMember } from '../family/model/family-member.model';
import { Notification } from './model/notification.model';
import { NotificationRecipient } from './model/notification-recipients.model';
import { FamilyLink } from '../family/model/family-link.model';
import { TreeLinkRequest } from '../family/model/tree-link-request.model';
import { TreeLink } from '../family/model/tree-link.model';
import { FamilyModule } from '../family/family.module';
import { UserModule } from '../user/user.module';
import { BlockingModule } from '../blocking/blocking.module';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Notification,
      NotificationRecipient,
      User,
      UserProfile,
      FamilyMember,
      FamilyLink,
      TreeLinkRequest,
      TreeLink,
    ]),
    ScheduleModule.forRoot(),
    JwtModule.registerAsync({
    useFactory: () => ({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '7d' },
    }),
  }),
    forwardRef(() => FamilyModule),
    forwardRef(() => UserModule),
    BlockingModule,
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService, 
    NotificationScheduler,
    NotificationGateway,
    MailService,
    {
      provide: 'SEQUELIZE',
      useExisting: Sequelize,
    },
  ],
  exports: [
    NotificationService,
    NotificationGateway,
    MailService,
    SequelizeModule,
  ],
})
export class NotificationModule {}
