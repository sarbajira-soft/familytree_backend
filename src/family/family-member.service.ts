import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Family } from './model/family.model';
import { FamilyMember } from './model/family-member.model';
import { MailService } from '../utils/mail.service';
import { NotificationService } from '../notification/notification.service'; // Import your notification service
import { extractUserProfileFields } from '../utils/profile-mapper.util';
import * as path from 'path';
import * as fs from 'fs';

import { CreateFamilyMemberDto } from './dto/create-family-member.dto';

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

    private notificationService: NotificationService, // inject notification service
  ) {}

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
      approveStatus: 'pending',
    });

    // Notify all family admins about new join request
    const adminUserIds = await this.notificationService.getAdminsForFamily(dto.familyCode);
    if (adminUserIds.length > 0) {
      const user = await this.userProfileModel.findOne({ where: { userId: dto.memberId } });
      await this.notificationService.createNotification(
        {
          type: 'FAMILY_JOIN_REQUEST',
          title: 'New Family Join Request',
          message: `User ${user?.firstName || ''} ${user?.lastName || ''} has requested to join your family.`,
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
      where: { familyCode },
      include: [
        {
          model: this.userModel,
          as: 'user',
          attributes: ['id', 'email', 'mobile', 'status', 'role'],
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
            },
          ],
        },
        {
          model: this.userModel,
          as: 'creator', // optional: to get creator details too
          attributes: ['id', 'email'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    return {
      message: `${members.length} family members found.`,
      data: members,
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
  
}
