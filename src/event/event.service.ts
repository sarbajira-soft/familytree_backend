import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Event } from './model/event.model';
import { CreateEventDto } from './dto/event.dto';
import { UserProfile } from '../user/model/user-profile.model';
import { User } from '../user/model/user.model';
import { NotificationService } from '../notification/notification.service';
import * as fs from 'fs';
import * as path from 'path';
import { Op } from 'sequelize';
import { EventImage } from './model/event-image.model';
import { FamilyMember } from '../family/model/family-member.model';
import { UploadService } from '../uploads/upload.service';
 
@Injectable()
export class EventService {
  constructor(
    @InjectModel(Event)
    private readonly eventModel: typeof Event,

    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,

    @InjectModel(User)
    private readonly userModel: typeof User,

    @InjectModel(EventImage)
    private readonly eventImageModel: typeof EventImage,

    @InjectModel(FamilyMember)
    private readonly familyMemberModel: typeof FamilyMember,

    private readonly notificationService: NotificationService,
  ) {}

  async createEvent(dto: CreateEventDto, imageFiles?: Express.Multer.File[]) {
    const event = await this.eventModel.create(dto);
    const uploadService = new UploadService();

    // Save images if provided
    if (imageFiles && imageFiles.length > 0) {
      try {
        // Upload files to S3 and get URLs
        const uploadPromises = imageFiles.map(file => 
          uploadService.uploadFile(file, 'events')
        );
        
        const imageUrls = await Promise.all(uploadPromises);
        
        // Save image references to database
        await Promise.all(
          imageUrls.map(imageUrl => 
            this.eventImageModel.create({ 
              eventId: event.id, 
              imageUrl: this.getEventImageFilenameFromUrl(imageUrl) || imageUrl 
            })
          )
        );
      } catch (error) {
        console.error('Error uploading event images:', error);
        // Clean up event if image upload fails
        await event.destroy();
        throw new Error('Failed to upload event images');
      }
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
    
    // If it's already a full URL, return as is
    if (filename.startsWith('http://') || filename.startsWith('https://')) {
      return filename;
    }

    // If S3 is configured, construct S3 URL
    if (process.env.AWS_S3_BUCKET_NAME && process.env.AWS_REGION) {
      return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/events/${filename}`;
    }

    // Fallback to local URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const uploadPath = process.env.EVENT_IMAGE_UPLOAD_PATH?.replace(/^\.?\/?/, '') || 'uploads/events';
    return `${baseUrl.replace(/\/$/, '')}/${uploadPath.replace(/\/$/, '')}/${filename}`;
  }

  private getEventImageFilenameFromUrl(url: string): string | null {
    if (!url) return null;
    
    try {
      const parsedUrl = new URL(url);
      // Extract the filename from the path
      return parsedUrl.pathname.split('/').pop() || null;
    } catch (e) {
      // If it's not a valid URL, return as is (might already be a filename)
      return url;
    }
  }

  private constructProfileImageUrl(filename: string): string {
    if (!filename) return null;
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const uploadPath = process.env.PROFILE_IMAGE_UPLOAD_PATH?.replace(/^\.?\/?/, '') || 'uploads/profile';
    return `${baseUrl.replace(/\/$/, '')}/${uploadPath.replace(/\/$/, '')}/${filename}`;
  }

  async getAll(userId?: number) {
    let events;
    if (userId) {
      // Get user's family code from familymembers table with approved status
      const familyMember = await this.familyMemberModel.findOne({ 
        where: { 
          memberId: userId,
          approveStatus: 'approved'
        } 
      });
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
    const events = await this.eventModel.findAll({
      where: { 
        createdBy: userId,
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

  async update(
    id: number, 
    dto: any, 
    imageFiles?: Express.Multer.File[], 
    imagesToRemove?: number[], 
    loggedId?: number
  ) {
    const event = await this.eventModel.findByPk(id, { include: [EventImage] });
    if (!event) throw new NotFoundException('Event not found');

    // Check authorization: only creator or admin/superadmin can update
    if (loggedId) {
      const user = await this.userModel.findByPk(loggedId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Check if user is admin (role 2) or superadmin (role 3) or is the creator
      const isAdmin = user.role === 2 || user.role === 3;
      const isCreator = event.createdBy === loggedId;

      if (!isAdmin && !isCreator) {
        throw new ForbiddenException('You can only update events that you created or you need admin privileges');
      }
    }

    // Handle image updates
    if (imageFiles || imagesToRemove || dto.eventImages) {
      const oldImages = event.images || [];
      const uploadDir = process.env.EVENT_IMAGE_UPLOAD_PATH || 'uploads/events';

      // Extract existing image URLs from dto.eventImages (if they are URLs, not binary files)
      const existingImageUrls: string[] = [];
      if (dto.eventImages && Array.isArray(dto.eventImages)) {
        dto.eventImages.forEach((img: any) => {
          if (typeof img === 'string' && (img.startsWith('http://') || img.startsWith('https://'))) {
            // Extract filename from URL
            const urlParts = img.split('/');
            const filename = urlParts[urlParts.length - 1];
            existingImageUrls.push(filename);
          }
        });
      }

      // Remove images that are not in the existingImageUrls list (unless they are in imagesToRemove)
      const imagesToKeep = oldImages.filter(img => {
        const shouldKeep = existingImageUrls.includes(img.imageUrl);
        const shouldRemove = imagesToRemove && imagesToRemove.includes(img.id);
        return shouldKeep && !shouldRemove;
      });

      // Remove images that are not being kept
      const imagesToDelete = oldImages.filter(img => {
        const shouldKeep = existingImageUrls.includes(img.imageUrl);
        const shouldRemove = imagesToRemove && imagesToRemove.includes(img.id);
        return !shouldKeep || shouldRemove;
      });

      // Delete files and database records for removed images
      const uploadService = new UploadService();
      for (const img of imagesToDelete) {
        try {
          const imageUrl = this.constructEventImageUrl(img.imageUrl);
          if (imageUrl.includes('amazonaws.com')) {
            // Delete from S3
            await uploadService.deleteFile(imageUrl);
          } else {
            // Local file deletion
            const imagePath = path.join(uploadDir, img.imageUrl);
            if (fs.existsSync(imagePath)) {
              fs.unlinkSync(imagePath);
            }
          }
          await img.destroy();
        } catch (error) {
          console.error('Error deleting event image:', error);
          // Continue with other deletions even if one fails
        }
      }

      // Add new images from uploaded files
      if (imageFiles && imageFiles.length > 0) {
        try {
          // Upload files to S3 and get URLs
          const uploadPromises = imageFiles.map(file => 
            uploadService.uploadFile(file, 'events')
          );
          
          const imageUrls = await Promise.all(uploadPromises);
          
          // Save image references to database
          await Promise.all(
            imageUrls.map(imageUrl => 
              this.eventImageModel.create({ 
                eventId: event.id, 
                imageUrl: this.getEventImageFilenameFromUrl(imageUrl) || imageUrl 
              })
            )
          );
        } catch (error) {
          console.error('Error uploading new event images:', error);
          throw new Error('Failed to upload new event images');
        }
      }
    }

    // Remove eventImages from dto as it's handled separately
    delete dto.eventImages;
    dto.createdBy = loggedId;
    await event.update(dto);

    return {
      message: 'Event updated successfully',
      data: event,
    };
  }

  async delete(id: number, loggedId?: number) {
    const event = await this.eventModel.findByPk(id, { include: [EventImage] });
    if (!event) throw new NotFoundException('Event not found');

    // Check authorization: only creator or admin/superadmin can delete
    if (loggedId) {
      const user = await this.userModel.findByPk(loggedId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Check if user is admin (role 2) or superadmin (role 3) or is the creator
      const isAdmin = user.role === 2 || user.role === 3;
      const isCreator = event.createdBy === loggedId;

      if (!isAdmin && !isCreator) {
        throw new ForbiddenException('You can only delete events that you created or you need admin privileges');
      }
    }

    // Delete event images from S3 or local storage
    const uploadService = new UploadService();
    const uploadDir = process.env.EVENT_IMAGE_UPLOAD_PATH || 'uploads/events';
    
    for (const img of event.images || []) {
      try {
        const imageUrl = this.constructEventImageUrl(img.imageUrl);
        if (imageUrl.includes('amazonaws.com')) {
          // Delete from S3
          await uploadService.deleteFile(imageUrl);
        } else {
          // Local file deletion
          const imagePath = path.join(uploadDir, img.imageUrl);
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
          }
        }
        await img.destroy();
      } catch (error) {
        console.error('Error deleting event image:', error);
        // Continue with other deletions even if one fails
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

  async getUpcoming(userId?: number) {
    const today = new Date();
    let events = [];

    if (userId) {
      const familyMember = await this.familyMemberModel.findOne({ 
        where: { 
          memberId: userId,
          approveStatus: 'approved'
        } 
      });
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
        eventType: 'custom',
        eventImages,
      };
    });
  }

  async getUpcomingBirthdays(userId?: number) {
    const today = new Date();
    const currentYear = today.getFullYear();
    const nextYear = currentYear + 1;
    
    let familyCode = null;

    if (userId) {
      const familyMember = await this.familyMemberModel.findOne({ 
        where: { 
          memberId: userId,
          approveStatus: 'approved'
        } 
      });
      if (familyMember && familyMember.familyCode) {
        familyCode = familyMember.familyCode;
      }
    }

    if (!familyCode) {
      return [];
    }

    // Get family members with their profiles using direct query - only approved members
    const { QueryTypes } = require('sequelize');
    const familyMembers: any[] = await this.familyMemberModel.sequelize.query(`
      SELECT 
        fm."memberId",
        fm."familyCode",
        up."firstName",
        up."lastName",
        up."profile",
        up."dob"
      FROM ft_family_members fm
      INNER JOIN ft_user_profile up ON fm."memberId" = up."userId"
      WHERE fm."familyCode" = :familyCode
      AND fm."approveStatus" = 'approved'
    `, {
      replacements: { familyCode },
      type: QueryTypes.SELECT
    });

    const upcomingBirthdays = [];

    // Process birthdays
    for (const member of familyMembers) {
      if (member.dob) {
        const dob = new Date(member.dob);
        const nextBirthday = new Date(currentYear, dob.getMonth(), dob.getDate());
        
        // If birthday has passed this year, check next year
        if (nextBirthday < today) {
          nextBirthday.setFullYear(nextYear);
        }

        // Only include if birthday is within next 30 days
        const daysUntilBirthday = Math.ceil((nextBirthday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntilBirthday <= 30) {
          upcomingBirthdays.push({
            id: `birthday_${member.memberId}`,
            eventTitle: `Birthday - ${member.firstName} ${member.lastName}`,
            eventDescription: `Happy Birthday! 🎉`,
            eventDate: nextBirthday.toISOString().split('T')[0],
            eventTime: null,
            location: null,
            familyCode: familyCode,
            createdBy: member.memberId,
            status: 1,
            eventType: 'birthday',
            memberDetails: {
              firstName: member.firstName,
              lastName: member.lastName,
              profileImage: this.constructProfileImageUrl(member.profile),
              message: `Wishing ${member.firstName} a wonderful birthday! 🎂🎈`,
              age: nextBirthday.getFullYear() - dob.getFullYear()
            },
            eventImages: []
          });
        }
      }
    }

    return upcomingBirthdays.sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());
  }

  async getUpcomingAnniversaries(userId?: number) {
    const today = new Date();
    const currentYear = today.getFullYear();
    const nextYear = currentYear + 1;
    
    let familyCode = null;

    if (userId) {
      const familyMember = await this.familyMemberModel.findOne({ 
        where: { 
          memberId: userId,
          approveStatus: 'approved'
        } 
      });
      if (familyMember && familyMember.familyCode) {
        familyCode = familyMember.familyCode;
      }
    }

    if (!familyCode) {
      return [];
    }

    // Get family members with their profiles using direct query - only approved members
    const { QueryTypes } = require('sequelize');
    const familyMembers: any[] = await this.familyMemberModel.sequelize.query(`
      SELECT 
        fm."memberId",
        fm."familyCode",
        up."firstName",
        up."lastName",
        up."profile",
        up."marriageDate",
        up."spouseName"
      FROM ft_family_members fm
      INNER JOIN ft_user_profile up ON fm."memberId" = up."userId"
      WHERE fm."familyCode" = :familyCode
      AND fm."approveStatus" = 'approved'
    `, {
      replacements: { familyCode },
      type: QueryTypes.SELECT
    });

    const upcomingAnniversaries = [];

    // Process marriage anniversaries
    for (const member of familyMembers) {
      if (member.marriageDate) {
        const marriageDate = new Date(member.marriageDate);
        const nextAnniversary = new Date(currentYear, marriageDate.getMonth(), marriageDate.getDate());
        
        // If anniversary has passed this year, check next year
        if (nextAnniversary < today) {
          nextAnniversary.setFullYear(nextYear);
        }

        // Only include if anniversary is within next 30 days
        const daysUntilAnniversary = Math.ceil((nextAnniversary.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntilAnniversary <= 30) {
          const yearsOfMarriage = nextAnniversary.getFullYear() - marriageDate.getFullYear();
          upcomingAnniversaries.push({
            id: `anniversary_${member.memberId}`,
            eventTitle: `Marriage Anniversary - ${member.firstName} ${member.lastName}`,
            eventDescription: `Happy ${yearsOfMarriage}${this.getOrdinalSuffix(yearsOfMarriage)} Anniversary! 💕`,
            eventDate: nextAnniversary.toISOString().split('T')[0],
            eventTime: null,
            location: null,
            familyCode: familyCode,
            createdBy: member.memberId,
            status: 1,
            eventType: 'anniversary',
            memberDetails: {
              firstName: member.firstName,
              lastName: member.lastName,
              profileImage: this.constructProfileImageUrl(member.profile),
              message: `Congratulations on your ${yearsOfMarriage}${this.getOrdinalSuffix(yearsOfMarriage)} wedding anniversary! 💑`,
              spouseName: member.spouseName,
              yearsOfMarriage: yearsOfMarriage
            },
            eventImages: []
          });
        }
      }
    }

    return upcomingAnniversaries.sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());
  }

  async getAllUpcomingEvents(userId?: number) {
    const [customEvents, birthdays, anniversaries] = await Promise.all([
      this.getUpcoming(userId),
      this.getUpcomingBirthdays(userId),
      this.getUpcomingAnniversaries(userId)
    ]);

    // Combine all events and sort by date
    const allEvents = [
      ...customEvents,
      ...birthdays,
      ...anniversaries
    ].sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());

    return allEvents;
  }

  async getUpcomingByFamilyCode(familyCode: string) {
    const [customEvents, birthdays, anniversaries] = await Promise.all([
      this.getByFamilyCode(familyCode),
      this.getUpcomingBirthdaysByFamilyCode(familyCode),
      this.getUpcomingAnniversariesByFamilyCode(familyCode)
    ]);

    // Combine all events and sort by date
    const allEvents = [
      ...customEvents,
      ...birthdays,
      ...anniversaries
    ].sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());

    return allEvents;
  }

  private async getUpcomingBirthdaysByFamilyCode(familyCode: string) {
    const today = new Date();
    const currentYear = today.getFullYear();
    const nextYear = currentYear + 1;

    // Get family members with their profiles using direct query - only approved members
    const { QueryTypes } = require('sequelize');
    const familyMembers: any[] = await this.familyMemberModel.sequelize.query(`
      SELECT 
        fm."memberId",
        fm."familyCode",
        up."firstName",
        up."lastName",
        up."profile",
        up."dob"
      FROM ft_family_members fm
      INNER JOIN ft_user_profile up ON fm."memberId" = up."userId"
      WHERE fm."familyCode" = :familyCode
      AND fm."approveStatus" = 'approved'
    `, {
      replacements: { familyCode },
      type: QueryTypes.SELECT
    });

    const upcomingBirthdays = [];

    // Process birthdays
    for (const member of familyMembers) {
      if (member.dob) {
        const dob = new Date(member.dob);
        const nextBirthday = new Date(currentYear, dob.getMonth(), dob.getDate());
        
        // If birthday has passed this year, check next year
        if (nextBirthday < today) {
          nextBirthday.setFullYear(nextYear);
        }

        // Only include if birthday is within next 30 days
        const daysUntilBirthday = Math.ceil((nextBirthday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntilBirthday <= 30) {
          upcomingBirthdays.push({
            id: `birthday_${member.memberId}`,
            eventTitle: `Birthday - ${member.firstName} ${member.lastName}`,
            eventDescription: `Happy Birthday! 🎉`,
            eventDate: nextBirthday.toISOString().split('T')[0],
            eventTime: null,
            location: null,
            familyCode: familyCode,
            createdBy: member.memberId,
            status: 1,
            eventType: 'birthday',
            memberDetails: {
              firstName: member.firstName,
              lastName: member.lastName,
              profileImage: this.constructProfileImageUrl(member.profile),
              message: `Wishing ${member.firstName} a wonderful birthday! 🎂🎈`,
              age: nextBirthday.getFullYear() - dob.getFullYear()
            },
            eventImages: []
          });
        }
      }
    }

    return upcomingBirthdays.sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());
  }

  private async getUpcomingAnniversariesByFamilyCode(familyCode: string) {
    const today = new Date();
    const currentYear = today.getFullYear();
    const nextYear = currentYear + 1;

    // Get family members with their profiles using direct query - only approved members
    const { QueryTypes } = require('sequelize');
    const familyMembers: any[] = await this.familyMemberModel.sequelize.query(`
      SELECT 
        fm.memberId,
        fm.familyCode,
        up.firstName,
        up.lastName,
        up.profile,
        up.marriageDate,
        up.spouseName
      FROM ft_family_members fm
      INNER JOIN ft_user_profile up ON fm.memberId = up.userId
      WHERE fm.familyCode = :familyCode
      AND fm.approveStatus = 'approved'
    `, {
      replacements: { familyCode },
      type: QueryTypes.SELECT
    });

    const upcomingAnniversaries = [];

    // Process marriage anniversaries
    for (const member of familyMembers) {
      if (member.marriageDate) {
        const marriageDate = new Date(member.marriageDate);
        const nextAnniversary = new Date(currentYear, marriageDate.getMonth(), marriageDate.getDate());
        
        // If anniversary has passed this year, check next year
        if (nextAnniversary < today) {
          nextAnniversary.setFullYear(nextYear);
        }

        // Only include if anniversary is within next 30 days
        const daysUntilAnniversary = Math.ceil((nextAnniversary.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntilAnniversary <= 30) {
          const yearsOfMarriage = nextAnniversary.getFullYear() - marriageDate.getFullYear();
          upcomingAnniversaries.push({
            id: `anniversary_${member.memberId}`,
            eventTitle: `Marriage Anniversary - ${member.firstName} ${member.lastName}`,
            eventDescription: `Happy ${yearsOfMarriage}${this.getOrdinalSuffix(yearsOfMarriage)} Anniversary! 💕`,
            eventDate: nextAnniversary.toISOString().split('T')[0],
            eventTime: null,
            location: null,
            familyCode: familyCode,
            createdBy: member.memberId,
            status: 1,
            eventType: 'anniversary',
            memberDetails: {
              firstName: member.firstName,
              lastName: member.lastName,
              profileImage: this.constructProfileImageUrl(member.profile),
              message: `Congratulations on your ${yearsOfMarriage}${this.getOrdinalSuffix(yearsOfMarriage)} wedding anniversary! 💑`,
              spouseName: member.spouseName,
              yearsOfMarriage: yearsOfMarriage
            },
            eventImages: []
          });
        }
      }
    }

    return upcomingAnniversaries.sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());
  }

  private getOrdinalSuffix(num: number): string {
    const j = num % 10;
    const k = num % 100;
    if (j === 1 && k !== 11) {
      return "st";
    }
    if (j === 2 && k !== 12) {
      return "nd";
    }
    if (j === 3 && k !== 13) {
      return "rd";
    }
    return "th";
  }

  async addEventImages(eventId: number, imageFiles: string[], loggedId?: number) {
    const event = await this.eventModel.findByPk(eventId);
    if (!event) throw new NotFoundException('Event not found');

    // Check authorization: only creator or admin/superadmin can add images
    if (loggedId) {
      const user = await this.userModel.findByPk(loggedId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Check if user is admin (role 2) or superadmin (role 3) or is the creator
      const isAdmin = user.role === 2 || user.role === 3;
      const isCreator = event.createdBy === loggedId;

      if (!isAdmin && !isCreator) {
        throw new ForbiddenException('You can only add images to events that you created or you need admin privileges');
      }
    }

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

  async deleteEventImage(imageId: number, loggedId?: number) {
    const image = await this.eventImageModel.findByPk(imageId, { include: [Event] });
    if (!image) throw new NotFoundException('Image not found');

    // Check authorization: only creator or admin/superadmin can delete images
    if (loggedId) {
      const user = await this.userModel.findByPk(loggedId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Check if user is admin (role 2) or superadmin (role 3) or is the creator
      const isAdmin = user.role === 2 || user.role === 3;
      const isCreator = image.event?.createdBy === loggedId;

      if (!isAdmin && !isCreator) {
        throw new ForbiddenException('You can only delete images from events that you created or you need admin privileges');
      }
    }

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
