import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User} from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Family } from './model/family.model';
import { FamilyMember } from './model/family-member.model';
import { FamilyTree } from './model/family-tree.model';
import { MailService } from '../utils/mail.service';
import { UploadService } from '../uploads/upload.service';
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
import { RelationshipEdgeService } from './relationship-edge.service';

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
    private readonly relationshipEdgeService: RelationshipEdgeService,
    private readonly uploadService: UploadService,
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
      // If there's a file URL in the DTO but the family already exists, clean it up
      if (dto.familyPhoto) {
        try {
          await this.uploadService.deleteFile(dto.familyPhoto, 'family');
        } catch (error) {
          console.error('Failed to clean up uploaded file:', error);
        }
      }
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

    // Get the full URL for the family photo if it exists
    const familyPhotoUrl = family.familyPhoto 
      ? this.uploadService.getFileUrl(family.familyPhoto, 'family')
      : null;

    // Return family details with full photo URL
    return {
      ...family.get(),
      familyPhotoUrl,
    };
  }

  async update(id: number, dto: any, newFileName?: string, loggedId?: number) {
    const family = await this.familyModel.findByPk(id);
    if (!family) {
      // If there's a file URL in the DTO but family not found, clean it up
      if (dto.familyPhoto) {
        try {
          await this.uploadService.deleteFile(dto.familyPhoto, 'family');
        } catch (error) {
          console.error('Failed to clean up uploaded file:', error);
        }
      }
      throw new NotFoundException('Family not found');
    }

    // Delete old file from S3 if a new file is uploaded
    if (newFileName && family.familyPhoto && family.familyPhoto !== newFileName) {
      try {
        await this.uploadService.deleteFile(family.familyPhoto, 'family');
      } catch (error) {
        console.error('Failed to delete old family photo from S3:', error);
        // Continue with the update even if deletion fails
      }
    }
    dto.createdBy = loggedId;
    await family.update(dto);
    return { message: 'Family updated successfully', data: family };

  }

  async delete(familyId: number, userId: number) {
    const family = await this.familyModel.findByPk(familyId);
    if (!family) throw new NotFoundException('Family not found');

    // Delete family photo from S3 if it exists
    if (family.familyPhoto) {
      try {
        await this.uploadService.deleteFile(family.familyPhoto, 'family');
      } catch (error) {
        console.error('Failed to delete family photo from S3:', error);
        // Continue with deletion even if file deletion fails
      }
    }

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

    // NEW: Create relationship edges for all relationships in the family tree
    await this.createRelationshipEdgesFromFamilyTree(members, familyCode);

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

  /**
   * Clean up invalid userId data in the database
   * This method should be called once to fix data integrity issues
   */
  async cleanupInvalidUserIdData() {
    try {
      // Find userId values that don't exist in the users table
      const invalidUserIds = await this.familyTreeModel.findAll({
        include: [
          {
            model: this.userModel,
            as: 'user',
            required: false,
          }
        ],
        where: {
          userId: { [Op.ne]: null } // Only check non-null userIds
        }
      });

      // Filter out records where the user doesn't exist
      const recordsToFix = invalidUserIds.filter(record => !record.user);
      
      if (recordsToFix.length > 0) {
        const userIdsToFix = recordsToFix.map(record => record.userId);
        
        // Update invalid userId references to NULL
        const result = await this.familyTreeModel.update(
          { userId: null },
          { 
            where: { 
              userId: { [Op.in]: userIdsToFix }
            } 
          }
        );
        
        console.log(`Cleaned up ${result[0]} records with invalid userId references`);
        return result[0];
      }
      
      console.log('No invalid userId data found to clean up');
      return 0;
    } catch (error) {
      console.error('Error cleaning up userId data:', error);
      throw error;
    }
  }

  async getFamilyTree(familyCode: string) {
    // First, let's clean up any invalid data
    await this.cleanupInvalidUserIdData();
    
    const familyTree = await this.familyTreeModel.findAll({
      where: { familyCode },
      include: [
        {
          model: this.userModel,
          as: 'user',
          required: false, // Make it a LEFT JOIN instead of INNER JOIN
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
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

    const people = await Promise.all(familyTree.map(async entry => {
      // If userId is undefined/null, skip this person or handle gracefully
      if (!entry.userId) {
        return {
          id: entry.personId,
          memberId: null,
          name: 'Unknown',
          gender: 'unknown',
          age: null,
          generation: entry.generation,
          parents: entry.parents || [],
          children: entry.children || [],
          spouses: entry.spouses || [],
          siblings: entry.siblings || [],
          img: null,
          associatedFamilyCodes: [],
        };
      }
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
      // Get associatedFamilyCodes if available
      let associatedFamilyCodes = [];
      if (userProfile && userProfile.associatedFamilyCodes) {
        associatedFamilyCodes = userProfile.associatedFamilyCodes;
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
        img: img,
        associatedFamilyCodes: associatedFamilyCodes,
      };
    }));

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

  /**
   * Get all family codes a user is associated with
   */
  async getUserFamilyCodes(userId: number) {
    return this.relationshipEdgeService.getUserFamilyCodes(userId);
  }

  /**
   * Get all relationships for a user
   */
  async getUserRelationships(userId: number) {
    const relationships = await this.relationshipEdgeService.getUserRelationships(userId);
    
    // Transform relationships to include user details
    const transformedRelationships = await Promise.all(
      relationships.map(async (rel) => {
        const user1Profile = await this.userProfileModel.findOne({
          where: { userId: rel.user1Id },
        });
        const user2Profile = await this.userProfileModel.findOne({
          where: { userId: rel.user2Id },
        });

        return {
          id: rel.id,
          user1: {
            id: rel.user1Id,
            name: user1Profile ? `${user1Profile.firstName} ${user1Profile.lastName}`.trim() : 'Unknown',
          },
          user2: {
            id: rel.user2Id,
            name: user2Profile ? `${user2Profile.firstName} ${user2Profile.lastName}`.trim() : 'Unknown',
          },
          relationshipType: rel.relationshipType,
          generatedFamilyCode: rel.generatedFamilyCode,
          createdAt: rel.createdAt,
        };
      })
    );

    return {
      message: 'User relationships retrieved successfully',
      relationships: transformedRelationships,
    };
  }

  /**
   * Get associated family tree by userId - traverses all family codes the user is connected to
   */
  async getAssociatedFamilyTreeByUserId(userId: number) {
    await this.cleanupInvalidUserIdData();

    // Get user's main and associated family codes
    const userProfile = await this.userProfileModel.findOne({
      where: { userId },
      include: [{ model: this.userModel, as: 'user' }]
    });

    if (!userProfile) {
      throw new NotFoundException('User profile not found');
    }

    const allFamilyCodes = new Set<string>();
    
    // Add main family code
    if (userProfile.familyCode) {
      allFamilyCodes.add(userProfile.familyCode);
    }

    // Add associated family codes
    if (userProfile.associatedFamilyCodes && Array.isArray(userProfile.associatedFamilyCodes)) {
      userProfile.associatedFamilyCodes.forEach(code => {
        if (code && !code.startsWith('REL_')) { // Skip relationship-generated codes
          allFamilyCodes.add(code);
        }
      });
    }

    // Get relationships and their family codes
    const relationships = await this.relationshipEdgeService.getUserRelationships(userId);
    for (const rel of relationships) {
      if (rel.generatedFamilyCode && !rel.generatedFamilyCode.startsWith('REL_')) {
        allFamilyCodes.add(rel.generatedFamilyCode);
      }
    }

    if (allFamilyCodes.size === 0) {
      throw new NotFoundException('No associated family trees found for this user');
    }

    // Fetch all people from all associated family codes
    const allPeople = new Map();
    const familyTreeEntries = await this.familyTreeModel.findAll({
      where: { 
        familyCode: { [Op.in]: Array.from(allFamilyCodes) }
      },
      include: [
        {
          model: this.userModel,
          as: 'user',
          required: false,
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
            },
          ],
        },
      ],
    });

    const baseUrl = process.env.BASE_URL || '';
    const profilePhotoPath = process.env.PROFILE_PHOTO_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/profile';

    // Process each entry and build unified tree
    for (const entry of familyTreeEntries) {
      const personKey = entry.userId || `unknown_${entry.personId}`;
      
      if (!allPeople.has(personKey)) {
        let personData;
        
        if (!entry.userId) {
          personData = {
            id: entry.personId,
            memberId: null,
            name: 'Unknown',
            gender: 'unknown',
            age: null,
            generation: entry.generation,
            parents: new Set(entry.parents || []),
            children: new Set(entry.children || []),
            spouses: new Set(entry.spouses || []),
            siblings: new Set(entry.siblings || []),
            img: null,
            associatedFamilyCodes: [],
            familyCode: entry.familyCode,
            isManual: false
          };
        } else {
          const userProfile = entry.user?.userProfile;
          let img = null;
          if (userProfile?.profile) {
            if (userProfile.profile.startsWith('http')) {
              img = userProfile.profile;
            } else {
              img = `${baseUrl}/${profilePhotoPath}/${userProfile.profile}`;
            }
          }
          
          personData = {
            id: entry.personId,
            memberId: entry.userId,
            name: userProfile ? `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim() : 'Unknown',
            gender: userProfile?.gender || 'unknown',
            age: userProfile?.age || null,
            generation: entry.generation,
            parents: new Set(entry.parents || []),
            children: new Set(entry.children || []),
            spouses: new Set(entry.spouses || []),
            siblings: new Set(entry.siblings || []),
            img: img,
            associatedFamilyCodes: userProfile?.associatedFamilyCodes || [],
            familyCode: entry.familyCode,
            isManual: false
          };
        }
        
        allPeople.set(personKey, personData);
      } else {
        // Merge relationships from multiple trees
        const existing = allPeople.get(personKey);
        existing.parents = new Set([...existing.parents, ...(entry.parents || [])]);
        existing.children = new Set([...existing.children, ...(entry.children || [])]);
        existing.spouses = new Set([...existing.spouses, ...(entry.spouses || [])]);
        existing.siblings = new Set([...existing.siblings, ...(entry.siblings || [])]);
      }
    }

    // Add relationship edges as connections
    for (const rel of relationships) {
      const person1Key = rel.user1Id;
      const person2Key = rel.user2Id;
      
      if (allPeople.has(person1Key) && allPeople.has(person2Key)) {
        const person1 = allPeople.get(person1Key);
        const person2 = allPeople.get(person2Key);
        
        // Add relationship based on type
        if (rel.relationshipType === 'spouse') {
          person1.spouses.add(person2.id);
          person2.spouses.add(person1.id);
        } else if (rel.relationshipType === 'parent-child') {
          person1.children.add(person2.id);
          person2.parents.add(person1.id);
        } else if (rel.relationshipType === 'sibling') {
          person1.siblings.add(person2.id);
          person2.siblings.add(person1.id);
        }
      }
    }

    // Convert sets back to arrays for JSON serialization
    const people = Array.from(allPeople.values()).map(person => ({
      ...person,
      parents: Array.from(person.parents),
      children: Array.from(person.children),
      spouses: Array.from(person.spouses),
      siblings: Array.from(person.siblings)
    }));

    return {
      message: 'Associated family tree retrieved successfully',
      rootUserId: userId,
      familyCodes: Array.from(allFamilyCodes),
      people,
      totalConnections: relationships.length
    };
  }

  /**
   * Get associated family tree by family code (legacy method - now calls userId-based method)
   */
  async getAssociatedFamilyTree(familyCode: string) {
    // Find any user in this family code and use userId-based method
    const familyEntry = await this.familyTreeModel.findOne({
      where: { familyCode, userId: { [Op.not]: null } }
    });

    if (!familyEntry || !familyEntry.userId) {
      throw new NotFoundException('No valid user found in this family tree');
    }

    return this.getAssociatedFamilyTreeByUserId(familyEntry.userId);
  }

  /**
   * Sync person data across all family trees they appear in
   */
  async syncPersonAcrossAllTrees(userId: number, updates: any) {
    const transaction = await this.familyTreeModel.sequelize.transaction();
    
    try {
      // Update user profile
      await this.userProfileModel.update(updates, {
        where: { userId },
        transaction
      });

      // Find all family tree entries for this user
      const allEntries = await this.familyTreeModel.findAll({
        where: { userId },
        transaction
      });

      // Update each entry if needed (e.g., generation changes)
      for (const entry of allEntries) {
        if (updates.generation !== undefined) {
          await entry.update({ generation: updates.generation }, { transaction });
        }
      }

      await transaction.commit();
      
      return {
        message: 'Person data synced across all trees',
        updatedTrees: allEntries.length
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Create manual associated tree for a user
   */
  async createManualAssociatedTree(userId: number, familyCode: string, basicInfo: any) {
    const transaction = await this.familyTreeModel.sequelize.transaction();
    
    try {
      // Create family entry
      await this.familyModel.create({
        familyCode,
        familyName: basicInfo.familyName || `${basicInfo.name}'s Family`,
        createdBy: userId
      }, { transaction });

      // Add person to family tree
      await this.familyTreeModel.create({
        familyCode,
        userId,
        personId: 1, // Root person in this tree
        generation: 0
      }, { transaction });

      // Update user's associated family codes
      await this.relationshipEdgeService.updateAssociatedFamilyCodes(
        userId, 
        familyCode, 
        transaction
      );

      await transaction.commit();
      
      return {
        message: 'Manual associated tree created successfully',
        familyCode,
        isManual: true
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Replace manual tree with auto-generated complete tree
   */
  async replaceManualTreeWithComplete(oldFamilyCode: string, newCompleteTreeData: any) {
    const transaction = await this.familyTreeModel.sequelize.transaction();
    
    try {
      // Get all users who had the old family code in their associated codes
      const affectedUsers = await this.userProfileModel.findAll({
        where: {
          associatedFamilyCodes: { [Op.contains]: [oldFamilyCode] }
        },
        transaction
      });

      // Create new complete tree
      const newFamilyCode = newCompleteTreeData.familyCode;
      
      // Update all affected users' associated codes
      for (const user of affectedUsers) {
        const updatedCodes = user.associatedFamilyCodes.map(code => 
          code === oldFamilyCode ? newFamilyCode : code
        );
        
        await user.update({
          associatedFamilyCodes: updatedCodes
        }, { transaction });
      }

      // Delete old manual tree
      await this.familyTreeModel.destroy({
        where: { familyCode: oldFamilyCode },
        transaction
      });
      
      await this.familyModel.destroy({
        where: { familyCode: oldFamilyCode },
        transaction
      });

      await transaction.commit();
      
      return {
        message: 'Manual tree replaced with complete tree successfully',
        oldFamilyCode,
        newFamilyCode,
        affectedUsers: affectedUsers.length
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async addSpouseRelationship(yourUserId: number, spouseUserId: number) {
    // Fetch spouse profile
    const spouseProfile = await this.userProfileModel.findOne({ where: { userId: spouseUserId } });
    const spouseHasFamilyCode = spouseProfile && spouseProfile.familyCode ? true : false;

    // Create relationship edge
    const { generatedFamilyCode } = await this.relationshipEdgeService.createRelationshipEdge(
      yourUserId,
      spouseUserId,
      'spouse'
    );

    // Add REL_... code to both users
    await this.relationshipEdgeService.updateAssociatedFamilyCodes(yourUserId, generatedFamilyCode);
    await this.relationshipEdgeService.updateAssociatedFamilyCodes(spouseUserId, generatedFamilyCode);

    // If spouse has a family code, add it to your associated codes
    if (spouseHasFamilyCode) {
      await this.relationshipEdgeService.updateAssociatedFamilyCodes(yourUserId, spouseProfile.familyCode);
    }

    // Optionally, add your family code to spouse's associated codes
    const yourProfile = await this.userProfileModel.findOne({ where: { userId: yourUserId } });
    if (yourProfile && yourProfile.familyCode) {
      await this.relationshipEdgeService.updateAssociatedFamilyCodes(spouseUserId, yourProfile.familyCode);
    }

    // Sync spouse data across all their trees
    await this.syncPersonAcrossAllTrees(spouseUserId, { maritalStatus: 'married' });
    await this.syncPersonAcrossAllTrees(yourUserId, { maritalStatus: 'married' });

    return {
      message: 'Spouse relationship created and associated codes updated',
      generatedFamilyCode,
      yourUserId,
      spouseUserId,
    };
  }

  private async createRelationshipEdgesFromFamilyTree(members: FamilyTreeMemberDto[], familyCode: string) {
    // Create a map of personId to userId for easy lookup
    const personIdToUserIdMap = new Map<number, number>();
    members.forEach(member => {
      if (member.memberId) {
        personIdToUserIdMap.set(member.id, member.memberId);
      }
    });

    for (const member of members) {
      const userId = member.memberId;
      if (!userId) continue; // Skip if no userId

      // Create spouse relationships
      if (member.spouses && member.spouses.length > 0) {
        for (const spousePersonId of member.spouses) {
          const spouseUserId = personIdToUserIdMap.get(spousePersonId);
          if (spouseUserId && spouseUserId !== userId) {
            try {
              await this.relationshipEdgeService.createRelationshipEdge(
                userId,
                spouseUserId,
                'spouse'
              );
            } catch (error) {
              console.error(`Error creating spouse relationship: ${userId} -> ${spouseUserId}`, error);
            }
          }
        }
      }

      // Create parent-child relationships
      if (member.children && member.children.length > 0) {
        for (const childPersonId of member.children) {
          const childUserId = personIdToUserIdMap.get(childPersonId);
          if (childUserId && childUserId !== userId) {
            try {
              await this.relationshipEdgeService.createRelationshipEdge(
                userId,
                childUserId,
                'parent-child'
              );
            } catch (error) {
              console.error(`Error creating parent-child relationship: ${userId} -> ${childUserId}`, error);
            }
          }
        }
      }

      // Create sibling relationships
      if (member.siblings && member.siblings.length > 0) {
        for (const siblingPersonId of member.siblings) {
          const siblingUserId = personIdToUserIdMap.get(siblingPersonId);
          if (siblingUserId && siblingUserId !== userId) {
            try {
              await this.relationshipEdgeService.createRelationshipEdge(
                userId,
                siblingUserId,
                'sibling'
              );
            } catch (error) {
              console.error(`Error creating sibling relationship: ${userId} -> ${siblingUserId}`, error);
            }
          }
        }
      }
    }
  }

}
