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
import { Relationship } from '../relationships/entities/relationship.model';
import { Sequelize } from 'sequelize-typescript';

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

  // Helper function to generate JWT access token
  private generateAccessToken(user: User): string {
    return jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' },
    );
  }

  // Helper function to split full name into first and last names
  private splitName(fullName: string): { firstName: string; lastName: string | null } {
    if (!fullName || typeof fullName !== 'string') {
      return { firstName: '', lastName: null };
    }
    
    const nameParts = fullName.trim().split(/\s+/);
    
    if (nameParts.length === 0) {
      return { firstName: '', lastName: null };
    } else if (nameParts.length === 1) {
      return { firstName: nameParts[0], lastName: null };
    } else {
      // First part is firstName, rest combined as lastName
      const firstName = nameParts[0];
      const lastNamePart = nameParts.slice(1).join(' ');
      return { firstName, lastName: lastNamePart };
    }
  }

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

    // Update user's UserProfile with familyCode
    await this.userProfileModel.update(
      { familyCode: created.familyCode },
      { where: { userId: createdBy } }
    );

    // Get the updated user with new role to generate fresh token
    const updatedUser = await this.userModel.findByPk(createdBy);
    if (!updatedUser) {
      throw new NotFoundException('User not found after role update');
    }

    // Generate new access token with updated role
    const newAccessToken = this.generateAccessToken(updatedUser);

    // Update user's access token in database
    await updatedUser.update({ accessToken: newAccessToken });

    return {
      message: 'Family created successfully',
      data: created,
      accessToken: newAccessToken, // Return new token with admin role
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role, // Now role = 2 (admin)
      }
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

  // ✅ FIXED METHOD: createFamilyTree with sync logic AND existing user profile updates
  async createFamilyTree(dto: CreateFamilyTreeDto) {
    const { familyCode, members } = dto;

    // Check if family exists
    const family = await this.familyModel.findOne({ where: { familyCode } });
    if (!family) {
      throw new NotFoundException('Family not found');
    }

    // Remove existing family tree data for this family
    await this.familyTreeModel.destroy({ where: { familyCode } });

    // ✅ SYNC FIX: Sync family_member table with tree data
    // Get all member IDs that should remain (existing members in the tree)
    const memberIdsInTree = members
      .filter(member => member.memberId && member.memberId !== null)
      .map(member => Number(member.memberId));

    console.log('✅ Members in tree:', memberIdsInTree);

    // Remove family members who are not in the new tree
    if (memberIdsInTree.length > 0) {
      const deletedMembers = await this.familyMemberModel.destroy({
        where: {
          familyCode,
          memberId: { [Op.notIn]: memberIdsInTree }
        }
      });
      console.log(`✅ Removed ${deletedMembers} members from family_member table who are not in tree`);
    } else {
      // If no existing members in tree, remove all members except creator
      const familyCreator = await this.familyModel.findOne({ 
        where: { familyCode },
        attributes: ['createdBy']
      });
      
      if (familyCreator) {
        const deletedMembers = await this.familyMemberModel.destroy({
          where: {
            familyCode,
            memberId: { [Op.ne]: familyCreator.createdBy }
          }
        });
        console.log(`✅ Removed ${deletedMembers} members from family_member table (keeping only creator)`);
      }
    }

    const createdMembers = [];

    for (const member of members) {
      let userId = member.memberId; // Use memberId as userId

      // ✅ NEW FIX: Check if user exists and update their profile if they do
      if (userId) {
        // Try to find existing user
        const existingUser = await this.userModel.findByPk(userId);
        if (existingUser) {
          console.log(`✅ Updating existing user profile for userId: ${userId}`);
          
          // Handle profile image if provided
          let profileImage = null;
          if (member.img && member.img.startsWith('data:image/')) {
            const uploadPath = process.env.PROFILE_PHOTO_UPLOAD_PATH || './uploads/profile';
            profileImage = await saveBase64Image(member.img, uploadPath);
          } else if (member.img && typeof member.img === 'string') {
            // If it's already a URL or filename, use as is
            profileImage = member.img;
          }

          // Update existing user profile
          const userProfile = await this.userProfileModel.findOne({ 
            where: { userId: userId } 
          });
          
          if (userProfile) {
            const { firstName, lastName } = this.splitName(member.name);
            const updateData: any = {
              firstName: firstName,
              lastName: lastName,
              gender: member.gender,
              age: typeof member.age === 'string' ? parseInt(member.age) : member.age,
            };
            
            // Only update profile image if a new one is provided
            if (profileImage) {
              updateData.profile = profileImage;
            }
            
            await userProfile.update(updateData);
            console.log(`✅ Updated profile for user ${userId}: name=${member.name}, gender=${member.gender}, age=${member.age}`);
          } else {
            // Create profile if it doesn't exist
            const { firstName, lastName } = this.splitName(member.name);
            await this.userProfileModel.create({
              userId: userId,
              firstName: firstName,
              lastName: lastName,
              gender: member.gender,
              age: typeof member.age === 'string' ? parseInt(member.age) : member.age,
              profile: profileImage,
              familyCode: familyCode,
            });
            console.log(`✅ Created new profile for existing user ${userId}`);
          }

          // Ensure user is in family_member table
          const existingMember = await this.familyMemberModel.findOne({
            where: { memberId: userId, familyCode }
          });
          
          if (!existingMember) {
            await this.familyMemberModel.create({
              memberId: userId,
              familyCode: familyCode,
              creatorId: null,
              approveStatus: 'approved'
            });
            console.log(`✅ Added existing user ${userId} to family_member table`);
          }
        } else {
          // User doesn't exist, set userId to null to create new user
          userId = null;
        }
      }

      // If user doesn't exist (no memberId or user not found), create new user and profile
      if (!userId) {
        // Generate a temporary email
        const tempEmail = `familytree_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.com`;
        // Generate a temporary mobile number
        const tempMobile = `99999${Math.floor(100000 + Math.random() * 899999)}`;
        // Create new user
        let newUser;
        try {
          newUser = await this.userModel.create({
            email: tempEmail,
            mobile: tempMobile,
            status: 1, // Active
            role: 1, // Member
          });
        } catch (err) {
          console.error('Error creating User:', err, { email: tempEmail, mobile: tempMobile });
          throw err;
        }

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
        try {
          const { firstName, lastName } = this.splitName(member.name);
          await this.userProfileModel.create({
            userId: newUser.id,
            firstName: firstName,
            lastName: lastName,
            gender: member.gender,
            age: typeof member.age === 'string' ? parseInt(member.age) : member.age,
            profile: profileImage, // Use extracted filename
            familyCode: familyCode,
          });
        } catch (err) {
          console.error('Error creating UserProfile:', err, { userId: newUser.id, firstName: member.name, gender: member.gender, age: member.age, profile: profileImage, familyCode });
          throw err;
        }

        // ✅ SYNC FIX: Add new user to family member table as approved member
        try {
          await this.familyMemberModel.create({
            memberId: newUser.id,
            familyCode: familyCode,
            creatorId: null,
            approveStatus: 'approved'
          });
          console.log(`✅ Added new user ${newUser.id} to family_member table`);
        } catch (err) {
          console.error('Error creating FamilyMember:', err, { memberId: newUser.id, familyCode });
          throw err;
        }

        userId = newUser.id;
      }

      //Create family tree entry
      try {
        const familyTreeEntry = await this.familyTreeModel.create({
          familyCode,
          userId,
          personId: member.id, // Store the position ID (person_X_id)
          generation: member.generation,
          parents: Array.isArray(member.parents) ? member.parents : Array.from(member.parents || []).map(Number),
          children: Array.isArray(member.children) ? member.children : Array.from(member.children || []).map(Number),
          spouses: Array.isArray(member.spouses) ? member.spouses : Array.from(member.spouses || []).map(Number),
          siblings: Array.isArray(member.siblings) ? member.siblings : Array.from(member.siblings || []).map(Number),
        });
        createdMembers.push({
          id: familyTreeEntry.id,
          userId,
          personId: member.id, // Include position ID in response
          name: member.name,
          generation: member.generation,
          parents: familyTreeEntry.parents,
          children: familyTreeEntry.children,
          spouses: familyTreeEntry.spouses,
          siblings: familyTreeEntry.siblings,
        });
      } catch (err) {
        console.error('Error creating FamilyTree entry:', err, {
          familyCode,
          userId,
          personId: member.id,
          generation: member.generation,
          parents: member.parents,
          children: member.children,
          spouses: member.spouses,
          siblings: member.siblings,
        });
        throw err;
      }
      console.log(member);
    }

    // After creating all family tree entries, batch check and insert missing relationship codes
    const allCodes = new Set<string>();
    for (const member of members) {
      if (member.relationshipCode) {
        allCodes.add(member.relationshipCode);
      }
    }
    const codesArray = Array.from(allCodes);
    if (codesArray.length > 0) {
      const existing = await Relationship.findAll({ where: { key: codesArray } });
      const existingKeys = new Set(existing.map(r => r.key));
      const missingCodes = codesArray.filter(code => !existingKeys.has(code));
      if (missingCodes.length > 0) {
        await Relationship.bulkCreate(
          missingCodes.map(code => ({
            key: code,
            description: code,
            is_auto_generated: true,
          }))
        );
      }
    }

    console.log(`✅ Family tree sync completed successfully! Tree entries: ${createdMembers.length}`);

    return {
      message: 'Family tree created successfully',
      data: createdMembers,
    };
  }

  async getFamilyTree(familyCode: string) {
    // First check if family exists
    const family = await this.familyModel.findOne({ where: { familyCode } });
    if (!family) {
      throw new NotFoundException('Family not found');
    }

    // Check if family tree exists
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

    // If family tree doesn't exist, get family members instead
    if (!familyTree.length) {
      const familyMembers = await this.familyMemberModel.findAll({
        where: { 
          familyCode,
          approveStatus: 'approved'
        },
        include: [
          {
            model: this.userModel,
            as: 'user',
            include: [
              {
                model: this.userProfileModel,
                as: 'userProfile',
              },
            ],
          },
        ],
      });

      if (!familyMembers.length) {
        throw new NotFoundException('No approved family members found');
      }

      // Transform family members to tree format
      const baseUrl = process.env.BASE_URL || '';
      const profilePhotoPath = process.env.PROFILE_PHOTO_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/profile';

      const people = familyMembers.map((member: any, index) => {
        const userProfile = member.user?.userProfile;
        
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
          id: index + 1, // Use index as id since no personId
          memberId: member.memberId,
          name: userProfile ? [userProfile.firstName, userProfile.lastName].filter(Boolean).join(' ') || 'Unknown' : 'Unknown',
          gender: userProfile?.gender || 'unknown',
          age: userProfile?.age || null,
          generation: 1, // Default generation
          parents: [],
          children: [],
          spouses: [],
          siblings: [],
          img: img
        };
      });

      return {
        message: 'Family members retrieved successfully (family tree not created yet)',
        people: people
      };
    }

    // Transform family tree data to the required format
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
        name: userProfile ? [userProfile.firstName, userProfile.lastName].filter(Boolean).join(' ') || 'Unknown' : 'Unknown',
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

  async ensureRelationshipCodeExists(universalCode: string) {
    // Check if the code exists
    const exists = await Relationship.findOne({ where: { key: universalCode } });
    if (!exists) {
      await Relationship.create({
        key: universalCode,
        description: universalCode,
        is_auto_generated: true,
      });
    }
  }
}
