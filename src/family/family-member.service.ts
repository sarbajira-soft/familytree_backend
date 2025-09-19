import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op } from 'sequelize';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Family } from './model/family.model';
import { FamilyMember } from './model/family-member.model';
import { MailService } from '../utils/mail.service';
import { NotificationService } from '../notification/notification.service';
import { UploadService } from '../uploads/upload.service';
import { extractUserProfileFields } from '../utils/profile-mapper.util';
import * as bcrypt from 'bcrypt';
import * as path from 'path';
import * as fs from 'fs';
 
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { CreateUserAndJoinFamilyDto } from './dto/create-user-and-join-family.dto';

@Injectable()
export class FamilyMemberService {
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

    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,

    private readonly uploadService: UploadService,

    private readonly sequelize: Sequelize,
  ) {}

 async createUserAndJoinFamily(dto: CreateUserAndJoinFamilyDto, creatorId: number) {
  const transaction = await this.sequelize.transaction();

  try {
    const existingVerifiedUser = await this.userModel.findOne({
      where: {
        status: 1,
        [Op.or]: [
          { email: dto.email },
          {
            countryCode: dto.countryCode,
            mobile: dto.mobile,
          },
        ],
      },
      transaction,
    });

    if (existingVerifiedUser) {
      throw new BadRequestException({
        message: 'User with this email or mobile already exists',
      });
    }

    // Step 1: Create user
    const user = await this.userModel.create(
      {
        email: dto.email,
        countryCode: dto.countryCode,
        mobile: dto.mobile,
        password: await bcrypt.hash(dto.password, 10),
        status: dto.status ?? 1,
        role: dto.role ?? 1,
        createdBy: creatorId,
      },
      { transaction }
    );

    // Step 2: Create user profile
    await this.userProfileModel.create(
      {
        userId: user.id,
        firstName: dto.firstName || '',
        lastName: dto.lastName || '',
        profile: dto.profile || null,
        gender: dto.gender || null,
        dob: dto.dob || null,
        age: dto.age || null,
        maritalStatus: dto.maritalStatus || null,
        marriageDate: dto.marriageDate || null,
        spouseName: dto.spouseName || null,
        childrenNames: dto.childrenNames || null,
        fatherName: dto.fatherName || null,
        motherName: dto.motherName || null,
        religionId: dto.religionId || null,
        languageId: dto.languageId || null,
        caste: dto.caste || null,
        gothramId: dto.gothramId || null,
        kuladevata: dto.kuladevata || null,
        region: dto.region || null,
        hobbies: dto.hobbies || null,
        likes: dto.likes || null,
        dislikes: dto.dislikes || null,
        favoriteFoods: dto.favoriteFoods || null,
        contactNumber: dto.contactNumber || null,
        countryId: dto.countryId || null,
        address: dto.address || null,
        bio: dto.bio || null,
        familyCode: dto.familyCode || null,
      },
      { transaction }
    );

    // Step 3: Create family join request
    const existing = await this.familyMemberModel.findOne({
      where: {
        memberId: user.id,
        familyCode: dto.familyCode,
      },
      transaction,
    });

    if (existing) {
      throw new BadRequestException('User already requested or joined this family');
    }

    const membership = await this.familyMemberModel.create(
      {
        memberId: user.id,
        familyCode: dto.familyCode,
        creatorId: creatorId,
        approveStatus: 'approved',
      },
      { transaction }
    );

    // Step 4: Notify admins
    const adminUserIds = await this.notificationService.getAdminsForFamily(dto.familyCode);
    if (adminUserIds.length > 0) {
      await this.notificationService.createNotification(
        {
          type: 'FAMILY_MEMBER_JOINED',
          title: 'New Family Member Joined',
          message: `User ${dto?.firstName || ''} ${dto?.lastName || ''} has successfully joined your family.`,
          familyCode: dto.familyCode,
          referenceId: user.id,
          userIds: adminUserIds,
        },
        user.id
      );
    }

    await transaction.commit();

    return {
      message: 'User registered and join request submitted successfully',
      data: { user, membership },
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error in createUserAndJoinFamily:', error);
    throw error;
  }
}

  // User requests to join family
  async requestToJoinFamily(dto: CreateFamilyMemberDto, createdBy: number) {
    // First validate if familyCode exists in family table
    const family = await this.familyModel.findOne({
      where: {
        familyCode: dto.familyCode,
        status: 1, // Only active families
      },
    });

    if (!family) {
      throw new BadRequestException('Invalid family code. Family not found or inactive.');
    }

    // Check if user is already in family (to prevent duplicates)
    const existingMember = await this.familyMemberModel.findOne({
      where: {
        memberId: dto.memberId,
      },
    });

    if (existingMember) {
      // If member already exists, update the familyCode and set approveStatus to pending
      existingMember.familyCode = dto.familyCode;
      existingMember.approveStatus = 'pending';
      if (dto.creatorId) {
        existingMember.creatorId = dto.creatorId;
      }
      await existingMember.save();

      // Notify all family admins about updated join request
      const adminUserIds = await this.notificationService.getAdminsForFamily(dto.familyCode);
      if (adminUserIds.length > 0) {
        const user = await this.userProfileModel.findOne({ where: { userId: dto.memberId } });
        const requesterName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'A user';
        await this.notificationService.createNotification(
          {
            type: 'FAMILY_JOIN_REQUEST_UPDATED',
            title: 'Family Join Request Updated',
            message: `User ${requesterName} has updated their request to join your family.`,
            familyCode: dto.familyCode,
            referenceId: dto.memberId,
            data: {
              requesterId: dto.memberId,
              requesterName: requesterName,
              requesterFamilyCode: dto.familyCode,
              targetUserId: createdBy,
              targetName: 'you',
              targetFamilyCode: dto.familyCode
            },
            userIds: adminUserIds,
          },
          createdBy,
        );
      }

      return {
        message: 'Family join request updated successfully',
        data: existingMember,
      };
    }

    // Create new family member request with status pending
    const membership = await this.familyMemberModel.create({
      memberId: dto.memberId,
      familyCode: dto.familyCode,
      creatorId: dto.creatorId || createdBy,
      approveStatus: dto.approveStatus || 'pending',
    });

    // Get the target user's family code (the one being requested to associate with)
    const targetUserProfile = await this.userProfileModel.findOne({ 
      where: { userId: createdBy },
      include: [{
        model: this.userModel,
        as: 'user',
        include: [{
          model: UserProfile,
          as: 'userProfile'
        }]
      }]
    });

    if (!targetUserProfile?.familyCode) {
      throw new BadRequestException('Target user must belong to a family');
    }

    // Get requester's info
    const requesterProfile = await this.userProfileModel.findOne({ 
      where: { userId: dto.memberId },
      include: [{
        model: this.userModel,
        as: 'user',
        include: [{
          model: UserProfile,
          as: 'userProfile'
        }]
      }]
    });

    if (!requesterProfile?.familyCode) {
      throw new BadRequestException('Requester must belong to a family');
    }

    const requesterName = requesterProfile.user?.userProfile?.firstName 
      ? `${requesterProfile.user.userProfile.firstName} ${requesterProfile.user.userProfile.lastName || ''}`.trim() 
      : 'A user';

    // Send notification to the target user (the one who will accept/reject)
    await this.notificationService.createNotification(
      {
        type: 'FAMILY_ASSOCIATION_REQUEST',
        title: 'Family Association Request',
        message: `${requesterName} wants to connect their family with yours`,
        familyCode: targetUserProfile.familyCode, // Target user's family code
        referenceId: dto.memberId, // Requester's user ID
        data: {
          senderId: dto.memberId, // Who sent the request
          senderName: requesterName,
          senderFamilyCode: requesterProfile.familyCode,
          targetUserId: createdBy, // Who needs to accept
          targetFamilyCode: targetUserProfile.familyCode,
          requestType: 'family_association'
        },
        userIds: [createdBy], // Send to the target user
      },
      dto.memberId, // Triggered by the requester
    );

    return {
      message: 'Family join request submitted successfully',
      data: membership,
    };
  }

  // Approve family member request
  async approveFamilyMember(memberId: number, familyCode: string) {
    const membership = await this.familyMemberModel.findOne({
      where: { memberId, familyCode, approveStatus: 'pending' },
    });
    if (!membership) {
      throw new NotFoundException('Pending family member request not found');
    }

    membership.approveStatus = 'approved';
    await membership.save();

    // Notify the member about approval with a welcome message
    await this.notificationService.createNotification(
      {
        type: 'FAMILY_MEMBER_APPROVED',
        title: 'Welcome to the Family!',
        message: `Your request to join the family (${familyCode}) has been approved. Welcome!`,
        familyCode,
        referenceId: memberId,
        userIds: [memberId],
      },
      membership.creatorId,
    );

    return {
      message: 'Family member approved successfully',
      data: membership,
    };
  }

  // Reject family member request (optional, no notification example here)
  async rejectFamilyMember(memberId: number, rejectorId: number, familyCode: string) {
    const membership = await this.familyMemberModel.findOne({
      where: { memberId, familyCode },
    });
    if (!membership) {
      throw new NotFoundException('Family member not found');
    }

    // Permission check - only admins can reject members
    const adminUser = await this.userModel.findByPk(rejectorId);
    if (!adminUser || adminUser.role !== 2) {
      throw new BadRequestException('Access denied: Only family admins can reject members');
    }

    // Check if admin is in the same family
    const adminMembership = await this.familyMemberModel.findOne({
      where: {
        memberId: rejectorId,
        familyCode,
        approveStatus: 'approved',
      },
    });
    
    if (!adminMembership) {
      throw new BadRequestException('Access denied: Only family admins can reject members');
    }

    await membership.destroy();

    // Find user profile of rejected member to get their name
    const userProfile = await this.userProfileModel.findOne({ where: { userId: memberId } });
    const userName = userProfile
      ? `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim()
      : 'User';

    // Create notification for rejected member
    await this.notificationService.createNotification(
      {
        type: 'FAMILY_JOIN_REJECTED',
        title: 'Family Join Request Rejected',
        message: `Your request to join the family (${familyCode}) has been rejected.`,
        familyCode,
        referenceId: memberId,
        userIds: [memberId],
      },
      null,
    );

    return { message: `Family member ${userName} rejected successfully` };
  }

  // Delete family member from family (remove membership)
  async deleteFamilyMember(memberId: number, familyCode: string) {
    const membership = await this.familyMemberModel.findOne({
      where: { memberId, familyCode },
    });
    if (!membership) {
      throw new NotFoundException('Family member not found');
    }

    await membership.destroy();

    // Notify all family admins about member removal
    const adminUserIds = await this.notificationService.getAdminsForFamily(familyCode);
    if (adminUserIds.length > 0) {
      const user = await this.userProfileModel.findOne({ where: { userId: memberId } });
      await this.notificationService.createNotification(
        {
          type: 'FAMILY_MEMBER_REMOVED',
          title: 'Family Member Removed',
          message: `User ${user?.firstName || ''} ${user?.lastName || ''} has been removed from the family.`,
          familyCode,
          referenceId: memberId,
          userIds: adminUserIds,
        },
        null,
      );
    }

    return { message: 'Family member removed successfully' };
  }

  // Get all approved family members by family code
  async getAllFamilyMembers(familyCode: string) {
    // Get all users whose primary family is this familyCode OR who are approved members
    const members = await this.familyMemberModel.findAll({
      where: {
        familyCode,
        // Include both primary family members and approved additional members
        [Op.or]: [
          { approveStatus: 'approved' },
          // Include users whose primary family is this code regardless of approval status
          {
            '$user.userProfile.familyCode$': familyCode
          }
        ]
      },
      include: [
        {
          model: this.userModel,
          as: 'user',
          attributes: ['id', 'email', 'mobile', 'status', 'role'],
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
              attributes: ['firstName', 'lastName', 'profile', 'dob', 'gender', 'address'],
            },
          ],
        },
        {
          model: this.userModel,
          as: 'creator',
          attributes: ['id', 'email'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    const result = await Promise.all(members.map(async (memberInstance: any) => {
      const member = memberInstance.get({ plain: true });
      const user = member.user;
      
      // Get S3 URL for profile image if it exists
      let profileImage = null;
      if (user?.userProfile?.profile) {
        try {
          profileImage = await this.uploadService.getFileUrl(user.userProfile.profile, 'profile');
        } catch (error) {
          console.error('Error getting S3 URL for profile image:', error);
          // Fallback to the original profile path if S3 URL fetch fails
          const baseUrl = process.env.BASE_URL || '';
          const profilePath = process.env.USER_PROFILE_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/profile';
          profileImage = `${baseUrl.replace(/\/$/, '')}/${profilePath}/${user.userProfile.profile}`;
        }
      }

      return {
        ...member,
        user: {
          ...user,
          fullName: user?.userProfile
            ? `${user.userProfile.firstName} ${user.userProfile.lastName}`.trim()
            : null,
          profileImage,
        },
      };
    }));

    return {
      message: `${result.length} approved family members found.`,
      data: result,
    };

  }

  async getUserIdsInFamily(familyCode: string): Promise<number[]> {
    const members = await this.familyMemberModel.findAll({
      where: {
        familyCode,
        [Op.or]: [
          { approveStatus: 'approved' },
          { '$user.userProfile.familyCode$': familyCode }
        ]
      },
      include: [{
        model: this.userModel,
        as: 'user',
        include: [{
          model: this.userProfileModel,
          as: 'userProfile',
          attributes: ['familyCode']
        }]
      }],
      attributes: ['memberId']
    });
    return members.map(m => m.memberId);
  }

  async getMemberById(memberId: number) {
    const member = await this.familyMemberModel.findOne({
      where: { memberId },
      include: [
        {
          model: this.userModel,
          as: 'user', // explicitly specify alias
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
            },
          ],
        },
        {
          model: this.userModel,
          as: 'creator', // optionally include creator if needed
          attributes: ['id', 'email'],
        },
      ],
    });

    if (!member) {
      throw new NotFoundException('Family member not found');
    }

    return member;
  }

  async getFamilyStatsByCode(familyCode: string) {
    const members = await this.familyMemberModel.findAll({
      where: { 
        familyCode,
        [Op.or]: [
          { approveStatus: 'approved' },
          { '$user.userProfile.familyCode$': familyCode }
        ]
      },
      include: [
        {
          model: this.userModel,
          as: 'user',
          attributes: ['id'],
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
              attributes: ['gender', 'dob'],
            },
          ],
        },
      ],
    });

    let total = 0, males = 0, females = 0, totalAge = 0;

    for (const member of members as any) {
      const profile = member.user?.userProfile;
      if (!profile) continue;

      total++;

      const gender = profile.gender?.toLowerCase();

      if (gender === 'male') males++;
      else if (gender === 'female') females++;

      if (profile.dob) {
        const dob = new Date(profile.dob);
        const age = new Date().getFullYear() - dob.getFullYear();
        totalAge += age;
      }
    }

    const averageAge = total > 0 ? parseFloat((totalAge / total).toFixed(1)) : 0;

    return {
      totalMembers: total,
      males,
      females,
      averageAge,
    };
  }

  async getPendingRequestsByUser(userId: number) {
    // Step 1: Get the logged-in user's familyCode
    const currentMember = await this.familyMemberModel.findOne({
      where: { memberId: userId },
    });

    if (!currentMember) {
      throw new Error('Family membership not found for current user.');
    }

    const familyCode = currentMember.familyCode;

    // Step 2: Get all pending members for this familyCode
    const members = await this.familyMemberModel.findAll({
      where: {
        familyCode,
        approveStatus: 'pending',
      },
      include: [
        {
          model: this.userModel,
          as: 'user',
          attributes: ['id', 'email', 'mobile', 'status', 'role'],
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
              attributes: ['firstName', 'lastName', 'profile', 'dob', 'gender', 'address'],
            },
          ],
        },
        {
          model: this.userModel,
          as: 'creator',
          attributes: ['id', 'email'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    // Step 3: Format response
    const baseUrl = process.env.BASE_URL || '';
    const profilePath = process.env.USER_PROFILE_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/profile';

    const result = members.map((memberInstance: any) => {
      const member = memberInstance.get({ plain: true });

      const user = member.user;
      const profileImage = user?.userProfile?.profile
        ? `${baseUrl.replace(/\/$/, '')}/${profilePath}/${user.userProfile.profile}`
        : null;

      return {
        ...member,
        user: {
          ...user,
          fullName: user?.userProfile
            ? `${user.userProfile.firstName} ${user.userProfile.lastName}`
            : null,
          profileImage,
        },
      };
    });

    return {
      message: `${result.length} pending family member request(s) found.`,
      data: result,
    };
  }

  async suggestFamilyByProfile(userId: number) {
    // 1. Get user profile
    const profile = await this.userProfileModel.findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('User profile not found');

    // 2. Collect all names to search
    const names: string[] = [];
    if (profile.fatherName) names.push(profile.fatherName);
    if (profile.motherName) names.push(profile.motherName);
    if (profile.spouseName) names.push(profile.spouseName);
    if (profile.childrenNames) {
      try {
        const children = Array.isArray(profile.childrenNames)
          ? profile.childrenNames
          : JSON.parse(profile.childrenNames);
        if (Array.isArray(children)) names.push(...children);
      } catch {
        names.push(profile.childrenNames);
      }
    }

    // Remove falsy and duplicate names
    const uniqueNames = Array.from(new Set(names.filter(Boolean)));
    if (uniqueNames.length < 1) return { message: 'At least 1 name required to suggest families', data: [] };

    // 3. Search for all families that have any matching names
    const Op = require('sequelize').Op;
    const allMatches = await this.userProfileModel.findAll({
      where: {
        [Op.or]: uniqueNames.map(name => ({ firstName: { [Op.iLike]: `%${name}%` } })),
      },
      attributes: ['userId', 'firstName', 'familyCode'],
    });

    // 4. Build family match map with scores
    const familyMatchMap: Record<string, { names: Set<string>, scores: Map<string, number> }> = {};
    
    for (const match of allMatches) {
      const famCode = match.familyCode;
      if (!famCode) continue;
      
      for (const name of uniqueNames) {
        const matchFirstName = match.firstName?.toLowerCase() || '';
        const searchName = name.toLowerCase();
        
        let matchScore = 0;
        let isMatch = false;
        
        // Calculate match score based on quality
        if (matchFirstName === searchName) {
          matchScore = 100; // Exact match - highest score
          isMatch = true;
        } else if (matchFirstName.startsWith(searchName + ' ') || matchFirstName.endsWith(' ' + searchName)) {
          matchScore = 80; // Starts/ends with search name + space
          isMatch = true;
        } else if (matchFirstName.includes(' ' + searchName + ' ')) {
          matchScore = 70; // Contains space + search name + space
          isMatch = true;
        } else if (matchFirstName.startsWith(searchName) && matchFirstName.length <= searchName.length + 3) {
          matchScore = 60; // Starts with and close length
          isMatch = true;
        } else if (matchFirstName.endsWith(searchName) && matchFirstName.length <= searchName.length + 3) {
          matchScore = 50; // Ends with and close length
          isMatch = true;
        } else if (
          (matchFirstName.includes(searchName) || searchName.includes(matchFirstName)) &&
          Math.abs(matchFirstName.length - searchName.length) <= 5
        ) {
          matchScore = 30; // Contains (either direction) but with reasonable length difference
          isMatch = true;
        }
        
        if (isMatch) {
          if (!familyMatchMap[famCode]) {
            familyMatchMap[famCode] = { names: new Set(), scores: new Map() };
          }
          familyMatchMap[famCode].names.add(name);
          familyMatchMap[famCode].scores.set(name, matchScore);
        }
      }
    }

    // 5. Get valid families and calculate scores
    const familyCodes = Object.keys(familyMatchMap).filter(
      code => familyMatchMap[code].names.size >= 1
    );

    if (familyCodes.length === 0) {
      return { message: 'No matching families found', data: [] };
    }

    const validFamilies = await this.familyModel.findAll({
      where: { familyCode: familyCodes, status: 1 },
      attributes: ['familyCode', 'familyName'],
    });

    const foundFamilies = [];
    for (const fam of validFamilies) {
      const familyMatch = familyMatchMap[fam.familyCode];
      const totalScore = Array.from(familyMatch.scores.values()).reduce((sum, score) => sum + score, 0);
      
      foundFamilies.push({
        familyCode: fam.familyCode,
        familyName: fam.familyName || null,
        matchCount: familyMatch.names.size,
        matchedNames: Array.from(familyMatch.names),
        totalScore: totalScore,
      });
    }

    // 6. Get all members for each family
    const families = [];
    for (const fam of foundFamilies) {
      const members = await this.getAllFamilyMembers(fam.familyCode);
      families.push({
        ...fam,
        members: members.data,
      });
    }

    // 7. Sort by total score (best matches first), then by match count, then by family name
    families.sort((a, b) => {
      // First sort by total score (highest first)
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }
      // Then by match count (highest first)
      if (b.matchCount !== a.matchCount) {
        return b.matchCount - a.matchCount;
      }
      // Finally by family name
      return (a.familyName || '').localeCompare(b.familyName || '');
    });

    // Debug log to help verify results
    console.log('User search names:', uniqueNames);
    console.log('Found families:', families.map(f => ({
      familyCode: f.familyCode,
      familyName: f.familyName,
      matchCount: f.matchCount,
      totalScore: f.totalScore,
      matchedNames: f.matchedNames
    })));

    return { message: `Matching families found`, data: families };
  }

// Enhanced validation method for link validation - checks member exists and link usage
async checkMemberExists(familyCode: string, memberId: number) {
  try {
    const member = await this.familyMemberModel.findOne({
      where: {
        familyCode,
        memberId
      },
      include: [
        {
          model: this.userModel,
          as: 'user',
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile'
            }
          ]
        }
      ]
    });

    if (!member) {
      throw new NotFoundException('Member not found in this family');
    }

    // Type assertion to access included associations
    const memberData = member as any;
    
    return {
      message: 'Member validation successful',
      data: {
        exists: true,
        isLinkUsed: member.isLinkUsed || false,
        member: {
          id: member.memberId,
          familyCode: member.familyCode,
          approveStatus: member.approveStatus,
          user: memberData.user ? {
            id: memberData.user.id,
            email: memberData.user.email,
            mobile: memberData.user.mobile,
            userProfile: memberData.user.userProfile
          } : null
        }
      }
    };
  } catch (error) {
    if (error instanceof NotFoundException) {
      throw error;
    }
    console.error('Error validating member:', error);
    throw new BadRequestException('Failed to validate member');
  }
}

// Mark invitation link as used
async markLinkAsUsed(familyCode: string, memberId: number) {
  try {
    const member = await this.familyMemberModel.findOne({
      where: {
        familyCode,
        memberId
      }
    });

    if (!member) {
      throw new NotFoundException('Member not found in this family');
    }

    if (member.isLinkUsed) {
      throw new BadRequestException('This invitation link has already been used');
    }

    await member.update({ isLinkUsed: true });

    return {
      message: 'Invitation link marked as used successfully',
      data: {
        memberId: member.memberId,
        familyCode: member.familyCode,
        isLinkUsed: true
      }
    };
  } catch (error) {
    if (error instanceof NotFoundException || error instanceof BadRequestException) {
      throw error;
    }
    console.error('Error marking link as used:', error);
    throw new BadRequestException('Failed to mark link as used');
  }
}

  async addUserToFamily(userId: number, familyCode: string, addedBy: number) {
    try {
      // Check if user exists
      const user = await this.userModel.findByPk(userId, {
        include: [{
          model: this.userProfileModel,
          as: 'userProfile'
        }]
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Check if family exists
      const familyExists = await this.familyMemberModel.findOne({
        where: { familyCode }
      });

      if (!familyExists) {
        throw new NotFoundException('Family not found');
      }

      // Check if user is already a member of this family
      const existingMember = await this.familyMemberModel.findOne({
        where: {
          memberId: userId,
          familyCode
        }
      });

      if (existingMember) {
        throw new BadRequestException('User is already a member of this family');
      }

      // Update user profile with familyCode if not already set
      if (user.userProfile && !user.userProfile.familyCode) {
        await this.userProfileModel.update(
          { familyCode },
          { where: { userId } }
        );
      }

      // Add user to family member table
      const newMember = await this.familyMemberModel.create({
        memberId: userId,
        familyCode,
        approveStatus: 'approved', // Auto-approve since admin is adding
        creatorId: addedBy
      });

      return {
        message: 'User added to family successfully',
        data: {
          memberId: newMember.memberId,
          userId,
          familyCode,
          approveStatus: 'approved'
        }
      };

    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      console.error('Error adding user to family:', error);
      throw new BadRequestException('Failed to add user to family');
    }
  }
  
}
