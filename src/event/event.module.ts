import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { EventController } from './event.controller';
import { EventService } from '../event/event.service';
import { Event } from './model/event.model';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { NotificationModule } from '../notification/notification.module';
import { EventImage } from './model/event-image.model';

@Module({
  imports: [
    SequelizeModule.forFeature([Event, User, UserProfile, EventImage]),
    NotificationModule, // Import NotificationModule to use NotificationService
  ],
  controllers: [EventController],
  providers: [EventService],
  exports: [EventService],
})
export class EventModule {}
