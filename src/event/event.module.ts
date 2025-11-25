import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { JwtModule } from '@nestjs/jwt';
import { EventController } from './event.controller';
import { EventService } from '../event/event.service';
import { EventGateway } from './event.gateway';
import { Event } from './model/event.model';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { NotificationModule } from '../notification/notification.module';
import { EventImage } from './model/event-image.model';
import { FamilyMember } from '../family/model/family-member.model';
 
@Module({
  imports: [
    SequelizeModule.forFeature([Event, User, UserProfile, EventImage, FamilyMember]),
    NotificationModule, // Import NotificationModule to use NotificationService
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [EventController],
  providers: [EventService, EventGateway],
  exports: [EventService, EventGateway],
})
export class EventModule {}
