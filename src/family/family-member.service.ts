import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op, QueryTypes } from 'sequelize';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Family } from './model/family.model';
import { FamilyMember } from './model/family-member.model';
import { FamilyTree } from './model/family-tree.model';
import { MailService } from '../utils/mail.service';
import { NotificationService } from '../notification/notification.service';
import { UploadService } from '../uploads/upload.service';
import * as bcrypt from 'bcrypt';
import { repairFamilyTreeIntegrity } from './tree-integrity';
 
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { CreateUserAndJoinFamilyDto } from './dto/create-user-and-join-family.dto';

@Injectable()
export class FamilyMemberService {
  constructor(
    @InjectModel(User)
    private readonly userModel: typeof User,

    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,

    @InjectModel(Family)
    private readonly familyModel: typeof Family,

    @InjectModel(FamilyMember)
    private readonly familyMemberModel: typeof FamilyMember,

    @InjectModel(FamilyTree)
    private readonly familyTreeModel: typeof FamilyTree,

    private readonly mailService: MailService,

    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,

    private readonly uploadService: UploadService,

    private readonly sequelize: Sequelize,
  ) {}

  private async requireFamilyOrThrow(familyCode: string) {
    const family = await this.familyModel.findOne({ where: { familyCode } });
    if (!family) {
      throw new NotFoundException('Family not found');
    }
    return family;
  }

  private validateRemovalPermissions(
    memberId: number,
    actingUserId: number,
    family: Family,
  ) {
    if (Number(memberId) === Number(actingUserId)) {
      throw new BadRequestException('You cannot delete your own account');
    }

    if (Number(memberId) === Number((family as any).createdBy)) {
      throw new BadRequestException('Cannot delete the family owner');
    }
  }

  private async isAdminOfFamily(actingUserId: number, familyCode: string) {
    if (!actingUserId || !familyCode) return false;

    const actingUser = await this.userModel.findByPk(actingUserId);
    if (!actingUser || (actingUser.role !== 2 && actingUser.role !== 3)) {
      return false;
    }

    const profile = await this.userProfileModel.findOne({
      where: { userId: actingUserId },
      attributes: ['familyCode'],
    });

    const profileFamilyCode = String(profile?.familyCode || '')
      .trim()
      .toUpperCase();
    const targetFamilyCode = String(familyCode || '').trim().toUpperCase();

    return Boolean(profileFamilyCode && profileFamilyCode === targetFamilyCode);
  }

  private async requireAdminMembership(actingUserId: number, familyCode: string) {
    const isAdminOfFamily = await this.isAdminOfFamily(actingUserId, familyCode);
    if (!isAdminOfFamily) {
      throw new BadRequestException('Access denied: Only family admins can delete members');
    }

    const actingMembership = await this.familyMemberModel.findOne({
      where: {
        memberId: actingUserId,
        familyCode,
        approveStatus: 'approved',
      },
    });

    if (!actingMembership) {
      throw new BadRequestException('Access denied: Only family admins can delete members');
    }

    return actingMembership;
  }

  private async cleanupRemovedMemberProfile(memberId: number, familyCode: string) {
    const removedUserProfile = await this.userProfileModel.findOne({
      where: { userId: memberId },
    });

    if (!removedUserProfile) return;

    const associated = Array.isArray(removedUserProfile.associatedFamilyCodes)
      ? removedUserProfile.associatedFamilyCodes
      : [];
    const nextAssociated = associated.filter((code) => code && code !== familyCode);
    const shouldClearPrimary = removedUserProfile.familyCode === familyCode;

    if (shouldClearPrimary || nextAssociated.length !== associated.length) {
      await removedUserProfile.update({
        ...(shouldClearPrimary ? { familyCode: null } : {}),
        associatedFamilyCodes: nextAssociated,
      } as any);
    }
  }

