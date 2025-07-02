import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op } from 'sequelize';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Family } from './model/family.model';
import { FamilyMember } from './model/family-member.model';
import { MailService } from '../utils/mail.service';
import { NotificationService } from '../notification/notification.service'; // Import your notification service
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

    private notificationService: NotificationService,

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
    // Check if user is already in family (to prevent duplicates)
    const existingMember = await this.familyMemberModel.findOne({
      where: {
        memberId: dto.memberId,
        familyCode: dto.familyCode,
      },
    });

    if (existingMember) {
      throw new BadRequestException('User is already a member of this family');
    }

    // Create family member request with status pending
    const membership = await this.familyMemberModel.create({
      memberId: dto.memberId,
      familyCode: dto.familyCode,
      creatorId: createdBy,
      approveStatus: 'approved',
    });

    // Notify all family admins about new join request
    const adminUserIds = await this.notificationService.getAdminsForFamily(dto.familyCode);
    if (adminUserIds.length > 0) {
      const user = await this.userProfileModel.findOne({ where: { userId: dto.memberId } });
      await this.notificationService.createNotification(
        {
          type: 'FAMILY_MEMBER_JOINED',
          title: 'New Family Member Joined',
          message: `User ${user?.firstName || ''} ${user?.lastName || ''} has successfully joined your family.`,
          familyCode: dto.familyCode,
          referenceId: dto.memberId,
          userIds: adminUserIds,
        },
        createdBy,
      );
    }

    return {
      message: 'Family join request submitted successfully',
      data: membership,
    };
  }

  // Approve family member request (only by admin)
  async approveFamilyMember(memberId: number, familyCode: string) {
    const membership = await this.familyMemberModel.findOne({
      where: { memberId, familyCode, approveStatus: 'pending' },
    });
    if (!membership) {
      throw new NotFoundException('Pending family member request not found');
    }
    //console.log(membership);return;
    
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
        userIds: [memberId], // Notify only the member
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
    // Find the family member entry
    const familyMember = await this.familyMemberModel.findOne({ where: { memberId } });
    if (!familyMember) throw new BadRequestException('Family member not found');

    // Update approveStatus to 'rejected'
    familyMember.approveStatus = 'rejected';
    await familyMember.save();

    // Find user profile of rejected member to get their name
    const userProfile = await this.userProfileModel.findOne({ where: { userId: memberId } });
    const userName = userProfile
      ? `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim()
      : 'User';

    // Notify the rejected user about rejection
    await this.notificationService.createNotification({
      type: 'FAMILY_JOIN_REJECTED',
      title: 'Family Join Request Rejected',
      message: `Hello ${userName}, your request to join the family has been rejected.`,
      familyCode: familyMember.familyCode,
      referenceId: memberId,
      userIds: [memberId], // notify the rejected member
    }, rejectorId);

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
  const members = await this.familyMemberModel.findAll({
    where: {
      familyCode,
      approveStatus: 'approved',
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
            attributes: ['firstName', 'lastName', 'profile', 'dob', 'gender', 'address', ],
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
    message: `${result.length} approved family members found.`,
    data: result,
  };
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
      where: { familyCode, approveStatus: "approved" },
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

  
}
