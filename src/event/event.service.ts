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
import { Op } from 'sequelize';

@Injectable()
export class EventService {
  constructor(
    @InjectModel(Event)
    private readonly eventModel: typeof Event,

    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,

    private readonly notificationService: NotificationService,
  ) {}

  async createEvent(dto: CreateEventDto) {
    // Optional: await this.validateFamilyCode(dto.familyCode, dto.userId);

    const event = await this.eventModel.create(dto);

    // Create notifications for all family members after event creation
    // try {
    //   await this.notificationService.createEventNotificationForFamily(
    //     dto.familyCode,
    //     dto.eventTitle,
    //     dto.eventDate,
    //     dto.eventDescription,
    //     dto.createdBy || dto.userId,
    //   );
    // } catch (error) {
    //   console.error('Failed to create event notifications:', error);
    //   // Don't throw error here - event creation should succeed even if notifications fail
    // }

    return {
      message: 'Event created successfully',
      data: event,
    };
  }

  private constructEventImageUrl(filename: string): string {
    if (!filename) return null;
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const uploadPath = process.env.EVENT_IMAGE_UPLOAD_PATH?.replace(/^\.?\/?/, '') || 'uploads/events';
    return `${baseUrl.replace(/\/$/, '')}/${uploadPath.replace(/\/$/, '')}/${filename}`;
  }

  async getAll() {
    const events = await this.eventModel.findAll();
    return events.map(event => {
      const eventJson = event.toJSON();
      let eventImages: string[] = [];
      try {
        const images = JSON.parse(eventJson.eventImages || '[]');
        if (Array.isArray(images)) {
          eventImages = images.map((img: string) => this.constructEventImageUrl(img));
        }
      } catch {
        eventImages = [];
      }
      // Remove user field if present
      delete eventJson.user;
      return {
        ...eventJson,
        eventImages,
      };
    });
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
    const eventJson = event.toJSON();
    let eventImages: string[] = [];
    try {
      const images = JSON.parse(eventJson.eventImages || '[]');
      if (Array.isArray(images)) {
        eventImages = images.map((img: string) => this.constructEventImageUrl(img));
      }
    } catch {
      eventImages = [];
    }
    // Remove user field if present
    delete eventJson.user;
    return {
      ...eventJson,
      eventImages,
    };
  }

  async update(id: number, dto: any, loggedId?: number) {
    const event = await this.eventModel.findByPk(id);
    if (!event) throw new NotFoundException('Event not found');

    // Optional: await this.validateFamilyCode(dto.familyCode, loggedId);

    // Delete old images if new ones provided
    if (dto.eventImages && event.eventImages && dto.eventImages !== event.eventImages) {
      const uploadDir = process.env.EVENT_IMAGE_UPLOAD_PATH || 'uploads/events';
      
      try {
        const oldImages = JSON.parse(event.eventImages);
        if (Array.isArray(oldImages)) {
          oldImages.forEach(imageName => {
            const oldFilePath = path.join(uploadDir, imageName);
            if (fs.existsSync(oldFilePath)) {
              fs.unlinkSync(oldFilePath);
              console.log('Old event image deleted:', oldFilePath);
            }
          });
        }
      } catch (err) {
        console.warn('Failed to delete old images:', err.message);
      }
    }

    dto.createdBy = loggedId;
    await event.update(dto);

    // Create notifications for event update if significant changes
    if (dto.eventTitle || dto.eventDate || dto.eventDescription) {
      try {
        // await this.notificationService.createEventNotificationForFamily(
        //   dto.familyCode || event.familyCode,
        //   dto.eventTitle || event.eventTitle,
        //   dto.eventDate || event.eventDate,
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

    // Delete event images
    if (event.eventImages) {
      const uploadDir = process.env.EVENT_IMAGE_UPLOAD_PATH || 'uploads/events';
      
      try {
        const images = JSON.parse(event.eventImages);
        if (Array.isArray(images)) {
          images.forEach(imageName => {
            const imagePath = path.join(uploadDir, imageName);
            if (fs.existsSync(imagePath)) {
              fs.unlinkSync(imagePath);
            }
          });
        }
      } catch (err) {
        console.warn('Failed to delete event images:', err.message);
      }
    }

    // Create cancellation notification before deleting
    try {
      // await this.notificationService.createEventNotificationForFamily(
      //   event.familyCode,
      //   event.eventTitle,
      //   event.eventDate,
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

  async getUpcoming() {
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const events = await this.eventModel.findAll({
      where: {
        eventDate: { [Op.gte]: today },
        status: 1,
      },
      order: [['eventDate', 'ASC']],
    });
    return events.map(event => {
      const eventJson = event.toJSON();
      let eventImages: string[] = [];
      try {
        const images = JSON.parse(eventJson.eventImages || '[]');
        if (Array.isArray(images)) {
          eventImages = images.map((img: string) => this.constructEventImageUrl(img));
        }
      } catch {
        eventImages = [];
      }
      delete eventJson.user;
      return {
        ...eventJson,
        eventImages,
      };
    });
  }
}
