import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User} from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Family } from './model/family.model';
import { FamilyMember } from './model/family-member.model';
import { FamilyTree } from './model/family-tree.model';
import { MailService } from '../utils/mail.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';

import { CreateFamilyDto } from './dto/create-family.dto';
import { CreateFamilyTreeDto, FamilyTreeMemberDto } from './dto/family-tree.dto';
import { NotificationService } from '../notification/notification.service';
import { saveBase64Image } from '../utils/upload.utils';

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
    @InjectModel(FamilyTree)
    private familyTreeModel: typeof FamilyTree,
    private mailService: MailService,

    private readonly notificationService: NotificationService,
  ) {}

  async createFamily(dto: CreateFamilyDto, createdBy: number) {
    const existing = await this.familyModel.findOne({ where: { familyCode: dto.familyCode } });
    if (existing) {
      throw new BadRequestException('Family code already exists');
    }

    // Update user role to 2 (admin) when creating family
    await this.userModel.update(
      { role: 2 },
      { where: { id: createdBy } }
    );

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

  async createFamilyTree(dto: CreateFamilyTreeDto) {
    const { familyCode, members } = dto;

    // Check if family exists
    const family = await this.familyModel.findOne({ where: { familyCode } });
    if (!family) {
      throw new NotFoundException('Family not found');
    }

    // Remove existing family tree data for this family
    await this.familyTreeModel.destroy({ where: { familyCode } });

    const createdMembers = [];

    for (const member of members) {
      let userId = member.memberId; // Use memberId as userId


      // If user doesn't exist (no memberId), create new user and profile
      if (!userId) {
        // Generate a temporary email
        const tempEmail = `familytree_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;
        // Generate a temporary mobile number
        const tempMobile = `99999${Math.floor(100000 + Math.random() * 899999)}`;
        // Create new user
        const newUser = await this.userModel.create({
          email: tempEmail,
          mobile: tempMobile,
          status: 1, // Active
          role: 1, // Member
        });

        // Handle profile image if provided
        let profileImage = null;
        if (member.img && member.img.startsWith('data:image/')) {
          const uploadPath = process.env.PROFILE_PHOTO_UPLOAD_PATH || './uploads/profile';
          profileImage = await saveBase64Image(member.img, uploadPath);
        } else if (member.img) {
          // If it's already a URL, extract filename or use as is
          profileImage = member.img;
        }

        // Create user profile
        await this.userProfileModel.create({
          userId: newUser.id,
          firstName: member.name,
          gender: member.gender,
          age: typeof member.age === 'string' ? parseInt(member.age) : member.age,
          profile: profileImage, // Use extracted filename
          familyCode: familyCode,
        });

        // Add new user to family member table as approved member
        await this.familyMemberModel.create({
          memberId: newUser.id,
          familyCode: familyCode,
          creatorId: null,
          approveStatus: 'approved'
        });

        userId = newUser.id;
      }

      //Create family tree entry
      const familyTreeEntry = await this.familyTreeModel.create({
        familyCode,
        userId,
        personId: member.id, // Store the position ID (person_X_id)
        generation: member.generation,
        parents: member.parents,
        children: member.children,
        spouses: member.spouses,
        siblings: member.siblings,
      });

      createdMembers.push({
        id: familyTreeEntry.id,
        userId,
        personId: member.id, // Include position ID in response
        name: member.name,
        generation: member.generation,
        parents: member.parents,
        children: member.children,
        spouses: member.spouses,
        siblings: member.siblings,
      });
      console.log(member);
      
    }

    return {
      message: 'Family tree created successfully',
      data: createdMembers,
    };
  }

  async getFamilyTree(familyCode: string) {
    const familyTree = await this.familyTreeModel.findAll({
      where: { familyCode },
      include: [
        {
          model: this.userModel,
          as: 'user',
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile', // Use the correct alias
            },
          ],
        },
      ],
    });

    if (!familyTree.length) {
      throw new NotFoundException('Family tree not found');
    }

    // Transform data to the required format
    const baseUrl = process.env.BASE_URL || '';
    const profilePhotoPath = process.env.PROFILE_PHOTO_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/profile';

    const people = familyTree.map(entry => {
      const userProfile = entry.user?.userProfile;
      
      // Build full image URL if profile image exists
      let img = null;
      if (userProfile?.profile) {
        if (userProfile.profile.startsWith('http')) {
          img = userProfile.profile; // Already a full URL
        } else {
          img = `${baseUrl}/${profilePhotoPath}/${userProfile.profile}`;
        }
      }

      return {
        id: entry.personId, // Use personId as id
        memberId: entry.userId, // Include userId as memberId
        name: userProfile ? `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim() : 'Unknown',
        gender: userProfile?.gender || 'unknown',
        age: userProfile?.age || null,
        generation: entry.generation,
        parents: entry.parents || [],
        children: entry.children || [],
        spouses: entry.spouses || [],
        siblings: entry.siblings || [],
        img: img
      };
    });

    return {
      message: 'Family tree retrieved successfully',
      people: people
    };
  }



}