  private async notifyMemberRemoval(memberId: number, familyCode: string) {
    const adminUserIds = await this.notificationService.getAdminsForFamily(familyCode);
    if (adminUserIds.length === 0) return;

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

  private collectProfileNames(profile: UserProfile): string[] {
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
    return names;
  }

  private async fetchMatchingProfiles(uniqueNames: string[]) {
    return this.userProfileModel.findAll({
      where: {
        [Op.or]: uniqueNames.map((name) => ({
          firstName: { [Op.iLike]: `%${name}%` },
        })),
      },
      attributes: ['userId', 'firstName', 'familyCode'],
    });
  }

  private static computeMatchScore(matchFirstName: string, searchName: string) {
    if (matchFirstName === searchName) return 100;
    if (
      matchFirstName.startsWith(`${searchName} `) ||
      matchFirstName.endsWith(` ${searchName}`)
    ) {
      return 80;
    }
    if (matchFirstName.includes(` ${searchName} `)) return 70;
    if (matchFirstName.startsWith(searchName) && matchFirstName.length <= searchName.length + 3) {
      return 60;
    }
    if (matchFirstName.endsWith(searchName) && matchFirstName.length <= searchName.length + 3) {
      return 50;
    }
    if (
      (matchFirstName.includes(searchName) || searchName.includes(matchFirstName)) &&
      Math.abs(matchFirstName.length - searchName.length) <= 5
    ) {
      return 30;
    }
    return 0;
  }

  private buildFamilyMatchMap(uniqueNames: string[], allMatches: UserProfile[]) {
    const familyMatchMap: Record<string, { names: Set<string>; scores: Map<string, number> }> = {};

    for (const match of allMatches) {
      const famCode = match.familyCode;
      if (!famCode) continue;

      for (const name of uniqueNames) {
        const matchFirstName = match.firstName?.toLowerCase() || '';
        const searchName = name.toLowerCase();
        const matchScore = FamilyMemberService.computeMatchScore(
          matchFirstName,
          searchName,
        );

        if (matchScore > 0) {
          if (!familyMatchMap[famCode]) {
            familyMatchMap[famCode] = { names: new Set(), scores: new Map() };
          }
          familyMatchMap[famCode].names.add(name);
          familyMatchMap[famCode].scores.set(name, matchScore);
        }
      }
    }

    return familyMatchMap;
  }

  private async buildFoundFamilies(
    familyMatchMap: Record<string, { names: Set<string>; scores: Map<string, number> }>,
  ) {
    const familyCodes = Object.keys(familyMatchMap).filter(
      (code) => familyMatchMap[code].names.size >= 1,
    );

    if (familyCodes.length === 0) return [];

    const validFamilies = await this.familyModel.findAll({
      where: { familyCode: familyCodes, status: 1 },
      attributes: ['familyCode', 'familyName'],
    });

    return validFamilies.map((fam) => {
      const familyMatch = familyMatchMap[fam.familyCode];
      const totalScore = Array.from(familyMatch.scores.values()).reduce(
        (sum, score) => sum + score,
        0,
      );

      return {
        familyCode: fam.familyCode,
        familyName: fam.familyName || null,
        matchCount: familyMatch.names.size,
        matchedNames: Array.from(familyMatch.names),
        totalScore,
      };
    });
  }

  private async attachMembersToFamilies(
    foundFamilies: Array<{
      familyCode: string;
      familyName: string | null;
      matchCount: number;
      matchedNames: string[];
      totalScore: number;
    }>,
  ) {
    const families = [];
    for (const fam of foundFamilies) {
      const members = await this.getAllFamilyMembers(fam.familyCode);
      families.push({
        ...fam,
        members: members.data,
      });
    }
    return families;
  }

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
        password: await bcrypt.hash(dto.password, 12),
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
        otherReligion: dto.otherReligion || null,
        languageId: dto.languageId || null,
        otherLanguage: dto.otherLanguage || null,
        caste: dto.caste || null,
        gothramId: dto.gothramId || null,
        otherGothram: dto.otherGothram || null,
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
  async approveFamilyMember(memberId: number, familyCode: string, actingUserId: number) {
    const family = await this.familyModel.findOne({ where: { familyCode } });
    if (!family) {
      throw new NotFoundException('Family not found');
    }

    const isOwner = Number((family as any).createdBy) === Number(actingUserId);
    const isAdmin = await this.isAdminOfFamily(actingUserId, familyCode);
    if (!isOwner && !isAdmin) {
      throw new BadRequestException('Access denied: Only family admins can approve members');
    }

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

    const family = await this.familyModel.findOne({ where: { familyCode } });
    if (!family) {
      throw new NotFoundException('Family not found');
    }

    const isOwner = Number((family as any).createdBy) === Number(rejectorId);
    const isAdmin = await this.isAdminOfFamily(rejectorId, familyCode);
    if (!isOwner && !isAdmin) {
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
  async deleteFamilyMember(memberId: number, familyCode: string, actingUserId?: number) {
    if (!actingUserId) {
      throw new BadRequestException('Access denied');
    }

    // Load family to determine owner/root user
    const family = await this.requireFamilyOrThrow(familyCode);
    this.validateRemovalPermissions(memberId, actingUserId, family);
    await this.requireAdminMembership(actingUserId, familyCode);

    const membership = await this.familyMemberModel.findOne({
      where: { memberId, familyCode },
    });
    if (!membership) {
      throw new NotFoundException('Family member not found');
    }

    await membership.destroy();

    // If the removed member's profile is still pointing to this family, clear it.
    // Also remove this family from associated family codes.
    await this.cleanupRemovedMemberProfile(memberId, familyCode);
    await this.notifyMemberRemoval(memberId, familyCode);

    // Bug 55: removing a user from the family must also clean up their tree nodes and relationships,
    // otherwise the remaining sub-tree can drift into weird positions due to orphaned edges.
    try {
      await this.sequelize.transaction(async (transaction) => {
        const cards = await this.familyTreeModel.findAll({
          where: { familyCode, userId: memberId } as any,
          transaction,
        });

        const deletedPersonIds = cards
          .map((c: any) => Number((c as any).personId))
          .filter((id) => Number.isFinite(id));

        if (cards.length > 0) {
          await this.familyTreeModel.destroy({
            where: { familyCode, userId: memberId } as any,
            transaction,
          });
        }

        if (deletedPersonIds.length > 0) {
          const remaining = await this.familyTreeModel.findAll({
            where: { familyCode } as any,
            transaction,
          });

          const del = new Set<number>(deletedPersonIds);
          const cleanArray = (arr: any) =>
            (Array.isArray(arr) ? arr : [])
              .map((x) => (typeof x === 'string' ? Number(x) : x))
              .filter((x) => Number.isFinite(x) && !del.has(Number(x)));

          for (const entry of remaining as any[]) {
            const nextParents = cleanArray((entry as any).parents);
            const nextChildren = cleanArray((entry as any).children);
            const nextSpouses = cleanArray((entry as any).spouses);
            const nextSiblings = cleanArray((entry as any).siblings);

            const changed =
              JSON.stringify(nextParents) !== JSON.stringify((entry as any).parents) ||
              JSON.stringify(nextChildren) !== JSON.stringify((entry as any).children) ||
              JSON.stringify(nextSpouses) !== JSON.stringify((entry as any).spouses) ||
              JSON.stringify(nextSiblings) !== JSON.stringify((entry as any).siblings);

            if (changed) {
              await (entry as any).update(
                {
                  parents: nextParents,
                  children: nextChildren,
                  spouses: nextSpouses,
                  siblings: nextSiblings,
                } as any,
                { transaction },
              );
            }
          }
        }

        await repairFamilyTreeIntegrity({
          familyCode,
          transaction,
          lock: true,
          fixExternalGenerations: true,
        });
      });
    } catch (e) {
      // Don’t block deletion if repair fails; log and proceed.
      console.error('Failed to cleanup tree after member removal:', e);
    }

    return { message: 'Family member removed successfully' };
  }

  async blockFamilyMember(memberId: number, familyCode: string, actingUserId: number) {
    // Load family to determine owner/root user
    const family = await this.familyModel.findOne({ where: { familyCode } });
    if (!family) {
      throw new NotFoundException('Family not found');
    }

    // Prevent blocking the family owner/root
    if (memberId === family.createdBy) {
      throw new BadRequestException('Cannot block the family owner');
    }

    // Prevent blocking self
    if (memberId === actingUserId) {
      throw new BadRequestException('You cannot block yourself');
    }

    const membership = await this.familyMemberModel.findOne({
      where: { memberId, familyCode },
    });

    if (!membership) {
      throw new NotFoundException('Family member not found');
    }

    // Only admins or the family owner can block members
    const isOwner = family.createdBy === actingUserId;
    const isAdmin = await this.isAdminOfFamily(actingUserId, familyCode);

    if (!isOwner && !isAdmin) {
      throw new BadRequestException('Access denied: Only family admins can block members');
    }

    if (membership.isBlocked) {
      return { message: 'Family member is already blocked', data: membership };
    }

    await membership.update({
      isBlocked: true,
      blockedByUserId: actingUserId,
      blockedAt: new Date(),
    });

    return {
      message: 'Family member blocked successfully',
      data: membership,
    };
  }

  async unblockFamilyMember(memberId: number, familyCode: string, actingUserId: number) {
    const family = await this.familyModel.findOne({ where: { familyCode } });
    if (!family) {
      throw new NotFoundException('Family not found');
    }

    const membership = await this.familyMemberModel.findOne({
      where: { memberId, familyCode },
    });

    if (!membership) {
      throw new NotFoundException('Family member not found');
    }

    // Only admins or the family owner can unblock members
    const isOwner = family.createdBy === actingUserId;
    const isAdmin = await this.isAdminOfFamily(actingUserId, familyCode);

    if (!isOwner && !isAdmin) {
      throw new BadRequestException('Access denied: Only family admins can unblock members');
    }

    if (!membership.isBlocked) {
      return { message: 'Family member is not blocked', data: membership };
    }

    await membership.update({
      isBlocked: false,
      blockedByUserId: null,
      blockedAt: null,
    });

    return {
      message: 'Family member unblocked successfully',
      data: membership,
    };
  }

  // Get all approved family members by family code
  async getAllFamilyMembers(familyCode: string, requestingUserId?: number) {
    // If the requesting user is blocked from this family, deny access
    if (requestingUserId) {
      const membership = await this.familyMemberModel.findOne({
        where: {
          memberId: requestingUserId,
          familyCode,
        },
      });

      if (membership && (membership as any).isBlocked) {
        throw new ForbiddenException('You have been blocked from this family');
      }
    }

    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    const requesterIsFamilyAdmin = await this.isAdminOfFamily(
      Number(requestingUserId),
      String(familyCode),
    );

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
              attributes: ['firstName', 'lastName', 'profile', 'dob', 'gender', 'address', 'familyCode'],
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

    const baseResult = await Promise.all(members.map(async (memberInstance: any) => {
      const member = memberInstance.get({ plain: true });
      const user = member.user;
      
      // Get S3 URL for profile image if it exists
      let profileImage = null;
      if (user?.userProfile?.profile) {
        try {
          profileImage = this.uploadService.getFileUrl(user.userProfile.profile, 'profile');
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
        membershipType: 'member',
        // Hide blocked status from non-admin users to avoid leaking moderation state.
        isBlocked: requesterIsFamilyAdmin ? Boolean(member?.isBlocked) : false,
        familyRole:
          user?.role >= 2 &&
          String(user?.userProfile?.familyCode || '').trim().toUpperCase() ===
            normalizedFamilyCode
            ? user.role === 3
              ? 'Superadmin'
              : 'Admin'
            : 'Member',
        isFamilyAdmin:
          user?.role >= 2 &&
          String(user?.userProfile?.familyCode || '').trim().toUpperCase() ===
            normalizedFamilyCode,
      };
    }));

    // Include cross-family linked users (e.g. spouse associations) that have this familyCode
    // in their associatedFamilyCodes, even if they are not ft_family_members for this family.
    const baseUserIds = new Set<number>(
      baseResult
        .map((m: any) => Number(m?.user?.id))
        .filter((id: any) => Number.isFinite(id) && id > 0),
    );

    const associatedRows = (await this.sequelize.query(
      `
        SELECT "userId"
        FROM public.ft_user_profile
        WHERE "associatedFamilyCodes" @> :needle::json
      `,
      {
        replacements: { needle: JSON.stringify([normalizedFamilyCode]) },
        type: QueryTypes.SELECT,
      },
    )) as Array<{ userId: number }>;

    const associatedUserIds = Array.from(
      new Set(
        (associatedRows || [])
          .map((r) => Number((r as any)?.userId))
          .filter((id) => Number.isFinite(id) && id > 0 && !baseUserIds.has(id)),
      ),
    );

    let associatedResult: any[] = [];
    if (associatedUserIds.length > 0) {
      const associatedUsers = await this.userModel.findAll({
        where: { id: { [Op.in]: associatedUserIds } } as any,
        attributes: ['id', 'email', 'mobile', 'status', 'role'],
        include: [
          {
            model: this.userProfileModel,
            as: 'userProfile',
            attributes: ['firstName', 'lastName', 'profile', 'dob', 'gender', 'address', 'familyCode'],
          },
        ],
        order: [['id', 'DESC']],
      });

      associatedResult = await Promise.all(
        (associatedUsers as any[]).map(async (u: any) => {
          let profileImage = null;
          if (u?.userProfile?.profile) {
            try {
              profileImage = this.uploadService.getFileUrl(u.userProfile.profile, 'profile');
            } catch (error) {
              console.error('Error getting S3 URL for profile image:', error);
              const baseUrl = process.env.BASE_URL || '';
              const profilePath = process.env.USER_PROFILE_UPLOAD_PATH?.replace(/^\.\/?/, '') || 'uploads/profile';
              profileImage = `${baseUrl.replace(/\/$/, '')}/${profilePath}/${u.userProfile.profile}`;
            }
          }

          return {
            // Negative id prevents collision with ft_family_members serial ids.
            id: -Number(u.id),
            memberId: null,
            familyCode,
            creatorId: null,
            approveStatus: 'associated',
            isLinkedUsed: false,
            isBlocked: false,
            blockedByUserId: null,
            blockedAt: null,
            createdAt: null,
            updatedAt: null,
            user: {
              ...u.toJSON(),
              fullName: u?.userProfile
                ? `${u.userProfile.firstName || ''} ${u.userProfile.lastName || ''}`.trim()
                : null,
              profileImage,
            },
            membershipType: 'associated',
            familyRole: 'Member',
            isFamilyAdmin: false,
          };
        }),
      );
    }

    const result = [...baseResult, ...associatedResult];

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

    const averageAge = total > 0 ? Number.parseFloat((totalAge / total).toFixed(1)) : 0;

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

    const normalizeName = (v: any) =>
      String(v || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();

    // 2. Collect all names to search
    const names = this.collectProfileNames(profile);

    // Remove falsy and duplicate names
    const uniqueNames = Array.from(new Set(names.filter(Boolean)));
    if (uniqueNames.length < 1) return { message: 'At least 1 name required to suggest families', data: [] };

    // 3. Search for all families that have any matching names
    const allMatches = await this.fetchMatchingProfiles(uniqueNames);
    const familyMatchMap = this.buildFamilyMatchMap(uniqueNames, allMatches);

    // 3b. Parent-name match (exact, case-insensitive). This specifically fixes the "same parents" use case.
    const fatherNorm = normalizeName((profile as any).fatherName);
    const motherNorm = normalizeName((profile as any).motherName);
    if (fatherNorm && motherNorm) {
      const parentCandidates = await this.userProfileModel.findAll({
        where: {
          familyCode: { [Op.ne]: null },
          fatherName: { [Op.iLike]: `%${String((profile as any).fatherName).trim()}%` },
          motherName: { [Op.iLike]: `%${String((profile as any).motherName).trim()}%` },
        },
        attributes: ['userId', 'familyCode', 'fatherName', 'motherName'],
      });

      for (const m of parentCandidates as any[]) {
        const famCode = String(m.familyCode || '').trim();
        if (!famCode) continue;
        if (normalizeName(m.fatherName) !== fatherNorm) continue;
        if (normalizeName(m.motherName) !== motherNorm) continue;

        if (!familyMatchMap[famCode]) {
          familyMatchMap[famCode] = { names: new Set(), scores: new Map() };
        }

        // Strong signal: both parents match exactly.
        if ((profile as any).fatherName) {
          familyMatchMap[famCode].names.add((profile as any).fatherName);
          familyMatchMap[famCode].scores.set((profile as any).fatherName, 150);
        }
        if ((profile as any).motherName) {
          familyMatchMap[famCode].names.add((profile as any).motherName);
          familyMatchMap[famCode].scores.set((profile as any).motherName, 150);
        }
      }
    }

    const foundFamilies = await this.buildFoundFamilies(familyMatchMap);

    if (foundFamilies.length === 0) {
      return { message: 'No matching families found', data: [] };
    }

    const families = await this.attachMembersToFamilies(foundFamilies);

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
        isLinkUsed: member.isLinkedUsed || false,
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

    if (member.isLinkedUsed) {
      throw new BadRequestException('This invitation link has already been used');
    }

    await member.update({ isLinkedUsed: true });

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
    const transaction = await this.sequelize.transaction();
    try {
      // Check if user exists
      const user = await this.userModel.findByPk(userId, {
        include: [
          {
            model: this.userProfileModel,
            as: 'userProfile',
          },
        ],
        transaction,
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Check if family exists (do not rely on existing members)
      const family = await this.familyModel.findOne({
        where: { familyCode, status: 1 },
        transaction,
      });

      if (!family) {
        throw new NotFoundException('Family not found');
      }

      // If user is already in this family, stop
      const existingMemberSameFamily = await this.familyMemberModel.findOne({
        where: {
          memberId: userId,
          familyCode,
        },
        transaction,
      });

      if (existingMemberSameFamily) {
        throw new BadRequestException('User is already a member of this family');
      }

      // Ensure profile points to this family so the app can load the correct tree by default
      const profile = user.userProfile || (await this.userProfileModel.findOne({ where: { userId }, transaction }));
      if (profile) {
        const prevFamilyCode = profile.familyCode;
        const associated = Array.isArray(profile.associatedFamilyCodes) ? profile.associatedFamilyCodes : [];
        const nextAssociated =
          prevFamilyCode && prevFamilyCode !== familyCode && !associated.includes(prevFamilyCode)
            ? [...associated, prevFamilyCode]
            : associated;

        await profile.update(
          {
            familyCode,
            associatedFamilyCodes: nextAssociated,
          } as any,
          { transaction },
        );
      }

      // Keep a single active membership row per user (consistent with requestToJoinFamily logic)
      const existingAnyMembership = await this.familyMemberModel.findOne({
        where: { memberId: userId },
        transaction,
      });

      let membership: any;
      if (existingAnyMembership) {
        await existingAnyMembership.update(
          {
            familyCode,
            approveStatus: 'approved',
            creatorId: addedBy,
          },
          { transaction },
        );
        membership = existingAnyMembership;

        // Remove any other stale memberships for this user
        await this.familyMemberModel.destroy({
          where: {
            memberId: userId,
            familyCode: { [Op.ne]: familyCode },
          },
          transaction,
        });
      } else {
        membership = await this.familyMemberModel.create(
          {
            memberId: userId,
            familyCode,
            approveStatus: 'approved',
            creatorId: addedBy,
          },
          { transaction },
        );
      }

      await transaction.commit();

      return {
        message: 'User added to family successfully',
        data: {
          memberId: membership.memberId,
          userId,
          familyCode,
          approveStatus: membership.approveStatus,
        },
      };
    } catch (error) {
      await transaction.rollback();
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      console.error('Error adding user to family:', error);
      throw new BadRequestException('Failed to add user to family');
    }
  }
  
}
