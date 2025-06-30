import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User} from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Family } from './model/family.model';
import { FamilyMember } from './model/family-member.model';
import { MailService } from '../utils/mail.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';

import { CreateFamilyDto } from './dto/create-family.dto';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class FamilyService {
  constructor(
    @InjectModel(User)
    private userModel: typeof User,
    @InjectModel(UserProfile)
    private userProfileModel: typeof UserProfile,
    @InjectModel(Family)
    private familyModel: typeof Family,
    @InjectModel(FamilyMember)
    private familyMemberModel: typeof FamilyMember,
    private mailService: MailService,

    private readonly notificationService: NotificationService,
  ) {}

  async createFamily(dto: CreateFamilyDto, createdBy: number) {
    const existing = await this.familyModel.findOne({ where: { familyCode: dto.familyCode } });
    if (existing) {
      throw new BadRequestException('Family code already exists');
    }

    // Create family
    const created = await this.familyModel.create({
      ...dto,
      createdBy,
    });

    // Add creator to family_member table as default member
    await this.familyMemberModel.create({
      memberId: createdBy,          // The user who created the family
      familyCode: created.familyCode,
      creatorId: null, // No one invited them — they are the creator
      approveStatus: "approved"
    });

    return {
      message: 'Family created successfully',
      data: created,
    };
  }

  async getAll() {
    return await this.familyModel.findAll();
  }

  async getByCode(code: string) {
    const family = await this.familyModel.findOne({ where: { familyCode: code } });
    if (!family) throw new NotFoundException('Family not found');

    const baseUrl = process.env.BASE_URL || '';
    const familyPhotoPath = process.env.FAMILY_PHOTO_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/family';

    // If familyPhoto exists, prepend the full URL; otherwise keep null or empty
    const familyPhotoUrl = family.familyPhoto
      ? `${baseUrl}/${familyPhotoPath}${family.familyPhoto}`
      : null;

    // Return family details with full photo URL
    return {
      ...family.get(), // get raw data values
      familyPhotoUrl,
    };
  }

  async update(id: number, dto: any, newFileName?: string, loggedId?: number) {
    const family = await this.familyModel.findByPk(id);
    if (!family) throw new NotFoundException('Family not found');

    // Delete old file if new file is uploaded
    if (newFileName && family.familyPhoto) {
      const oldFile = family.familyPhoto;
      const uploadDir = process.env.FAMILY_PHOTO_UPLOAD_PATH || './uploads/family';

      if (oldFile && oldFile !== newFileName) {
        const uploadDir = process.env.FAMILY_PHOTO_UPLOAD_PATH || './uploads/family';
        const oldFilePath = path.join(uploadDir, oldFile);

        try {
          if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath);
            console.log('Old file deleted:', oldFilePath);
          } else {
            console.warn('Old file does not exist:', oldFilePath);
          }
        } catch (err) {
          console.warn('Failed to delete old file:', err.message);
        }
      }
    }
    dto.createdBy = loggedId;
    await family.update(dto);
    return { message: 'Family updated successfully', data: family };

  }

  async delete(familyId: number, userId: number) {
    const family = await this.familyModel.findByPk(familyId);
    if (!family) throw new NotFoundException('Family not found');

    const familyCode = family.familyCode;

    // Check if user is an approved admin of this family
    const isAdmin = await this.familyMemberModel.findOne({
      where: {
        memberId: userId,
        familyCode,
        approveStatus: 'approved',
      },
      include: [{
        model: this.userModel,
        as: 'userProfile', // or change based on your association name
        where: {
          role: [2, 3],
        },
      }],
    });

    if (!isAdmin) {
      throw new ForbiddenException('Only family admins can delete this family');
    }

    // Get all family members
    const members = await this.familyMemberModel.findAll({ where: { familyCode } });
    const userIds = members.map((m) => m.memberId);

    // Delete all family members
    await this.familyMemberModel.destroy({ where: { familyCode } });

    // Delete the family
    await family.destroy();

    // Notify members
    if (userIds.length > 0) {
      await this.notificationService.createNotification({
        type: 'FAMILY_REMOVED',
        title: 'Family Deleted',
        message: `The family (${family.familyName}) has been deleted by the admin.`,
        familyCode,
        referenceId: familyId,
        userIds,
      }, userId);
    }

    return { message: 'Family and its members deleted successfully' };
  }

  async searchFamilies(query: string) {
    return await this.familyModel.findAll({
      where: {
        [Op.or]: [
          { familyCode: { [Op.iLike]: `${query}%` } }, // starts with, case-insensitive
          { familyName: { [Op.iLike]: `%${query}%` } },      // contains, case-insensitive
        ],
      },
      limit: 10,
      attributes: ['id', 'familyCode', 'familyName'],
      order: [['familyCode', 'ASC']],
    });
  }

}