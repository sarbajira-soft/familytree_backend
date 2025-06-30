import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Event } from './model/event.model';
import { CreateEventDto } from './dto/event.dto';
import { UserProfile } from '../user/model/user-profile.model';
import { NotificationService } from '../notification/notification.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class EventService {
  constructor(
    @InjectModel(Event)
    private readonly eventModel: typeof Event,

    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,

    private readonly notificationService: NotificationService,
  ) {}

  async createEvent(dto: CreateEventDto, createdBy: number) {
    // Optional: await this.validateFamilyCode(dto.familyCode, createdBy);

    const event = await this.eventModel.create({
      ...dto,
      createdBy,
    });

    // Create notifications for all family members after event creation
    try {
      // await this.notificationService.createEventNotificationForFamily(
      //   dto.familyCode,
      //   dto.eventName,
      //   dto.eventStartDate,
      //   dto.eventDescription,
      //   createdBy,
      // );
    } catch (error) {
      console.error('Failed to create event notifications:', error);
      // Don't throw error here - event creation should succeed even if notifications fail
    }

    return {
      message: 'Event created successfully',
      data: event,
    };
  }

  async getAll() {
    return this.eventModel.findAll();
  }

  async getByFamilyCode(familyCode: string) {
    return this.eventModel.findAll({
      where: {
        familyCode,
        status: 1,
      },
    });
  }

  async getById(id: number) {
    const event = await this.eventModel.findByPk(id);
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async update(id: number, dto: any, loggedId?: number) {
    const event = await this.eventModel.findByPk(id);
    if (!event) throw new NotFoundException('Event not found');

    // Optional: await this.validateFamilyCode(dto.familyCode, loggedId);

    // Delete old image if new one provided
    if (
      dto.eventImage &&
      event.eventImage &&
      dto.eventImage !== event.eventImage
    ) {
      const uploadDir =
        process.env.EVENT_IMAGE_UPLOAD_PATH || './uploads/events';
      const oldFilePath = path.join(uploadDir, event.eventImage);
      if (fs.existsSync(oldFilePath)) {
        try {
          fs.unlinkSync(oldFilePath);
          console.log('Old event image deleted:', oldFilePath);
        } catch (err) {
          console.warn('Failed to delete old image:', err.message);
        }
      }
    }

    dto.createdBy = loggedId;
    await event.update(dto);

    // Create notifications for event update if significant changes
    if (dto.eventName || dto.eventStartDate || dto.eventDescription) {
      try {
        // await this.notificationService.createEventNotificationForFamily(
        //   dto.familyCode || event.familyCode,
        //   dto.eventName || event.eventName,
        //   dto.eventStartDate || event.eventStartDate,
        //   `Event Updated: ${dto.eventDescription || event.eventDescription}`,
        //   loggedId,
        // );
      } catch (error) {
        console.error('Failed to create event update notifications:', error);
      }
    }

    return {
      message: 'Event updated successfully',
      data: event,
    };
  }

  async delete(id: number, loggedId?: number) {
    const event = await this.eventModel.findByPk(id);
    if (!event) throw new NotFoundException('Event not found');

    // Optional: await this.validateUserFamilyAccess(event.familyCode, loggedId);

    if (event.eventImage) {
      const uploadDir =
        process.env.EVENT_IMAGE_UPLOAD_PATH || './uploads/events';
      const imagePath = path.join(uploadDir, event.eventImage);
      if (fs.existsSync(imagePath)) {
        try {
          fs.unlinkSync(imagePath);
        } catch (err) {
          console.warn('Failed to delete event image:', err.message);
        }
      }
    }

    // Create cancellation notification before deleting
    try {
      // await this.notificationService.createEventNotificationForFamily(
      //   event.familyCode,
      //   event.eventName,
      //   event.eventStartDate,
      //   `Event Cancelled: ${event.eventDescription || 'This event has been cancelled'}`,
      //   loggedId,
      // );
    } catch (error) {
      console.error(
        'Failed to create event cancellation notifications:',
        error,
      );
    }

    await event.destroy();
    return { message: 'Event deleted successfully' };
  }

  // Optional validations (use if needed):
  private async validateFamilyCode(familyCode: string, userId: number) {
    const userProfile = await this.userProfileModel.findOne({
      where: { userId },
    });

    if (!userProfile) {
      throw new NotFoundException('User profile not found');
    }

    if (userProfile.familyCode !== familyCode) {
      throw new ForbiddenException(
        'You can only create/access events for your family',
      );
    }
  }

  private async validateUserFamilyAccess(
    eventFamilyCode: string,
    userId: number,
  ) {
    const userProfile = await this.userProfileModel.findOne({
      where: { userId },
    });

    if (!userProfile) {
      throw new NotFoundException('User profile not found');
    }

    if (userProfile.familyCode !== eventFamilyCode) {
      throw new ForbiddenException(
        'You can only access events from your family',
      );
    }
  }
}
