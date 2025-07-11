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
import { EventImage } from './model/event-image.model';
import { FamilyMember } from '../family/model/family-member.model';

@Injectable()
export class EventService {
  constructor(
    @InjectModel(Event)
    private readonly eventModel: typeof Event,

    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,

    @InjectModel(EventImage)
    private readonly eventImageModel: typeof EventImage,

    @InjectModel(FamilyMember)
    private readonly familyMemberModel: typeof FamilyMember,

    private readonly notificationService: NotificationService,
  ) {}

  async createEvent(dto: CreateEventDto, imageFiles?: string[]) {
    const event = await this.eventModel.create(dto);

    // Save images if provided
    if (imageFiles && imageFiles.length > 0) {
      await Promise.all(
        imageFiles.map(imageUrl =>
          this.eventImageModel.create({ eventId: event.id, imageUrl })
        )
      );
    }

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

  async getAll(userId?: number) {
    let events;
    if (userId) {
      // Get user's family code from familymembers table
      const familyMember = await this.familyMemberModel.findOne({ where: { memberId: userId } });
      if (familyMember && familyMember.familyCode) {
        events = await this.eventModel.findAll({ 
          where: { familyCode: familyMember.familyCode },
          include: [EventImage] 
        });
      } else {
        events = [];
      }
    } else {
      events = await this.eventModel.findAll({ include: [EventImage] });
    }
    return events.map(event => {
      const eventJson = event.toJSON();
      const eventImages = eventJson.images?.map(img => this.constructEventImageUrl(img.imageUrl)) || [];
      delete eventJson.user;
      return {
        ...eventJson,
        eventImages,
      };
    });
  }

  async getEventsForUser(userId: number) {
    const familyMember = await this.familyMemberModel.findOne({ where: { memberId: userId } });
    if (!familyMember || !familyMember.familyCode) {
      return [];
    }
    const events = await this.eventModel.findAll({
      where: { 
        familyCode: familyMember.familyCode,
        status: 1 
      },
      include: [EventImage]
    });
    return events.map(event => {
      const eventJson = event.toJSON();
      const eventImages = eventJson.images?.map(img => this.constructEventImageUrl(img.imageUrl)) || [];
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
    const event = await this.eventModel.findByPk(id, { include: [EventImage] });
    if (!event) throw new NotFoundException('Event not found');
    const eventJson = event.toJSON();
    const eventImages = eventJson.images?.map(img => this.constructEventImageUrl(img.imageUrl)) || [];
    delete eventJson.user;
    return {
      ...eventJson,
      eventImages,
    };
  }

  async update(id: number, dto: any, imageFiles?: string[], loggedId?: number) {
    const event = await this.eventModel.findByPk(id, { include: [EventImage] });
    if (!event) throw new NotFoundException('Event not found');

    // Optional: await this.validateFamilyCode(dto.familyCode, loggedId);

    // If new images provided, delete old image files and records
    if (imageFiles && imageFiles.length > 0) {
      const oldImages = event.images || [];
      const uploadDir = process.env.EVENT_IMAGE_UPLOAD_PATH || 'uploads/events';
      for (const img of oldImages) {
        const oldFilePath = path.join(uploadDir, img.imageUrl);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
        await img.destroy();
      }
      // Save new images
      await Promise.all(
        imageFiles.map(imageUrl =>
          this.eventImageModel.create({ eventId: event.id, imageUrl })
        )
      );
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
    const event = await this.eventModel.findByPk(id, { include: [EventImage] });
    if (!event) throw new NotFoundException('Event not found');

    // Delete event images and files
    const uploadDir = process.env.EVENT_IMAGE_UPLOAD_PATH || 'uploads/events';
    for (const img of event.images || []) {
      const imagePath = path.join(uploadDir, img.imageUrl);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
      await img.destroy();
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

  async getUpcoming(userId?: number) {
    const today = new Date();
    let events;
    if (userId) {
      const familyMember = await this.familyMemberModel.findOne({ where: { memberId: userId } });
      if (familyMember && familyMember.familyCode) {
        events = await this.eventModel.findAll({
          where: {
            eventDate: { [Op.gt]: today },
            status: 1,
            familyCode: familyMember.familyCode,
          },
          include: [EventImage],
          order: [['eventDate', 'ASC']],
        });
      } else {
        events = [];
      }
    } else {
      events = await this.eventModel.findAll({
        where: {
          eventDate: { [Op.gt]: today },
          status: 1,
        },
        include: [EventImage],
        order: [['eventDate', 'ASC']],
      });
    }
    return events.map(event => {
      const eventJson = event.toJSON();
      const eventImages = eventJson.images?.map(img => this.constructEventImageUrl(img.imageUrl)) || [];
      delete eventJson.user;
      return {
        ...eventJson,
        eventImages,
      };
    });
  }

  async addEventImages(eventId: number, imageFiles: string[]) {
    const event = await this.eventModel.findByPk(eventId);
    if (!event) throw new NotFoundException('Event not found');
    const createdImages = await Promise.all(
      imageFiles.map(imageUrl =>
        this.eventImageModel.create({ eventId, imageUrl })
      )
    );
    return {
      message: 'Images added successfully',
      images: createdImages.map(img => ({ id: img.id, imageUrl: this.constructEventImageUrl(img.imageUrl) })),
    };
  }

  async deleteEventImage(imageId: number) {
    const image = await this.eventImageModel.findByPk(imageId);
    if (!image) throw new NotFoundException('Image not found');
    const uploadDir = process.env.EVENT_IMAGE_UPLOAD_PATH || 'uploads/events';
    const imagePath = path.join(uploadDir, image.imageUrl);
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
    await image.destroy();
    return { message: 'Image deleted successfully' };
  }

  async getEventImages(eventId: number) {
    const images = await this.eventImageModel.findAll({ where: { eventId } });
    return images.map(img => ({ id: img.id, imageUrl: this.constructEventImageUrl(img.imageUrl) }));
  }
}
