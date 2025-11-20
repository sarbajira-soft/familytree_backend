import { 
  Injectable, 
  InternalServerErrorException, 
  BadRequestException, 
  NotFoundException, 
  ForbiddenException 
} from '@nestjs/common';
import { 
  InjectModel, 
  InjectConnection 
} from '@nestjs/sequelize';
import { Sequelize, Op } from 'sequelize';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Family } from './model/family.model';
import { FamilyMember } from './model/family-member.model';
import { FamilyTree } from './model/family-tree.model';
import { MailService } from '../utils/mail.service';
import { RelationshipPathService } from './relationship-path.service';
import { UploadService } from '../uploads/upload.service';
import * as jwt from 'jsonwebtoken';
 
import { CreateFamilyDto } from './dto/create-family.dto';
import { CreateFamilyTreeDto, FamilyTreeMemberDto } from './dto/family-tree.dto';
import { NotificationService } from '../notification/notification.service';
import { saveBase64Image } from '../utils/upload.utils';
import { Relationship } from '../relationships/entities/relationship.model';
import { RelationshipEdgeService } from './relationship-edge.service';

@Injectable()
export class FamilyService {
  async getFamilyByUserId(userId: number) {
    const user = await this.userModel.findOne({
      where: { id: userId },
      include: [
        {
          model: UserProfile,
          as: 'userProfile',
          attributes: ['familyCode', 'id']
        }
      ]
    });

    if (!user || !user.userProfile) {
      return null;
    }

    return {
      familyCode: user.userProfile.familyCode,
      userId: user.id
    };
  }

  async getUserName(userId: number): Promise<string> {
    try {
      console.log(`Getting user name for userId: ${userId}`);
      
      // First try to get name from UserProfile directly
      const userProfile = await this.userProfileModel.findOne({
        where: { userId },
        attributes: ['firstName', 'lastName', 'userId']
      });

      console.log('UserProfile found:', userProfile?.toJSON());

      if (userProfile) {
        const firstName = userProfile.firstName || '';
        const lastName = userProfile.lastName || '';
        const fullName = `${firstName} ${lastName}`.trim();
        
        if (fullName) {
          console.log(`Returning name: ${fullName}`);
          return fullName;
        }
      }

      // Fallback to User model if UserProfile doesn't have the name
      const user = await this.userModel.findOne({
        where: { id: userId },
        include: [{
          model: UserProfile,
          as: 'userProfile',
          attributes: ['firstName', 'lastName']
        }]
      });

      console.log('User with profile found:', user?.toJSON());

      if (user && user.userProfile) {
        const firstName = user.userProfile.firstName || '';
        const lastName = user.userProfile.lastName || '';
        const fullName = `${firstName} ${lastName}`.trim();
        
        if (fullName) {
          console.log(`Returning fallback name: ${fullName}`);
          return fullName;
        }
      }

      console.log('No name found, returning default');
      return 'Family Member';
    } catch (error) {
      console.error('Error getting user name:', error);
      return 'Family Member';
    }
  }

