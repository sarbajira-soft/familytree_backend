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
import { EventGateway } from './event.gateway';
import { BlockingService } from '../blocking/blocking.service';
import { FamilyLink } from '../family/model/family-link.model';
 
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

    @InjectModel(FamilyLink)
    private readonly familyLinkModel: typeof FamilyLink,

    private readonly notificationService: NotificationService,
    private readonly eventGateway: EventGateway,

    private readonly blockingService: BlockingService,
  ) {}

  private normalizeOptionalString(value: any): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async assertUserCanAccessFamilyContent(
    userId: number,
    familyCode: string,
  ): Promise<void> {
    if (!userId || !familyCode) {
      throw new ForbiddenException('Not allowed to access this family content');
    }

    const membership = await this.familyMemberModel.findOne({
      where: { memberId: userId, familyCode },
    });

    if (!membership || (membership as any).approveStatus !== 'approved') {
      throw new ForbiddenException('Not allowed to access this family content');
    }

    if ((membership as any).isBlocked) {
      throw new ForbiddenException('You have been blocked from this family');
    }
  }

  private async getAccessibleFamilyCodesForUser(userId: number): Promise<string[]> {
    if (!userId) {
      return [];
    }

    const memberships = await this.familyMemberModel.findAll({
      where: { memberId: userId, approveStatus: 'approved' } as any,
      attributes: ['familyCode', 'isBlocked'],
    });

    const base = Array.from(
      new Set(
        (memberships as any[])
          .filter((m: any) => !!(m as any).familyCode && !(m as any).isBlocked)
          .map((m: any) => String((m as any).familyCode)),
      ),
    );

    if (base.length === 0) {
      return [];
    }

    const links = await this.familyLinkModel.findAll({
      where: {
        status: 'active',
        [Op.or]: [
          { familyCodeLow: { [Op.in]: base } },
          { familyCodeHigh: { [Op.in]: base } },
        ],
      } as any,
      attributes: ['familyCodeLow', 'familyCodeHigh'],
    });

    const candidate = new Set<string>(base);
    for (const l of links as any[]) {
      const low = String((l as any).familyCodeLow);
      const high = String((l as any).familyCodeHigh);
      if (base.includes(low)) candidate.add(high);
      if (base.includes(high)) candidate.add(low);
    }

    return Array.from(candidate);
  }

  private async assertUserCanAccessFamilyOrLinked(
    userId: number,
    familyCode: string,
  ): Promise<void> {
    if (!userId || !familyCode) {
      throw new ForbiddenException('Not allowed to access this family content');
    }
    const accessible = await this.getAccessibleFamilyCodesForUser(userId);
    if (!accessible.includes(String(familyCode))) {
      throw new ForbiddenException('Not allowed to access this family content');
    }
  }

  async createEvent(
    dto: CreateEventDto,
    imageFiles?: Express.Multer.File[],
    requestingUserId?: number,
  ) {
    (dto as any).eventTitle = typeof (dto as any).eventTitle === 'string' ? (dto as any).eventTitle.trim() : (dto as any).eventTitle;
    (dto as any).eventDescription = this.normalizeOptionalString((dto as any).eventDescription);
    (dto as any).eventTime = this.normalizeOptionalString((dto as any).eventTime);
    (dto as any).location = this.normalizeOptionalString((dto as any).location);
    (dto as any).familyCode = typeof (dto as any).familyCode === 'string' ? (dto as any).familyCode.trim() : (dto as any).familyCode;

    if (dto.familyCode) {
      const actor = requestingUserId ?? dto.createdBy ?? dto.userId;
      if (actor) {
        await this.assertUserCanAccessFamilyContent(actor, dto.familyCode);
      }
    }

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

    // Broadcast new event via WebSocket
    if (dto.familyCode) {
      this.eventGateway.broadcastNewEvent(dto.familyCode, {
        id: event.id,
        eventTitle: event.eventTitle,
        eventDate: event.eventDate,
        eventDescription: event.eventDescription,
        familyCode: event.familyCode,
        createdBy: event.createdBy,
        createdAt: event.createdAt,
      });
    }

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
    if (process.env.S3_BUCKET_NAME && process.env.REGION) {
      return `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.REGION}.amazonaws.com/events/${filename}`;
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
    const baseUrl = process.env.S3_BUCKET_URL || 'http://localhost:3000';
    const uploadPath = 'profile';
    return `${baseUrl}/${uploadPath}/${filename}`;
  }

  async getAll(userId?: number) {
    let events;
    if (userId) {
      const accessibleFamilyCodes = await this.getAccessibleFamilyCodesForUser(userId);
      if (accessibleFamilyCodes.length === 0) {
        events = [];
      } else {
        const blockedUserIds = await this.blockingService.getBlockedUserIdsForUser(userId);
        events = await this.eventModel.findAll({
          where: {
            familyCode: { [Op.in]: accessibleFamilyCodes },
            ...(blockedUserIds.length > 0
              ? { createdBy: { [Op.notIn]: blockedUserIds } }
              : {}),
          },
          include: [EventImage],
        });
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
    const familyMember = await this.familyMemberModel.findOne({
      where: {
        memberId: userId,
        approveStatus: 'approved',
      },
    });

    if (familyMember && (familyMember as any).familyCode) {
      if ((familyMember as any).isBlocked) {
        throw new ForbiddenException('You have been blocked from this family');
      }
    }

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

  async getById(id: number, requestingUserId?: number) {
    const event = await this.eventModel.findByPk(id, { include: [EventImage] });
    if (!event) throw new NotFoundException('Event not found');

    if (requestingUserId && event.familyCode) {
      await this.assertUserCanAccessFamilyOrLinked(requestingUserId, event.familyCode);
      const usersBlockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
        requestingUserId,
        event.createdBy,
      );
      if (usersBlockedEitherWay && event.createdBy !== requestingUserId) {
        throw new NotFoundException('Event not found');
      }
    }

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
    if (dto && typeof dto === 'object') {
      if (dto.eventTitle !== undefined && typeof dto.eventTitle === 'string') {
        dto.eventTitle = dto.eventTitle.trim();
      }
      dto.eventDescription = this.normalizeOptionalString(dto.eventDescription);
      dto.eventTime = this.normalizeOptionalString(dto.eventTime);
      dto.location = this.normalizeOptionalString(dto.location);
      if (dto.familyCode !== undefined && typeof dto.familyCode === 'string') {
        dto.familyCode = dto.familyCode.trim();
      }
    }

    const event = await this.eventModel.findByPk(id, { include: [EventImage] });
    if (!event) throw new NotFoundException('Event not found');

    if (loggedId && event.familyCode) {
      await this.assertUserCanAccessFamilyContent(loggedId, event.familyCode);
    }

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
    const hasNewImageFiles = Array.isArray(imageFiles) && imageFiles.length > 0;
    const hasImagesToRemove = Array.isArray(imagesToRemove) && imagesToRemove.length > 0;

    // dto.eventImages can be a single string or an array of strings (URLs)
    let eventImagesInput: any[] = [];
    if (dto.eventImages) {
      eventImagesInput = Array.isArray(dto.eventImages)
        ? dto.eventImages
        : [dto.eventImages];
    }
    const hasEventImages = eventImagesInput.length > 0;

    // Only run image logic if there is an actual change request
    if (hasNewImageFiles || hasImagesToRemove || hasEventImages) {
      const oldImages = event.images || [];
      const uploadDir = process.env.EVENT_IMAGE_UPLOAD_PATH || 'uploads/events';

      // Extract existing image filenames from dto.eventImages (if they are URLs)
      const existingImageUrls: string[] = [];
      eventImagesInput.forEach((img: any) => {
        if (typeof img === 'string' && (img.startsWith('http://') || img.startsWith('https://'))) {
          const urlParts = img.split('/');
          const filename = urlParts[urlParts.length - 1];
          existingImageUrls.push(filename);
        }
      });

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
      if (hasNewImageFiles) {
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

    // Broadcast event update via WebSocket
    this.eventGateway.broadcastEventUpdate(id, event, event.familyCode);

    return {
      message: 'Event updated successfully',
      data: event,
    };
  }

  async delete(id: number, loggedId?: number) {
    const event = await this.eventModel.findByPk(id, { include: [EventImage] });
    if (!event) throw new NotFoundException('Event not found');

    if (loggedId && event.familyCode) {
      await this.assertUserCanAccessFamilyContent(loggedId, event.familyCode);
    }

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

    // Broadcast event deletion via WebSocket before destroying
    const familyCode = event.familyCode;
    this.eventGateway.broadcastEventDeleted(id, familyCode);

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
      const accessibleFamilyCodes = await this.getAccessibleFamilyCodesForUser(userId);
      if (accessibleFamilyCodes.length > 0) {
        const blockedUserIds = await this.blockingService.getBlockedUserIdsForUser(userId);
        events = await this.eventModel.findAll({
          where: {
            eventDate: { [Op.gt]: today },
            status: 1,
            familyCode: { [Op.in]: accessibleFamilyCodes },
            ...(blockedUserIds.length > 0
              ? { createdBy: { [Op.notIn]: blockedUserIds } }
              : {}),
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
    
    const familyCodes = userId ? await this.getAccessibleFamilyCodesForUser(userId) : [];
    if (!familyCodes || familyCodes.length === 0) {
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
      WHERE fm."familyCode" IN (:familyCodes)
      AND fm."approveStatus" = 'approved'
    `, {
      replacements: { familyCodes },
      type: QueryTypes.SELECT
    });

    const blockedUserIds = userId
      ? await this.blockingService.getBlockedUserIdsForUser(userId)
      : [];
    const blockedSet = new Set<number>(blockedUserIds);

    const upcomingBirthdays = [];

    // Process birthdays
    for (const member of familyMembers) {
      if (blockedSet.has(Number(member.memberId))) {
        continue;
      }
      if (member.dob) {
        // Parse date as local date to avoid timezone issues
        const dobString = typeof member.dob === 'string' ? member.dob.split('T')[0] : member.dob.toISOString().split('T')[0]; // Get YYYY-MM-DD part
        const [year, month, day] = dobString.split('-').map(Number);
        
        const nextBirthday = new Date(currentYear, month - 1, day); // month is 0-indexed
        
        // If birthday has passed this year, check next year
        if (nextBirthday < today) {
          nextBirthday.setFullYear(nextYear);
        }

        // Only include if birthday is within next 30 days
        const daysUntilBirthday = Math.ceil((nextBirthday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntilBirthday <= 30) {
          // Format date as YYYY-MM-DD without timezone conversion
          const eventDateString = `${nextBirthday.getFullYear()}-${String(nextBirthday.getMonth() + 1).padStart(2, '0')}-${String(nextBirthday.getDate()).padStart(2, '0')}`;
          
          upcomingBirthdays.push({
            id: `birthday_${member.memberId}`,
            eventTitle: `Birthday - ${member.firstName} ${member.lastName}`,
            eventDescription: `Happy Birthday! 🎉`,
            eventDate: eventDateString,
            eventTime: null,
            location: null,
            familyCode: member.familyCode,
            createdBy: member.memberId,
            status: 1,
            eventType: 'birthday',
            memberDetails: {
              userId: member.memberId,
              firstName: member.firstName,
              lastName: member.lastName,
              profileImage: this.constructProfileImageUrl(member.profile),
              message: `Wishing ${member.firstName} a wonderful birthday! 🎂🎈`,
              age: nextBirthday.getFullYear() - year
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
    
    const familyCodes = userId ? await this.getAccessibleFamilyCodesForUser(userId) : [];
    if (!familyCodes || familyCodes.length === 0) {
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
      WHERE fm."familyCode" IN (:familyCodes)
      AND fm."approveStatus" = 'approved'
    `, {
      replacements: { familyCodes },
      type: QueryTypes.SELECT
    });

    const blockedUserIds = userId
      ? await this.blockingService.getBlockedUserIdsForUser(userId)
      : [];
    const blockedSet = new Set<number>(blockedUserIds);

    const upcomingAnniversaries = [];

    // Process marriage anniversaries
    for (const member of familyMembers) {
      if (blockedSet.has(Number(member.memberId))) {
        continue;
      }
      if (member.marriageDate) {
        // Parse date as local date to avoid timezone issues
        const marriageDateString = typeof member.marriageDate === 'string' ? member.marriageDate.split('T')[0] : member.marriageDate.toISOString().split('T')[0]; // Get YYYY-MM-DD part
        const [year, month, day] = marriageDateString.split('-').map(Number);
        
        const nextAnniversary = new Date(currentYear, month - 1, day); // month is 0-indexed
        
        // If anniversary has passed this year, check next year
        if (nextAnniversary < today) {
          nextAnniversary.setFullYear(nextYear);
        }

        // Only include if anniversary is within next 30 days
        const daysUntilAnniversary = Math.ceil((nextAnniversary.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntilAnniversary <= 30) {
          const yearsOfMarriage = nextAnniversary.getFullYear() - year;
          // Format date as YYYY-MM-DD without timezone conversion
          const eventDateString = `${nextAnniversary.getFullYear()}-${String(nextAnniversary.getMonth() + 1).padStart(2, '0')}-${String(nextAnniversary.getDate()).padStart(2, '0')}`;
          
          upcomingAnniversaries.push({
            id: `anniversary_${member.memberId}`,
            eventTitle: `Marriage Anniversary - ${member.firstName} ${member.lastName}`,
            eventDescription: `Happy ${yearsOfMarriage}${this.getOrdinalSuffix(yearsOfMarriage)} Anniversary! 💕`,
            eventDate: eventDateString,
            eventTime: null,
            location: null,
            familyCode: member.familyCode,
            createdBy: member.memberId,
            status: 1,
            eventType: 'anniversary',
            memberDetails: {
              userId: member.memberId,
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
        // Parse date as local date to avoid timezone issues
        const dobString = typeof member.dob === 'string' ? member.dob.split('T')[0] : member.dob.toISOString().split('T')[0]; // Get YYYY-MM-DD part
        const [year, month, day] = dobString.split('-').map(Number);
        
        const nextBirthday = new Date(currentYear, month - 1, day); // month is 0-indexed
        
        // If birthday has passed this year, check next year
        if (nextBirthday < today) {
          nextBirthday.setFullYear(nextYear);
        }

        // Only include if birthday is within next 30 days
        const daysUntilBirthday = Math.ceil((nextBirthday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntilBirthday <= 30) {
          // Format date as YYYY-MM-DD without timezone conversion
          const eventDateString = `${nextBirthday.getFullYear()}-${String(nextBirthday.getMonth() + 1).padStart(2, '0')}-${String(nextBirthday.getDate()).padStart(2, '0')}`;
          
          upcomingBirthdays.push({
            id: `birthday_${member.memberId}`,
            eventTitle: `Birthday - ${member.firstName} ${member.lastName}`,
            eventDescription: `Happy Birthday! 🎉`,
            eventDate: eventDateString,
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
              age: nextBirthday.getFullYear() - year
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

    if (loggedId && event.familyCode) {
      await this.assertUserCanAccessFamilyContent(loggedId, event.familyCode);
    }

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

    if (loggedId && (image as any).event?.familyCode) {
      await this.assertUserCanAccessFamilyContent(loggedId, (image as any).event.familyCode);
    }

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

  async getEventImages(eventId: number, requestingUserId?: number) {
    // Reuse getById to enforce family-block + user-to-user block visibility
    await this.getById(eventId, requestingUserId);
    const images = await this.eventImageModel.findAll({ where: { eventId } });
    return images.map(img => ({ id: img.id, imageUrl: this.constructEventImageUrl(img.imageUrl) }));
  }

}
