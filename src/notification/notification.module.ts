import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationScheduler } from './notification.scheduler';
import { ScheduleModule } from '@nestjs/schedule';
import { MailService } from '../utils/mail.service';
import { DashboardNotification } from './notification.model';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    SequelizeModule.forFeature([DashboardNotification]),
  ],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationScheduler, MailService],
  exports: [NotificationService, MailService],
})
export class NotificationModule {}