  async associateFamilies(associateDto: { sourceCode: string; targetCode: string }) {
    const { sourceCode, targetCode } = associateDto;
    
    if (!sourceCode || !targetCode || sourceCode === targetCode) {
      throw new BadRequestException('Invalid family codes');
    }

    const transaction = await this.sequelize.transaction();
    
    try {
      // Update source family's associated codes (JSON array compatible)
      await this.sequelize.query(`
        UPDATE ft_user_profile 
        SET "associatedFamilyCodes" = 
          CASE 
            WHEN "associatedFamilyCodes" IS NULL THEN '["${targetCode}"]'::jsonb
            WHEN "associatedFamilyCodes" @> '"${targetCode}"'::jsonb THEN "associatedFamilyCodes"
            ELSE "associatedFamilyCodes" || '"${targetCode}"'::jsonb
          END
        WHERE "familyCode" = :sourceCode
      `, {
        replacements: { sourceCode },
        transaction
      });

      // Update target family's associated codes (JSON array compatible)
      await this.sequelize.query(`
        UPDATE ft_user_profile 
        SET "associatedFamilyCodes" = 
          CASE 
            WHEN "associatedFamilyCodes" IS NULL THEN '["${sourceCode}"]'::jsonb
            WHEN "associatedFamilyCodes" @> '"${sourceCode}"'::jsonb THEN "associatedFamilyCodes"
            ELSE "associatedFamilyCodes" || '"${sourceCode}"'::jsonb
          END
        WHERE "familyCode" = :targetCode
      `, {
        replacements: { targetCode },
        transaction
      });

      await transaction.commit();
      return { success: true };
    } catch (error) {
      await transaction.rollback();
      throw new InternalServerErrorException('Failed to associate families', error.message);
    }
  }
  constructor(
    @InjectModel(User)
    private userModel: typeof User,
    @InjectConnection()
    private sequelize: Sequelize,
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
    private readonly relationshipPathService: RelationshipPathService,
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

  private async assertUserNotBlockedInFamily(userId: number, familyCode: string): Promise<void> {
    if (!userId || !familyCode) {
      return;
    }

    const membership = await this.familyMemberModel.findOne({
      where: {
        memberId: userId,
        familyCode,
      },
    });

    if (membership && (membership as any).isBlocked) {
      throw new ForbiddenException('You have been blocked from this family');
    }
  }

  /**
   * Safely parse age value to prevent NaN issues
   */
  private parseAge(age: any): number {
    if (age === null || age === undefined) {
      return 0;
    }
    
    const parsedAge = typeof age === 'number' ? age : parseInt(age, 10);
    return isNaN(parsedAge) ? 0 : parsedAge;
  }

  /**
   * Normalize gender values for consistent display
   */
  private normalizeGender(gender: string): string {
    if (!gender) return '';
    
    const normalizedGender = gender.toLowerCase().trim();
    
    switch (normalizedGender) {
      case 'm':
      case 'male':
      case 'man':
      case 'husband':
        return 'male';
      case 'f':
      case 'female':
      case 'woman':
      case 'wife':
        return 'female';
      case 'unknown':
      case 'other':
      case 'prefer not to say':
        return '';
      default:
        return normalizedGender;
    }
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
  async createFamilyTree(dto: CreateFamilyTreeDto, loggedInUserId: number) {
    const startTime = Date.now();
    console.log(`🚀 Starting createFamilyTree for ${dto.familyCode} with ${dto.members?.length || 0} members`);
    
    const { familyCode, members } = dto;

    // Blocked users cannot modify this family's tree
    await this.assertUserNotBlockedInFamily(loggedInUserId, familyCode);

    // Check if family exists
    const family = await this.familyModel.findOne({ where: { familyCode } });
    if (!family) {
      throw new NotFoundException('Family not found');
    }

    // 🚀 CRITICAL FIX: Delete family_tree entries not in the new tree
    // Get all personIds from the payload
    const personIdsInPayload = members.map(m => m.id);
    console.log('📋 PersonIds in payload:', personIdsInPayload);

    // Delete entries where personId is NOT in the payload
    const deletedEntries = await this.familyTreeModel.destroy({
      where: {
        familyCode,
        personId: { [Op.notIn]: personIdsInPayload }
      }
    });
    console.log(`🗑️ Deleted ${deletedEntries} family_tree entries not in payload`);

    // 🚀 CRITICAL: Clean up orphaned relationships
    // After deleting entries, we need to remove references to deleted personIds
    // from the remaining entries' relationship fields
    if (deletedEntries > 0) {
      // Get all remaining entries
      const remainingEntries = await this.familyTreeModel.findAll({
        where: { familyCode }
      });

      // Update each entry to remove references to deleted personIds
      for (const entry of remainingEntries) {
        const cleanArray = (arr: any) => {
          if (!arr || !Array.isArray(arr)) return [];
          // Handle both string arrays ["2", "3"] and number arrays [2, 3]
          return arr
            .map(id => typeof id === 'string' ? parseInt(id) : id)
            .filter(id => !isNaN(id) && personIdsInPayload.includes(id));
        };

        const cleanedParents = cleanArray(entry.parents);
        const cleanedChildren = cleanArray(entry.children);
        const cleanedSpouses = cleanArray(entry.spouses);
        const cleanedSiblings = cleanArray(entry.siblings);

        // Check if any array changed
        const parentsChanged = JSON.stringify(cleanedParents) !== JSON.stringify(entry.parents);
        const childrenChanged = JSON.stringify(cleanedChildren) !== JSON.stringify(entry.children);
        const spousesChanged = JSON.stringify(cleanedSpouses) !== JSON.stringify(entry.spouses);
        const siblingsChanged = JSON.stringify(cleanedSiblings) !== JSON.stringify(entry.siblings);

        if (parentsChanged || childrenChanged || spousesChanged || siblingsChanged) {
          await entry.update({
            parents: cleanedParents,
            children: cleanedChildren,
            spouses: cleanedSpouses,
            siblings: cleanedSiblings
          });
        }
      }
      console.log(`🧹 Cleaned up orphaned relationships in remaining entries`);
    }

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
      console.log(`✅ Removed ${deletedMembers} family members not in new tree`);
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

    // 🚀 PERFORMANCE OPTIMIZATION: Fetch all data in bulk queries
    const memberIds = members.filter(m => m.memberId).map(m => m.memberId);
    
    // Fetch all existing entries in ONE query
    const existingEntries = await this.familyTreeModel.findAll({
      where: {
        familyCode,
        personId: members.map(m => m.id)
      }
    });

    // Fetch all existing users in ONE query
    const existingUsers = memberIds.length > 0 
      ? await this.userModel.findAll({ where: { id: memberIds } })
      : [];

    // Fetch all existing profiles in ONE query
    const existingProfiles = memberIds.length > 0
      ? await this.userProfileModel.findAll({ where: { userId: memberIds } })
      : [];

    // Fetch all existing family members in ONE query
    const existingFamilyMembers = memberIds.length > 0
      ? await this.familyMemberModel.findAll({ 
          where: { memberId: memberIds, familyCode } 
        })
      : [];

    // Create Maps for O(1) lookup
    const existingEntriesMap = new Map(
      existingEntries.map(entry => [entry.personId, entry])
    );
    const existingUsersMap = new Map(
      existingUsers.map(user => [user.id, user])
    );
    const existingProfilesMap = new Map(
      existingProfiles.map(profile => [profile.userId, profile])
    );
    const existingFamilyMembersMap = new Map(
      existingFamilyMembers.map(fm => [fm.memberId, fm])
    );

    console.log(`📊 Performance stats:
      - Family tree entries: ${existingEntries.length}/${members.length}
      - Existing users: ${existingUsers.length}
      - Existing profiles: ${existingProfiles.length}
      - Existing family members: ${existingFamilyMembers.length}
    `);

    // 🚀 PERFORMANCE: Process all images in parallel BEFORE the loop
    console.log('🖼️ Processing images in parallel...');
    const imageStartTime = Date.now();
    
    const imageProcessingPromises = members.map(async (member, index) => {
      if (member.img && member.img.startsWith('data:image/')) {
        const uploadPath = process.env.PROFILE_PHOTO_UPLOAD_PATH || './uploads/profile';
        try {
          const processedImage = await saveBase64Image(member.img, uploadPath);
          return { index, image: processedImage };
        } catch (err) {
          console.error(`Error processing image for member ${index}:`, err);
          return { index, image: null };
        }
      }
      return { index, image: member.img }; // Already a URL or null
    });

    const processedImages = await Promise.all(imageProcessingPromises);
    const imageMap = new Map(processedImages.map(item => [item.index, item.image]));
    
    console.log(`✅ Processed ${processedImages.length} images in ${Date.now() - imageStartTime}ms`);

    // Prepare bulk operations
    const entriesToUpdate = [];
    const entriesToCreate = [];
    const profilesToUpdate = [];
    const profilesToCreate = [];
    const usersToCreate = [];
    const familyMembersToCreate = [];
    const newUserIndexMap = new Map(); // Track which members need new users

    // 🚀 STEP 1: Identify members needing new users and prepare data
    for (let memberIndex = 0; memberIndex < members.length; memberIndex++) {
      const member = members[memberIndex];
      let userId = member.memberId; // Use memberId as userId

      // Check if user exists
      if (userId) {
        const existingUser = existingUsersMap.get(userId);
        if (!existingUser) {
          userId = null; // User doesn't exist
        }
      }

      // If no userId, prepare for bulk user creation (non-app user: no email/mobile, no app consent)
      if (!userId) {
        usersToCreate.push({
          email: null,
          countryCode: null,
          mobile: null,
          status: 1,
          role: 1,
          isAppUser: false,
        });

        newUserIndexMap.set(memberIndex, usersToCreate.length - 1); // Track position
      }
    }

    // 🚀 STEP 2: Bulk create all new users at once
    let createdUsers = [];
    if (usersToCreate.length > 0) {
      const userStartTime = Date.now();
      console.log(`👥 Creating ${usersToCreate.length} new users in bulk...`);
      createdUsers = await this.userModel.bulkCreate(usersToCreate);
      console.log(`✅ Created ${createdUsers.length} users in ${Date.now() - userStartTime}ms`);
    }

    // 🚀 STEP 3: Process all members with user IDs now available
    for (let memberIndex = 0; memberIndex < members.length; memberIndex++) {
      const member = members[memberIndex];
      let userId = member.memberId; // Use memberId as userId

      // Check if this member got a new user created
      const newUserIndex = newUserIndexMap.get(memberIndex);
      if (newUserIndex !== undefined) {
        userId = createdUsers[newUserIndex].id;
      }

      // 🚀 PERFORMANCE: Use Map lookup instead of database query
      if (userId && member.memberId) {
        const existingUser = existingUsersMap.get(userId);
        if (existingUser) {
          
          // 🚀 PERFORMANCE: Use pre-processed image from Map
          const profileImage = imageMap.get(memberIndex);

          // 🚀 PERFORMANCE: Use Map lookup instead of database query
          const userProfile = existingProfilesMap.get(userId);
          
          if (userProfile) {
            const { firstName, lastName } = this.splitName(member.name);
            const updateData: any = {
              firstName: firstName,
              lastName: lastName,
              gender: member.gender,
              age: this.parseAge(member.age),
            };
            
            // Only update profile image if a new one is provided
            if (profileImage) {
              updateData.profile = profileImage;
            }
            
            // Prepare for bulk update
            profilesToUpdate.push({
              id: userProfile.id,
              ...updateData
            });
          } else {
            // Prepare profile for bulk create
            const { firstName, lastName } = this.splitName(member.name);
            profilesToCreate.push({
              userId: userId,
              firstName: firstName,
              lastName: lastName,
              gender: member.gender,
              age: this.parseAge(member.age),
              profile: profileImage,
              familyCode: familyCode,
            });
          }

          // 🚀 PERFORMANCE: Use Map lookup for family member check
          const existingMember = existingFamilyMembersMap.get(userId);
          
          if (!existingMember) {
            familyMembersToCreate.push({
              memberId: userId,
              familyCode: familyCode,
              creatorId: null,
              approveStatus: 'approved'
            });
          }
        }
      }

      // For new users, prepare profiles and family members for bulk creation
      if (userId && newUserIndexMap.has(memberIndex)) {
        const profileImage = imageMap.get(memberIndex);
        const { firstName, lastName } = this.splitName(member.name);
        
        profilesToCreate.push({
          userId: userId,
          firstName: firstName,
          lastName: lastName,
          gender: member.gender,
          age: typeof member.age === 'string' ? parseInt(member.age) : member.age,
          profile: profileImage,
          familyCode: familyCode,
        });

        familyMembersToCreate.push({
          memberId: userId,
          familyCode: familyCode,
          creatorId: null,
          approveStatus: 'approved'
        });
      }

      // 🚀 PERFORMANCE: Check if entry exists using Map (O(1) lookup)
      const existingEntry = existingEntriesMap.get(member.id);
      
      const entryData = {
        familyCode,
        userId,
        personId: member.id,
        generation: member.generation,
        lifeStatus: member.lifeStatus ?? 'living',
        parents: Array.isArray(member.parents) ? member.parents : Array.from(member.parents || []).map(Number),
        children: Array.isArray(member.children) ? member.children : Array.from(member.children || []).map(Number),
        spouses: Array.isArray(member.spouses) ? member.spouses : Array.from(member.spouses || []).map(Number),
        siblings: Array.isArray(member.siblings) ? member.siblings : Array.from(member.siblings || []).map(Number),
      };

      try {
        if (existingEntry) {
          // Prepare for bulk update
          entriesToUpdate.push({
            id: existingEntry.id,
            ...entryData
          });
          
          createdMembers.push({
            id: existingEntry.id,
            userId,
            personId: member.id,
            name: member.name,
            generation: member.generation,
            parents: entryData.parents,
            children: entryData.children,
            spouses: entryData.spouses,
            siblings: entryData.siblings,
            lifeStatus: entryData.lifeStatus,
          });
        } else {
          // Prepare for bulk create
          entriesToCreate.push(entryData);
          
          createdMembers.push({
            id: null, // Will be assigned after bulk create
            userId,
            personId: member.id,
            name: member.name,
            generation: member.generation,
            parents: entryData.parents,
            children: entryData.children,
            spouses: entryData.spouses,
            siblings: entryData.siblings,
            lifeStatus: entryData.lifeStatus,
          });
        }
      } catch (err) {
        console.error('Error creating FamilyTree entry:', err, {
          familyCode,
          userId,
          personId: member.id,
          generation: member.generation,
          parents: member.parents,
          children: member.children,
        });
        throw err;
      }
      console.log(member);
    }

    // 🚀 BULK OPERATIONS: Execute all updates and creates in batches
    const totalStartTime = Date.now();
    console.log(`📊 Bulk operations summary:
      - Family tree entries: ${entriesToUpdate.length} updates, ${entriesToCreate.length} creates
      - User profiles: ${profilesToUpdate.length} updates, ${profilesToCreate.length} creates
      - Family members: ${familyMembersToCreate.length} creates
    `);
    
    // Bulk update user profiles
    if (profilesToUpdate.length > 0) {
      const startTime = Date.now();
      await Promise.all(
        profilesToUpdate.map(profile =>
          this.userProfileModel.update(
            {
              firstName: profile.firstName,
              lastName: profile.lastName,
              gender: profile.gender,
              age: profile.age,
              ...(profile.profile && { profile: profile.profile })
            },
            {
              where: { id: profile.id }
            }
          )
        )
      );
      console.log(`✅ Bulk updated ${profilesToUpdate.length} profiles in ${Date.now() - startTime}ms`);
    }

    // Bulk create user profiles
    if (profilesToCreate.length > 0) {
      const startTime = Date.now();
      await this.userProfileModel.bulkCreate(profilesToCreate);
      console.log(`✅ Bulk created ${profilesToCreate.length} profiles in ${Date.now() - startTime}ms`);
    }

    // Bulk create family members
    if (familyMembersToCreate.length > 0) {
      const startTime = Date.now();
      await this.familyMemberModel.bulkCreate(familyMembersToCreate);
      console.log(`✅ Bulk created ${familyMembersToCreate.length} family members in ${Date.now() - startTime}ms`);
    }
    
    // Bulk update family tree entries
    if (entriesToUpdate.length > 0) {
      const startTime = Date.now();
      await Promise.all(
        entriesToUpdate.map(entry =>
          this.familyTreeModel.update(
            {
              userId: entry.userId,
              generation: entry.generation,
              lifeStatus: entry.lifeStatus,
              parents: entry.parents,
              children: entry.children,
              spouses: entry.spouses,
              siblings: entry.siblings,
            },
            {
              where: { id: entry.id }
            }
          )
        )
      );
      console.log(`✅ Bulk updated ${entriesToUpdate.length} family tree entries in ${Date.now() - startTime}ms`);
    }

    // Bulk create family tree entries
    if (entriesToCreate.length > 0) {
      const startTime = Date.now();
      await this.familyTreeModel.bulkCreate(entriesToCreate);
      console.log(`✅ Bulk created ${entriesToCreate.length} family tree entries in ${Date.now() - startTime}ms`);
    }

    console.log(`⚡ Total bulk operations completed in ${Date.now() - totalStartTime}ms`);

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

    const totalTime = Date.now() - startTime;
    console.log(`✅ Family tree sync completed successfully! Tree entries: ${createdMembers.length}`);
    console.log(`⚡ Total operation time: ${totalTime}ms (${(totalTime/1000).toFixed(2)}s)`);

    return {
      message: 'Family tree created successfully',
      data: createdMembers,
      performanceStats: {
        totalTimeMs: totalTime,
        membersProcessed: members.length,
        avgTimePerMember: (totalTime / members.length).toFixed(2) + 'ms'
      }
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

  async getFamilyTree(familyCode: string, userId?: number) {
    // If user context is provided, ensure they are not blocked from this family
    if (userId) {
      await this.assertUserNotBlockedInFamily(userId, familyCode);
    }

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
        
        // Get profile image full S3 URL
        let img = null;
        if (userProfile?.profile) {
          if (userProfile.profile.startsWith('http')) {
            img = userProfile.profile; // Already a full URL
          } else {
            img = `https://familytreeupload.s3.eu-north-1.amazonaws.com/profile/${userProfile.profile}`;
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
          img: img,
          familyCode: userProfile?.familyCode || familyCode // Add familyCode field
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


    // FIXED: Remove duplicate entries from database result
    const uniqueFamilyTree = familyTree.reduce((unique, entry) => {
      const existingIndex = unique.findIndex(u => u.personId === entry.personId && u.userId === entry.userId);
      if (existingIndex === -1) {
        unique.push(entry);
      } else {
        // Merge relationship data from duplicates
        const existing = unique[existingIndex];
        existing.parents = [...new Set([...(existing.parents || []), ...(entry.parents || [])])];
        existing.children = [...new Set([...(existing.children || []), ...(entry.children || [])])];
        existing.spouses = [...new Set([...(existing.spouses || []), ...(entry.spouses || [])])];
        existing.siblings = [...new Set([...(existing.siblings || []), ...(entry.siblings || [])])];
      }
      return unique;
    }, []);


    const people = await Promise.all(uniqueFamilyTree.map(async entry => {
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
          familyCode: entry.familyCode || familyCode // Add familyCode field
        };
      }
      const userProfile = entry.user?.userProfile;
      // Get profile image full S3 URL
      let img = null;
      if (userProfile?.profile) {
        if (userProfile.profile.startsWith('http')) {
          img = userProfile.profile; // Already a full URL
        } else {
          img = `https://familytreeupload.s3.eu-north-1.amazonaws.com/profile/${userProfile.profile}`;
        }
      }
      return {
        id: entry.personId, // Use personId as id
        memberId: entry.userId, // Include userId as memberId
        name: userProfile ? [userProfile.firstName, userProfile.lastName].filter(Boolean).join(' ') || 'Unknown' : 'Unknown',
        gender: this.normalizeGender(userProfile?.gender),
        age: userProfile?.age || null,
        generation: entry.generation,
        lifeStatus: entry.lifeStatus || 'living',
        parents: entry.parents || [],
        children: entry.children || [],
        spouses: entry.spouses || [],
        siblings: entry.siblings || [],
        img: img,
        familyCode: userProfile?.familyCode || entry.familyCode || familyCode // Add familyCode field
      };
    }));

    // Get all valid personIds for cleanup
    const validPersonIds = people.map(p => p.id);

    // Fix ID reference issues first (convert memberIds to person ids in relationships)
    const memberIdToPersonIdMap = new Map();
    people.forEach(person => {
      if (person.memberId) {
        memberIdToPersonIdMap.set(person.memberId, person.id);
      }
    });

    // Fix relationship arrays to use person ids instead of member ids
    // AND remove references to non-existent persons
    const processedSpousePairs = new Set<string>();
    
    people.forEach(person => {
      const cleanArray = (arr: any[]) => {
        if (!arr || !Array.isArray(arr)) return [];
        // Convert to numbers and filter out invalid IDs, remove duplicates
        const cleanedIds = arr
          .map(ref => {
            // Try to map memberId to personId first
            const personId = memberIdToPersonIdMap.get(ref) || ref;
            return typeof personId === 'string' ? parseInt(personId) : personId;
          })
          .filter(id => !isNaN(id) && validPersonIds.includes(id));
        
        // FIXED: Remove duplicates using Set
        return [...new Set(cleanedIds)];
      };

      person.parents = cleanArray(person.parents);
      person.children = cleanArray(person.children);
      person.spouses = cleanArray(person.spouses);
      person.siblings = cleanArray(person.siblings);
      // FIXED: Ensure bidirectional parent-child relationships
      person.parents.forEach(parentId => {
        const parent = people.find(p => p.id === parentId);
        if (parent && !parent.children.includes(person.id)) {
          parent.children.push(person.id);
        }
      });
      
      person.children.forEach(childId => {
        const child = people.find(p => p.id === childId);
        if (child && !child.parents.includes(person.id)) {
          child.parents.push(person.id);
        }
      });

      // Ensure bidirectional spouse relationships
      person.spouses.forEach(spouseId => {
        const spouse = people.find(p => p.id === spouseId);
        if (spouse && !spouse.spouses.includes(person.id)) {
          spouse.spouses.push(person.id);
        }
      });

      // FIXED: Ensure shared children between spouses - PREVENT DUPLICATE PROCESSING
      person.spouses.forEach(spouseId => {
        const spouse = people.find(p => p.id === spouseId);
        if (spouse) {
          // Create unique pair key to prevent duplicate processing
          const pairKey = [person.id, spouseId].sort().join('-');
          
          if (!processedSpousePairs.has(pairKey)) {
            processedSpousePairs.add(pairKey);
            
            // Collect all unique children from both parents
            const personChildrenSet = new Set(person.children.map(id => Number(id)));
            const spouseChildrenSet = new Set(spouse.children.map(id => Number(id)));
            const allChildrenSet = new Set([...personChildrenSet, ...spouseChildrenSet]);
            
            // Update both parents with clean arrays
            person.children = Array.from(allChildrenSet);
            spouse.children = Array.from(allChildrenSet);
            
            
            // Ensure each child has both parents
            allChildrenSet.forEach(childId => {
              const child = people.find(p => p.id === childId);
              if (child) {
                const childParentsSet = new Set(child.parents.map(id => Number(id)));
                childParentsSet.add(Number(person.id));
                childParentsSet.add(Number(spouseId));
                child.parents = Array.from(childParentsSet);
              }
            });
          }
        }
      });
    });

    // Second pass to ensure all bidirectional relationships
    people.forEach(person => {
      // Fix spouse relationships in second pass
      person.spouses.forEach(spouseId => {
        const spouse = people.find(p => p.id === spouseId);
        if (spouse && !spouse.spouses.includes(person.id)) {
          spouse.spouses.push(person.id);
        }
      });
      
      // Fix parent-child relationships in second pass
      person.children.forEach(childId => {
        const child = people.find(p => p.id === childId);
        if (child && !child.parents.includes(person.id)) {
          child.parents.push(person.id);
        }
      });
    });

    // Convert to Map format for generation consistency fix
    const allPeople = new Map();
    people.forEach(person => {
      allPeople.set(person.id, {
        ...person,
        parents: new Set(person.parents || []),
        children: new Set(person.children || []),
        spouses: new Set(person.spouses || []),
        siblings: new Set(person.siblings || [])
      });
    });

    // Apply generation consistency fix
    this.fixGenerationConsistency(allPeople);

    // Convert back to array format with corrected generations
    const correctedPeople = Array.from(allPeople.values()).map(person => ({
      ...person,
      // FIXED: Final duplicate cleanup using Set
      parents: [...new Set(Array.from(person.parents))],
      children: [...new Set(Array.from(person.children))],
      spouses: [...new Set(Array.from(person.spouses))],
      siblings: [...new Set(Array.from(person.siblings))]
    }));

    // FINAL DEDUPLICATION: Remove duplicate people by ID
    const finalPeople = correctedPeople.reduce((unique, person) => {
      const existingIndex = unique.findIndex(u => u.id === person.id);
      if (existingIndex === -1) {
        unique.push(person);
      } else {
        // Merge relationships from duplicates
        const existing = unique[existingIndex];
        existing.parents = [...new Set([...existing.parents, ...person.parents])];
        existing.children = [...new Set([...existing.children, ...person.children])];
        existing.spouses = [...new Set([...existing.spouses, ...person.spouses])];
        existing.siblings = [...new Set([...existing.siblings, ...person.siblings])];
      }
      return unique;
    }, []);


    // PERFORMANCE: Remove backend calculation - let frontend handle it
    // Frontend RelationshipCalculator is faster and more efficient
    // Backend only ensures data integrity

    return {
      message: 'Family tree retrieved successfully',
      people: finalPeople
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
 * Get all spouse-connected family codes with relationship prefixes
 */
async getAssociatedFamilyPrefixes(userId: number) {
  return this.relationshipPathService.getAssociatedFamilyPrefixes(userId);
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

    // Get list of families where this user is blocked, so we can exclude them
    const blockedMemberships = await this.familyMemberModel.findAll({
      where: {
        memberId: userId,
        // @ts-ignore - isBlocked is present on the model
        isBlocked: true,
      } as any,
    });
    const blockedFamilyCodes = new Set<string>(blockedMemberships.map((m: any) => m.familyCode));

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
    if (userProfile.familyCode && !blockedFamilyCodes.has(userProfile.familyCode)) {
      allFamilyCodes.add(userProfile.familyCode);
    }

    // Add associated family codes
    if (userProfile.associatedFamilyCodes && Array.isArray(userProfile.associatedFamilyCodes)) {
      userProfile.associatedFamilyCodes.forEach(code => {
        if (code && !code.startsWith('REL_') && !blockedFamilyCodes.has(code)) { // Skip relationship-generated and blocked codes
          allFamilyCodes.add(code);
        }
      });
    }

    // Get relationships and their family codes
    const relationships = await this.relationshipEdgeService.getUserRelationships(userId);
    for (const rel of relationships) {
      if (
        rel.generatedFamilyCode &&
        !rel.generatedFamilyCode.startsWith('REL_') &&
        !blockedFamilyCodes.has(rel.generatedFamilyCode)
      ) {
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
            gender: this.normalizeGender(userProfile?.gender),
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
        
        // Add relationship based on type using personId for consistency
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

    // Fix generation inconsistencies before returning
    this.fixGenerationConsistency(allPeople);

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
   * Fix generation inconsistencies in family tree data
   */
  private fixGenerationConsistency(allPeople: Map<any, any>): void {
    
    // Convert to array for easier processing
    const people = Array.from(allPeople.values());
    
    // Find root people (those without parents)
    const rootPeople = people.filter(person => 
      !person.parents || person.parents.size === 0
    );
    
    // If no clear root, use the oldest person or generation 0 people
    if (rootPeople.length === 0) {
      const gen0People = people.filter(person => person.generation === 0);
      if (gen0People.length > 0) {
        rootPeople.push(...gen0People);
      } else {
        // Find oldest person as root
        const oldestPerson = people.reduce((oldest, current) => {
          const currentAge = this.parseAge(current.age);
          const oldestAge = this.parseAge(oldest?.age);
          return currentAge > oldestAge ? current : oldest;
        }, people[0]);
        if (oldestPerson) {
          rootPeople.push(oldestPerson);
        }
      }
    }
    
    // Reset all generations and recalculate from roots
    const visited = new Set();
    const queue = [];
    
    // Start with root people at generation 0
    rootPeople.forEach(rootPerson => {
      rootPerson.generation = 0;
      queue.push({ person: rootPerson, generation: 0 });
      visited.add(rootPerson.id);
    });
    
    // BFS to assign generations
    while (queue.length > 0) {
      const { person, generation } = queue.shift();
      
      // Process spouses (same generation)
      if (person.spouses) {
        person.spouses.forEach(spouseId => {
          const spouse = people.find(p => p.id === spouseId);
          if (spouse && !visited.has(spouse.id)) {
            spouse.generation = generation;
            queue.push({ person: spouse, generation });
            visited.add(spouse.id);
            console.log(`🔧 Set spouse ${spouse.name} to generation ${generation}`);
          }
        });
      }
      
      // Process children (next generation)
      if (person.children) {
        person.children.forEach(childId => {
          const child = people.find(p => p.id === childId);
          if (child && !visited.has(child.id)) {
            child.generation = generation + 1;
            queue.push({ person: child, generation: generation + 1 });
            visited.add(child.id);
            console.log(`🔧 Set child ${child.name} to generation ${generation + 1}`);
          }
        });
      }
      
      // Process siblings (same generation)
      if (person.siblings) {
        person.siblings.forEach(siblingId => {
          const sibling = people.find(p => p.id === siblingId);
          if (sibling && !visited.has(sibling.id)) {
            sibling.generation = generation;
            queue.push({ person: sibling, generation });
            visited.add(sibling.id);
          }
        });
      }
    }
    
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
