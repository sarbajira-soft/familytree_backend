import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op, QueryTypes } from 'sequelize';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Family } from './model/family.model';
import { FamilyMember } from './model/family-member.model';
import { FamilyTree } from './model/family-tree.model';
import { Gallery } from '../gallery/model/gallery.model';
import { Post } from '../post/model/post.model';
import { Event } from '../event/model/event.model';
import { MailService } from '../utils/mail.service';
import { NotificationService } from '../notification/notification.service';
import { UploadService } from '../uploads/upload.service';
import * as bcrypt from 'bcrypt';
import { BlockingService } from '../blocking/blocking.service';
import { repairFamilyTreeIntegrity } from './tree-integrity';
 
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { CreateUserAndJoinFamilyDto } from './dto/create-user-and-join-family.dto';
import { ContentVisibilityService } from '../user/content-visibility.service';
import {
  buildEmailHash,
  buildMobileHash,
  normalizeEmailValue,
  normalizeMobileValue,
} from '../common/security/field-encryption.util';
import { applyPrivacyToNestedUser } from '../user/privacy.util';

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

    @InjectModel(Gallery)
    private readonly galleryModel: typeof Gallery,

    @InjectModel(Post)
    private readonly postModel: typeof Post,

    @InjectModel(Event)
    private readonly eventModel: typeof Event,

    private readonly mailService: MailService,

    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,

    private readonly uploadService: UploadService,

    private readonly blockingService: BlockingService,
    private readonly contentVisibilityService: ContentVisibilityService,

    private readonly sequelize: Sequelize,
  ) {}


  private buildEmailLookupOptions(email: string) {
    const normalizedEmail = normalizeEmailValue(email);
    if (!normalizedEmail) {
      return [];
    }

    return [
      { emailHash: buildEmailHash(normalizedEmail) },
      { email: { [Op.iLike]: normalizedEmail } },
    ];
  }

  private buildMobileLookupOptions(mobile: string) {
    const normalizedMobile = normalizeMobileValue(mobile);
    if (!normalizedMobile) {
      return [];
    }

    return [
      { mobileHash: buildMobileHash(normalizedMobile) },
      { mobile: normalizedMobile },
    ];
  }

  private applyFamilyVisibility(user: any) {
    return applyPrivacyToNestedUser(user, 'family');
  }

  private applyPublicVisibility(user: any) {
    return applyPrivacyToNestedUser(user, 'other');
  }
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
    allowSelfRemoval = false,
    allowOwnerRemoval = false,
  ) {
    if (!allowSelfRemoval && Number(memberId) === Number(actingUserId)) {
      throw new BadRequestException('You cannot delete your own account');
    }

    if (!allowOwnerRemoval && Number(memberId) === Number((family as any).createdBy)) {
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

  private async cleanupRemovedMemberProfile(
    memberId: number,
    familyCode: string,
    transaction?: any,
  ) {
    const removedUserProfile = await this.userProfileModel.findOne({
      where: { userId: memberId },
      transaction,
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
      } as any, { transaction });
    }
  }

  private async createDummyUserFromMember(params: {
    memberId: number;
    familyCode: string;
    actingUserId: number;
    transaction: any;
  }) {
    const { memberId, familyCode, actingUserId, transaction } = params;

    const sourceProfile = await this.userProfileModel.findOne({
      where: { userId: memberId },
      attributes: ['firstName', 'lastName', 'gender', 'age', 'profile'],
      transaction,
    });

    const dummyUser = await this.userModel.create(
      {
        email: null,
        countryCode: null,
        mobile: null,
        password: null,
        status: 1,
        role: 1,
        isAppUser: false,
        hasAcceptedTerms: false,
        createdBy: actingUserId || 0,
        lifecycleState: 'active',
      } as any,
      { transaction },
    );

    await this.userProfileModel.create(
      {
        userId: dummyUser.id,
        firstName: sourceProfile?.firstName || 'Familyss',
        lastName: sourceProfile?.lastName || 'User',
        gender: sourceProfile?.gender || null,
        age: sourceProfile?.age || null,
        profile: sourceProfile?.profile || null,
        familyCode: null,
        associatedFamilyCodes: [],
      } as any,
      { transaction },
    );

    return dummyUser;
  }

  private async convertExistingUserToDummy(memberUser: User, transaction?: any) {
    if (!memberUser) return;

    if (!memberUser.isAppUser && Number(memberUser.role) === 1) {
      return;
    }

    await memberUser.update(
      {
        isAppUser: false,
        role: 1,
      } as any,
      { transaction },
    );
  }

  private async hideFamilyContentForRemovedMember(
    memberId: number,
    familyCode: string,
    transaction?: any,
  ) {
    await this.contentVisibilityService.hideFamilyContentForRemovedMember(
      memberId,
      familyCode,
      'member_removed',
      transaction,
    );
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

  private async applyParentNameMatches(
    profile: UserProfile,
    normalizeName: (v: any) => string,
    familyMatchMap: Record<string, { names: Set<string>; scores: Map<string, number> }>,
  ) {
    const fatherNorm = normalizeName((profile as any).fatherName);
    const motherNorm = normalizeName((profile as any).motherName);
    if (!fatherNorm || !motherNorm) {
      return;
    }

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
          { [Op.or]: this.buildEmailLookupOptions(dto.email) },
          { [Op.or]: this.buildMobileLookupOptions(dto.mobile) },
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
        isAppUser: true,
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

    await this.contentVisibilityService.reconcileRecoveredFamilyContent(user.id, dto.familyCode, transaction);
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
    const memberId = Number(createdBy || dto.memberId);
    const familyCode = String(dto.familyCode || '').trim().toUpperCase();

    if (!memberId) {
      throw new BadRequestException('Member ID is required');
    }

    const family = await this.familyModel.findOne({
      where: {
        familyCode,
        status: 1,
      },
    });

    if (!family) {
      throw new BadRequestException('Invalid family code. Family not found or inactive.');
    }

    const transaction = await this.sequelize.transaction();
    let membership: any = null;
    let replacedPreviousRequest = false;
    let alreadyPending = false;

    try {
      const user = await this.userModel.findByPk(memberId, {
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const profile = await this.userProfileModel.findOne({
        where: { userId: memberId },
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });

      const memberships = await this.familyMemberModel.findAll({
        where: { memberId } as any,
        order: [['id', 'DESC']],
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });

      const approvedMembership = memberships.find(
        (row: any) => String(row.approveStatus || '') === 'approved',
      );

      if (approvedMembership) {
        const approvedFamilyCode = String((approvedMembership as any).familyCode || '').trim().toUpperCase();
        if (approvedFamilyCode === familyCode) {
          throw new BadRequestException('User is already a member of this family');
        }

        throw new BadRequestException('Leave your current family before requesting to join another one');
      }

      const sameFamilyMembership = memberships.find(
        (row: any) => String((row as any).familyCode || '').trim().toUpperCase() == familyCode,
      );
      const pendingMemberships = memberships.filter(
        (row: any) => String((row as any).approveStatus || '') === 'pending',
      );
      const sameFamilyPending = pendingMemberships.find(
        (row: any) => String((row as any).familyCode || '').trim().toUpperCase() === familyCode,
      );

      if (sameFamilyPending) {
        membership = sameFamilyPending;
        alreadyPending = true;
      } else {
        const otherPendingIds = pendingMemberships
          .filter((row: any) => String((row as any).familyCode || '').trim().toUpperCase() !== familyCode)
          .map((row: any) => Number(row.id))
          .filter((id: number) => Number.isFinite(id));

        if (otherPendingIds.length > 0) {
          replacedPreviousRequest = true;
          await this.familyMemberModel.update(
            {
              approveStatus: 'cancelled',
              removedAt: new Date(),
              removedBy: memberId,
            } as any,
            {
              where: { id: otherPendingIds } as any,
              transaction,
            },
          );
        }

        if (sameFamilyMembership) {
          await (sameFamilyMembership as any).update(
            {
              familyCode,
              creatorId: dto.creatorId || memberId,
              approveStatus: 'pending',
              removedAt: null,
              removedBy: null,
            } as any,
            { transaction },
          );
          membership = sameFamilyMembership;
        } else {
          membership = await this.familyMemberModel.create(
            {
              memberId,
              familyCode,
              creatorId: dto.creatorId || memberId,
              approveStatus: 'pending',
            } as any,
            { transaction },
          );
        }
      }

      if (profile) {
        await profile.update(
          { familyCode } as any,
          { transaction },
        );
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    await this.notificationService.setFamilyJoinRequestNotificationsStatusForUser(
      memberId,
      'expired',
      { excludeFamilyCode: familyCode },
    );

    const adminUserIds = await this.notificationService.getAdminsForFamily(familyCode);
    if (!alreadyPending && adminUserIds.length > 0) {
      const user = await this.userProfileModel.findOne({ where: { userId: memberId } });
      const requesterName = user
        ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'A user'
        : 'A user';

      await this.notificationService.createNotification(
        {
          type: 'FAMILY_JOIN_REQUEST',
          title: replacedPreviousRequest ? 'Family Join Request Replaced' : 'Family Join Request',
          message: replacedPreviousRequest
            ? `${requesterName} replaced their previous family request and wants to join your family.`
            : `${requesterName} requested to join your family.`,
          familyCode,
          referenceId: memberId,
          data: {
            requesterId: memberId,
            requesterName,
            requestedFamilyCode: familyCode,
            state: 'PENDING',
            replacedPreviousRequest,
          },
          userIds: adminUserIds,
        } as any,
        memberId,
      );
    }

    return {
      message: alreadyPending
        ? 'Family join request is already pending for this family'
        : replacedPreviousRequest
          ? 'Previous pending request cancelled and new family join request submitted successfully'
          : 'Family join request submitted successfully',
      data: {
        ...(membership?.toJSON ? membership.toJSON() : membership),
        requestState: 'PENDING',
        replacedPreviousRequest,
        alreadyPending,
      },
    };
  }

  // Approve family member request
  async approveFamilyMember(memberId: number, familyCode: string, actingUserId: number) {
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    const family = await this.familyModel.findOne({ where: { familyCode: normalizedFamilyCode } });
    if (!family) {
      throw new NotFoundException('Family not found');
    }

    const isOwner = Number((family as any).createdBy) === Number(actingUserId);
    const isAdmin = await this.isAdminOfFamily(actingUserId, normalizedFamilyCode);
    if (!isOwner && !isAdmin) {
      throw new BadRequestException('Access denied: Only family admins can approve members');
    }

    const transaction = await this.sequelize.transaction();
    let membership: any;
    try {
      membership = await this.familyMemberModel.findOne({
        where: { memberId, familyCode: normalizedFamilyCode, approveStatus: 'pending' } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });
      if (!membership) {
        throw new NotFoundException('Pending family member request not found');
      }

      await membership.update(
        {
          approveStatus: 'approved',
          removedAt: null,
          removedBy: null,
        } as any,
        { transaction },
      );

      await this.familyMemberModel.update(
        {
          approveStatus: 'cancelled',
          removedAt: new Date(),
          removedBy: actingUserId,
        } as any,
        {
          where: {
            memberId,
            approveStatus: 'pending',
            familyCode: { [Op.ne]: normalizedFamilyCode },
          } as any,
          transaction,
        },
      );

      const profile = await this.userProfileModel.findOne({
        where: { userId: memberId },
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });
      if (profile) {
        await profile.update({ familyCode: normalizedFamilyCode } as any, { transaction });
      }

      await this.contentVisibilityService.reconcileRecoveredFamilyContent(memberId, normalizedFamilyCode, transaction);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    await this.notificationService.setFamilyJoinRequestNotificationsStatusForUser(
      memberId,
      'accepted',
      { familyCode: normalizedFamilyCode },
    );
    await this.notificationService.setFamilyJoinRequestNotificationsStatusForUser(
      memberId,
      'expired',
      { excludeFamilyCode: normalizedFamilyCode },
    );

    await this.notificationService.createNotification(
      {
        type: 'FAMILY_MEMBER_APPROVED',
        title: 'Welcome to the Family!',
        message: `Your request to join the family (${normalizedFamilyCode}) has been approved. Welcome!`,
        familyCode: normalizedFamilyCode,
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
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    const family = await this.familyModel.findOne({ where: { familyCode: normalizedFamilyCode } });
    if (!family) {
      throw new NotFoundException('Family not found');
    }

    const isOwner = Number((family as any).createdBy) === Number(rejectorId);
    const isAdmin = await this.isAdminOfFamily(rejectorId, normalizedFamilyCode);
    if (!isOwner && !isAdmin) {
      throw new BadRequestException('Access denied: Only family admins can reject members');
    }

    const transaction = await this.sequelize.transaction();
    let membership: any;
    try {
      membership = await this.familyMemberModel.findOne({
        where: { memberId, familyCode: normalizedFamilyCode, approveStatus: 'pending' } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });
      if (!membership) {
        throw new NotFoundException('Pending family member request not found');
      }

      await membership.update(
        {
          approveStatus: 'rejected',
          removedAt: new Date(),
          removedBy: rejectorId,
        } as any,
        { transaction },
      );

      const hasApprovedMembership = await this.familyMemberModel.findOne({
        where: { memberId, approveStatus: 'approved' } as any,
        transaction,
      });
      const profile = await this.userProfileModel.findOne({
        where: { userId: memberId },
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });
      if (
        profile &&
        !hasApprovedMembership &&
        String(profile.familyCode || '').trim().toUpperCase() === normalizedFamilyCode
      ) {
        await profile.update({ familyCode: null } as any, { transaction });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    await this.notificationService.setFamilyJoinRequestNotificationsStatusForUser(
      memberId,
      'rejected',
      { familyCode: normalizedFamilyCode },
    );

    const userProfile = await this.userProfileModel.findOne({ where: { userId: memberId } });
    const userName = userProfile
      ? `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim()
      : 'User';

    await this.notificationService.createNotification(
      {
        type: 'FAMILY_JOIN_REJECTED',
        title: 'Family Join Request Rejected',
        message: `Your request to join the family (${normalizedFamilyCode}) has been rejected.`,
        familyCode: normalizedFamilyCode,
        referenceId: memberId,
        userIds: [memberId],
      },
      null,
    );

    return { message: `Family member ${userName} rejected successfully` };
  }

  async cancelPendingJoinRequest(familyCode: string, actingUserId: number) {
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    const transaction = await this.sequelize.transaction();
    let membership: any;
    let cancelledFamilyCode = normalizedFamilyCode;

    try {
      membership = await this.familyMemberModel.findOne({
        where: {
          memberId: actingUserId,
          familyCode: normalizedFamilyCode,
          approveStatus: 'pending',
        } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });

      if (!membership) {
        membership = await this.familyMemberModel.findOne({
          where: {
            memberId: actingUserId,
            approveStatus: 'pending',
          } as any,
          transaction,
          lock: (transaction as any).LOCK.UPDATE,
          order: [['updatedAt', 'DESC'], ['id', 'DESC']],
        });
      }

      if (!membership) {
        throw new NotFoundException('Pending family join request not found');
      }

      cancelledFamilyCode = String(membership.familyCode || '').trim().toUpperCase();

      await membership.update(
        {
          approveStatus: 'cancelled',
          removedAt: new Date(),
          removedBy: actingUserId,
        } as any,
        { transaction },
      );

      const hasApprovedMembership = await this.familyMemberModel.findOne({
        where: { memberId: actingUserId, approveStatus: 'approved' } as any,
        transaction,
      });
      const profile = await this.userProfileModel.findOne({
        where: { userId: actingUserId },
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });
      if (
        profile &&
        !hasApprovedMembership &&
        String(profile.familyCode || '').trim().toUpperCase() === cancelledFamilyCode
      ) {
        await profile.update({ familyCode: null } as any, { transaction });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    await this.notificationService.setFamilyJoinRequestNotificationsStatusForUser(
      actingUserId,
      'expired',
      { familyCode: cancelledFamilyCode },
    );

    return {
      message: 'Pending family join request cancelled successfully',
      data: {
        ...(membership?.toJSON ? membership.toJSON() : membership),
        requestState: 'CANCELLED',
        familyCode: cancelledFamilyCode,
      },
    };
  }

  private async removeMemberFromFamilyCore(params: {
    memberId: number;
    familyCode: string;
    actingUserId: number;
    allowSelfRemoval: boolean;
    skipAdminGuard?: boolean;
  }) {
    const memberId = Number(params.memberId);
    const actingUserId = Number(params.actingUserId);
    const familyCode = String(params.familyCode || '').trim();

    if (!actingUserId) {
      throw new BadRequestException('Access denied');
    }
    if (!familyCode) {
      throw new BadRequestException('familyCode is required');
    }

    const family = await this.requireFamilyOrThrow(familyCode);
    this.validateRemovalPermissions(
      memberId,
      actingUserId,
      family,
      params.allowSelfRemoval,
      Boolean(params.skipAdminGuard),
    );

    const isSelfRemoval = Number(memberId) === Number(actingUserId);
    if (!params.skipAdminGuard && !isSelfRemoval) {
      await this.requireAdminMembership(actingUserId, familyCode);
    }

    if (!params.skipAdminGuard && isSelfRemoval) {
      const selfMembership = await this.familyMemberModel.findOne({
        where: {
          memberId,
          familyCode,
          approveStatus: 'approved',
        },
      });
      if (!selfMembership) {
        throw new BadRequestException('You are not an active member of this family');
      }
    }

    const transaction = await this.sequelize.transaction();
    try {
      console.log('[DEBUG] Step 1: Finding member user (no lock)...');
      const memberUser = await this.userModel.findByPk(memberId, {
        transaction,
      });
      console.log('[DEBUG] memberUser found:', memberUser?.id);
      
      // Validate transaction is still active
      try {
        await this.sequelize.query('SELECT 1', { transaction });
        console.log('[DEBUG] Transaction valid after Step 1');
      } catch (txErr) {
        console.error('[DEBUG] Transaction FAILED after Step 1:', txErr.message);
        throw txErr;
      }

      console.log('[DEBUG] Step 2: Finding membership (no lock)...');
      let membership;
      try {
        membership = await this.familyMemberModel.findOne({
          where: { memberId, familyCode },
          transaction,
        });
        console.log('[DEBUG] membership found:', membership?.id, 'status:', (membership as any)?.approveStatus);
      } catch (e) {
        console.error('[DEBUG] Error finding membership:', e.message, e.stack);
        throw e;
      }
      
      // Validate transaction is still active
      try {
        await this.sequelize.query('SELECT 1', { transaction });
        console.log('[DEBUG] Transaction valid after Step 2');
      } catch (txErr) {
        console.error('[DEBUG] Transaction FAILED after Step 2:', txErr.message);
        throw txErr;
      }

      console.log('[DEBUG] Step 3: Finding tree entries...');
      let treeEntries;
      try {
        treeEntries = await this.familyTreeModel.findAll({
          where: { familyCode, userId: memberId },
          transaction,
        });
        console.log('[DEBUG] treeEntries found:', treeEntries.length);
      } catch (e) {
        console.error('[DEBUG] Error finding tree entries:', e.message, e.stack);
        throw e;
      }
      
      // Validate transaction is still active
      try {
        await this.sequelize.query('SELECT 1', { transaction });
        console.log('[DEBUG] Transaction valid after Step 3');
      } catch (txErr) {
        console.error('[DEBUG] Transaction FAILED after Step 3:', txErr.message);
        throw txErr;
      }
      
      console.log('[DEBUG] Step 3a: Checking early return conditions...');
      console.log('[DEBUG] - membership exists:', !!membership);
      console.log('[DEBUG] - treeEntries.length:', treeEntries.length);
      console.log('[DEBUG] - approveStatus:', (membership as any)?.approveStatus);

      if (!membership && treeEntries.length === 0) {
        await transaction.commit();
        return {
          message: 'Family member already removed',
          alreadyProcessed: true,
          dummyUserId: null,
        };
      }

      if (
        membership &&
        String((membership as any).approveStatus || '') !== 'approved' &&
        treeEntries.length === 0
      ) {
        await transaction.commit();
        return {
          message: 'Family member already removed',
          alreadyProcessed: true,
          dummyUserId: null,
        };
      }

      if (
        membership &&
        String((membership as any).approveStatus || '') !== 'approved' &&
        treeEntries.length > 0 &&
        !params.skipAdminGuard &&
        memberUser &&
        !memberUser.isAppUser
      ) {
        await transaction.commit();
        return {
          message: 'Family member already removed',
          alreadyProcessed: true,
          dummyUserId: Number(memberUser.id),
        };
      }

      const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
      const memberPrimaryFamilyCode = String((await this.userProfileModel.findOne({ where: { userId: memberId }, transaction }))?.familyCode || '').trim().toUpperCase();
      const isPrimaryMemberOfFamily = Boolean(memberPrimaryFamilyCode && memberPrimaryFamilyCode === normalizedFamilyCode);
      const hasTreeEntries = treeEntries.length > 0;
      const isDummyUser = memberUser ? !memberUser.isAppUser : false;

      if (!params.skipAdminGuard && !isSelfRemoval && hasTreeEntries && isPrimaryMemberOfFamily && memberUser?.isAppUser) {
        await this.familyTreeModel.destroy({
          where: { familyCode, userId: memberId } as any,
          transaction,
        });

        await repairFamilyTreeIntegrity({
          familyCode,
          transaction,
          lock: true,
          fixExternalGenerations: true,
        });

        await transaction.commit();

        this.notificationService.emitFamilyEvent(familyCode, {
          type: 'MEMBER_MOVED_TO_NOT_IN_TREE',
          memberId,
          removedBy: actingUserId,
        });

        return {
          message: 'Member moved to Members Not in Tree successfully',
          alreadyProcessed: false,
          dummyUserId: null,
          action: 'moved_to_members_not_in_tree',
        };
      }

      if (membership) {
        await this.familyMemberModel.update(
          {
            approveStatus: 'removed',
            removedAt: new Date(),
            removedBy: actingUserId,
          } as any,
          { where: { id: membership.id }, transaction },
        );
      }

      await this.cleanupRemovedMemberProfile(memberId, familyCode, transaction);
      await this.hideFamilyContentForRemovedMember(memberId, familyCode, transaction);

      let dummyUserId: number = null;
      let action = 'removed_from_family';
      if (hasTreeEntries) {
        if (params.skipAdminGuard) {
          const dummyUser = await this.createDummyUserFromMember({
            memberId,
            familyCode,
            actingUserId,
            transaction,
          });
          dummyUserId = dummyUser.id;
          action = 'account_deleted_dummy_created';

          await this.familyTreeModel.update(
            { userId: dummyUser.id } as any,
            {
              where: {
                familyCode,
                userId: memberId,
              } as any,
              transaction,
            },
          );
        } else if (isDummyUser) {
          await this.familyTreeModel.destroy({
            where: { familyCode, userId: memberId } as any,
            transaction,
          });
          action = 'deleted_non_app_user';
        } else {
          await this.convertExistingUserToDummy(memberUser, transaction);
          dummyUserId = Number(memberId);
          action = 'converted_to_dummy';
        }
      }

      await repairFamilyTreeIntegrity({
        familyCode,
        transaction,
        lock: true,
        fixExternalGenerations: true,
      });

      await transaction.commit();

      this.notificationService.emitFamilyEvent(familyCode, {
        type: 'MEMBER_REMOVED',
        memberId,
        dummyUserId,
        isSelfRemoval,
        removedBy: actingUserId,
        action,
      });

      if (!params.skipAdminGuard && !isSelfRemoval) {
        await this.notifyMemberRemoval(memberId, familyCode);
      }

      return {
        message: action === 'converted_to_dummy'
          ? 'Member removed from family and converted to a Non-App user'
          : action === 'deleted_non_app_user'
            ? 'Non-App user removed successfully'
            : 'Family member removed successfully',
        alreadyProcessed: false,
        dummyUserId,
        action,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  // Delete family member from family (admin action or self-removal on same endpoint)
  async deleteFamilyMember(memberId: number, familyCode: string, actingUserId?: number) {
    return this.removeMemberFromFamilyCore({
      memberId,
      familyCode,
      actingUserId,
      allowSelfRemoval: true,
    });
  }

  async selfRemoveFromFamily(familyCode: string, actingUserId: number) {
    return this.removeMemberFromFamilyCore({
      memberId: actingUserId,
      familyCode,
      actingUserId,
      allowSelfRemoval: true,
    });
  }

  async removeMemberForAccountDeletion(memberId: number, familyCode: string) {
    return this.removeMemberFromFamilyCore({
      memberId,
      familyCode,
      actingUserId: memberId,
      allowSelfRemoval: true,
      skipAdminGuard: true,
    });
  }

  async getNonAppUsersByFamily(familyCode: string, actingUserId: number) {
    await this.requireAdminMembership(actingUserId, familyCode);

    const rows = await this.familyTreeModel.findAll({
      where: { familyCode } as any,
      include: [
        {
          model: this.userModel,
          as: 'user',
          required: true,
          where: { isAppUser: false } as any,
          attributes: ['id', 'status', 'isAppUser'],
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
              attributes: ['firstName', 'lastName', 'gender', 'profile'],
            },
          ],
        },
      ],
      order: [['generation', 'ASC'], ['personId', 'ASC']],
    });

    const unique = new Map<number, any>();
    for (const row of rows as any[]) {
      const uid = Number(row?.userId);
      if (!Number.isFinite(uid) || unique.has(uid)) continue;
      unique.set(uid, {
        dummyUserId: uid,
        personId: row.personId,
        nodeUid: row.nodeUid,
        generation: row.generation,
        familyCode: row.familyCode,
        name: `${row?.user?.userProfile?.firstName || ''} ${row?.user?.userProfile?.lastName || ''}`.trim() || 'Familyss User',
        gender: row?.user?.userProfile?.gender || null,
        profile: row?.user?.userProfile?.profile || null,
      });
    }

    return {
      message: 'Non-app users fetched successfully',
      data: Array.from(unique.values()),
    };
  }

  async replaceDummyWithMember(
    familyCode: string,
    dummyUserId: number,
    replacementUserId: number,
    actingUserId: number,
  ) {
    await this.requireAdminMembership(actingUserId, familyCode);

    if (Number(dummyUserId) === Number(replacementUserId)) {
      throw new BadRequestException('Replacement user must be different from dummy user');
    }

    const transaction = await this.sequelize.transaction();
    try {
      const dummyUser = await this.userModel.findByPk(dummyUserId, {
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });
      if (!dummyUser || dummyUser.isAppUser) {
        throw new BadRequestException('Invalid dummy user');
      }

      const replacementMembership = await this.familyMemberModel.findOne({
        where: {
          memberId: replacementUserId,
          familyCode,
          approveStatus: 'approved',
        } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });
      if (!replacementMembership) {
        throw new BadRequestException('Replacement member is not active in this family');
      }

      const replacementUser = await this.userModel.findByPk(replacementUserId, {
        transaction,
      });
      if (!replacementUser || !replacementUser.isAppUser) {
        throw new BadRequestException('Replacement must be an app user');
      }

      const existingTargetRows = await this.familyTreeModel.count({
        where: { familyCode, userId: replacementUserId } as any,
        transaction,
      });
      if (existingTargetRows > 0) {
        throw new BadRequestException('Replacement user already exists in this family tree');
      }

      const [updatedCount] = await this.familyTreeModel.update(
        { userId: replacementUserId } as any,
        {
          where: { familyCode, userId: dummyUserId } as any,
          transaction,
        },
      );

      if (!Number(updatedCount)) {
        throw new NotFoundException('Dummy user not found in this family tree');
      }

      const isSyntheticDummy =
        !dummyUser.email &&
        !dummyUser.mobile &&
        !dummyUser.password;
      if (isSyntheticDummy) {
        await dummyUser.update({ status: 2 } as any, { transaction });
      }

      await repairFamilyTreeIntegrity({
        familyCode,
        transaction,
        lock: true,
        fixExternalGenerations: true,
      });

      await transaction.commit();

      // NEW: Emit WebSocket event for real-time synchronization
      this.notificationService.emitFamilyEvent(familyCode, {
        type: 'DUMMY_USER_REPLACED',
        dummyUserId,
        replacementUserId,
        replacedBy: actingUserId,
        updatedNodes: Number(updatedCount),
      });

      return {
        message: 'Dummy user replaced successfully',
        data: {
          familyCode,
          dummyUserId,
          replacementUserId,
          updatedNodes: Number(updatedCount),
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  // BLOCK OVERRIDE: Removed legacy family-member block/unblock write flow in favor of user-level ft_user_block.

  // Get all approved family members by family code
  async getAllFamilyMembers(familyCode: string, requestingUserId?: number) {
    // BLOCK OVERRIDE: Removed legacy family-member block gate; access now relies on user-level block checks.

    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    // Get all users whose primary family is this familyCode OR who are approved members
    const members = await this.familyMemberModel.findAll({
      where: {
        familyCode,
        // Exclude removed members
        approveStatus: {
          [Op.ne]: 'removed'
        },
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
          attributes: ['id', 'email', 'mobile', 'countryCode', 'status', 'role', 'isAppUser'],
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
              attributes: ['firstName', 'lastName', 'profile', 'dob', 'gender', 'address', 'familyCode', 'contactNumber', 'emailPrivacy', 'addressPrivacy', 'phonePrivacy'],
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

      // Get block status for this member relative to requesting user
      let blockStatus = { isBlockedByMe: false, isBlockedByThem: false };
      if (requestingUserId && user?.id && requestingUserId !== user.id) {
        try {
          blockStatus = await this.blockingService.getBlockStatus(requestingUserId, user.id);
        } catch (e) {
          // Non-blocking: if block check fails, assume not blocked
        }
      }

      return {
        ...member,
        blockStatus,
        user: this.applyFamilyVisibility({
          ...user,
          fullName: user?.userProfile
            ? `${user.userProfile.firstName} ${user.userProfile.lastName}`.trim()
            : null,
          profileImage,
        }),
        membershipType: (() => {
          const userPrimaryFamily = String(user?.userProfile?.familyCode || '').trim().toUpperCase();
          return userPrimaryFamily === normalizedFamilyCode ? 'member' : 'associated';
        })(),
        familyRole: (() => {
          const isFamilyAdmin =
            user?.role >= 2 &&
            String(user?.userProfile?.familyCode || '').trim().toUpperCase() === normalizedFamilyCode;

          if (!isFamilyAdmin) {
            return 'Member';
          }
          return user.role === 3 ? 'Superadmin' : 'Admin';
        })(),
        isFamilyAdmin:
          user?.role >= 2 &&
          String(user?.userProfile?.familyCode || '').trim().toUpperCase() === normalizedFamilyCode,
      };
    }));

    // Include cross-family linked users (e.g. spouse associations) that have this familyCode
    // in their associatedFamilyCodes, even if they are not ft_family_members for this family.
    // Exclude users already in baseResult to prevent duplicates.
    const baseUserIds = new Set<number>(
      baseResult
        .map((m: any) => Number(m?.user?.id))
        .filter((id: any) => Number.isFinite(id) && id > 0),
    );

    const associatedRows = await this.sequelize.query(
      `
        SELECT "userId"
        FROM public.ft_user_profile
        WHERE "associatedFamilyCodes"::jsonb @> :needle::jsonb
          AND COALESCE(UPPER(TRIM("familyCode")), '') <> :familyCode
      `,
      {
        replacements: {
          needle: JSON.stringify([normalizedFamilyCode]),
          familyCode: normalizedFamilyCode,
        },
        type: QueryTypes.SELECT,
      },
    );
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
        attributes: ['id', 'email', 'mobile', 'countryCode', 'status', 'role', 'isAppUser'],
        include: [
          {
            model: this.userProfileModel,
            as: 'userProfile',
            attributes: ['firstName', 'lastName', 'profile', 'dob', 'gender', 'address', 'familyCode', 'contactNumber', 'emailPrivacy', 'addressPrivacy', 'phonePrivacy'],
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

          // Get block status for this member relative to requesting user
          let blockStatus = { isBlockedByMe: false, isBlockedByThem: false };
          if (requestingUserId && u?.id && requestingUserId !== u.id) {
            try {
              blockStatus = await this.blockingService.getBlockStatus(requestingUserId, u.id);
            } catch (e) {
              // Non-blocking: if block check fails, assume not blocked
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
            createdAt: null,
            updatedAt: null,
            user: this.applyFamilyVisibility({
              ...u.toJSON(),
              fullName: u?.userProfile
                ? `${u.userProfile.firstName || ''} ${u.userProfile.lastName || ''}`.trim()
                : null,
              profileImage,
            }),
            blockStatus,
            membershipType: 'associated',
            familyRole: 'Member',
            isFamilyAdmin: false,
          };
        }),
      );
    }

    // Include linked-family members (tree link connections) in All Members list.
    let linkedResult: any[] = [];
    try {
      const linkedRows = await this.sequelize.query(
        `
          SELECT
            CASE
              WHEN "familyCodeLow" = :code THEN "familyCodeHigh"
              ELSE "familyCodeLow"
            END AS "linkedCode"
          FROM public.ft_family_link
          WHERE "status" = 'active'
            AND (source = 'tree' OR source IS NULL)
            AND (:code = "familyCodeLow" OR :code = "familyCodeHigh")
        `,
        {
          replacements: { code: normalizedFamilyCode },
          type: QueryTypes.SELECT,
        },
      );

      const linkedCodes = Array.from(
        new Set(
          (linkedRows || [])
            .map((r) => String((r as any)?.linkedCode || '').trim())
            .filter(Boolean),
        ),
      );

      if (linkedCodes.length > 0) {
        const existingIds = new Set<number>([...baseUserIds, ...associatedUserIds]);
        const linkedUsers = await this.userModel.findAll({
          where: { '$userProfile.familyCode$': { [Op.in]: linkedCodes } } as any,
          attributes: ['id', 'email', 'mobile', 'countryCode', 'status', 'role', 'isAppUser'],
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
              attributes: ['firstName', 'lastName', 'profile', 'dob', 'gender', 'address', 'familyCode', 'contactNumber', 'emailPrivacy', 'addressPrivacy', 'phonePrivacy'],
            },
          ],
          order: [['id', 'DESC']],
        });

        linkedResult = await Promise.all(
          (linkedUsers as any[])
            .filter((u: any) => !existingIds.has(Number(u?.id)))
            .map(async (u: any) => {
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

              // Get block status for this member relative to requesting user
              let blockStatus = { isBlockedByMe: false, isBlockedByThem: false };
              if (requestingUserId && u?.id && requestingUserId !== u.id) {
                try {
                  blockStatus = await this.blockingService.getBlockStatus(requestingUserId, u.id);
                } catch (e) {
                  // Non-blocking: if block check fails, assume not blocked
                }
              }

              return {
                id: -Number(u.id) * 10,
                memberId: null,
                familyCode,
                creatorId: null,
                approveStatus: 'linked',
                isLinkedUsed: false,
                createdAt: null,
                updatedAt: null,
                user: this.applyFamilyVisibility({
                  ...u.toJSON(),
                  fullName: u?.userProfile
                    ? `${u.userProfile.firstName || ''} ${u.userProfile.lastName || ''}`.trim()
                    : null,
                  profileImage,
                }),
                blockStatus,
                membershipType: 'linked',
                familyRole: 'Member',
                isFamilyAdmin: false,
              };
            }),
        );
      }
    } catch (err) {
      // Non-blocking: if linked-family query fails, still return base members.
      console.error('Error loading linked family members:', err);
    }

    const result = [...baseResult, ...associatedResult, ...linkedResult];

    return {
      message: `${result.length} approved family members found.`,
      data: result,
    };

  }

  async getUserIdsInFamily(familyCode: string): Promise<number[]> {
    const members = await this.familyMemberModel.findAll({
      where: {
        familyCode,
        approveStatus: {
          [Op.ne]: 'removed'
        },
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
        approveStatus: {
          [Op.ne]: 'removed'
        },
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
          attributes: ['id', 'email', 'mobile', 'countryCode', 'status', 'role', 'isAppUser'],
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
              attributes: ['firstName', 'lastName', 'profile', 'dob', 'gender', 'address', 'contactNumber', 'emailPrivacy', 'addressPrivacy', 'phonePrivacy'],
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
        user: this.applyFamilyVisibility({
          ...user,
          fullName: user?.userProfile
            ? `${user.userProfile.firstName || ''} ${user.userProfile.lastName || ''}`.trim()
            : null,
          profileImage,
        }),
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
        .replaceAll(/\s+/g, ' ')
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
    await this.applyParentNameMatches(profile, normalizeName, familyMatchMap);

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
          user: memberData.user ? this.applyPublicVisibility({
            id: memberData.user.id,
            email: memberData.user.email,
            mobile: memberData.user.mobile,
            countryCode: memberData.user.countryCode,
            userProfile: memberData.user.userProfile,
          }) : null
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
      // But allow if the existing membership is pending (treat as approval)
      const existingMemberSameFamily = await this.familyMemberModel.findOne({
        where: {
          memberId: userId,
          familyCode,
        },
        transaction,
      });

      // Delete pending requests by this user to OTHER families (preserve same-family pending for update)
      await this.familyMemberModel.destroy({
        where: {
          memberId: userId,
          approveStatus: 'pending',
          familyCode: { [Op.ne]: familyCode },
        } as any,
        transaction,
      });

      // NEW: Also delete pending requests where deleted user is the admin/approver (creatorId)
      await this.familyMemberModel.destroy({
        where: {
          creatorId: userId,
          approveStatus: 'pending',
        } as any,
        transaction,
      });

      // If user is already an APPROVED member, block. If pending/rejected, allow (will update to approved)
      if (existingMemberSameFamily && existingMemberSameFamily.approveStatus === 'approved') {
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

  /**
   * Get approved family members who are not in the family tree
   * This is used for the "Members Not In Tree" section
   */
  async getMembersNotInTree(familyCode: string, actingUserId: number) {
    await this.requireAdminMembership(actingUserId, familyCode);

    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();

    // Get all approved family members
    const allMembers = await this.familyMemberModel.findAll({
      where: {
        familyCode: normalizedFamilyCode,
        approveStatus: 'approved',
      } as any,
      include: [
        {
          model: this.userModel,
          as: 'user',
          attributes: ['id', 'email', 'mobile', 'countryCode', 'status', 'role', 'isAppUser'],
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
              attributes: ['firstName', 'lastName', 'profile', 'dob', 'gender', 'address', 'familyCode', 'contactNumber', 'emailPrivacy', 'addressPrivacy', 'phonePrivacy'],
            },
          ],
        },
      ],
    });

    // Get all users currently in the tree
    const treeEntries = await this.familyTreeModel.findAll({
      where: { familyCode: normalizedFamilyCode } as any,
      attributes: ['userId'],
    });

    const userIdsInTree = new Set(
      (treeEntries as any[])
        .map((e) => Number(e.userId))
        .filter((id) => Number.isFinite(id) && id > 0),
    );

    // Filter members who are approved but not in tree
    // Only include app users (not dummy users)
    const membersNotInTree = (allMembers as any[]).filter((member) => {
      const userId = Number(member?.memberId);
      const isAppUser = member?.user?.isAppUser;
      const isInTree = userIdsInTree.has(userId);
      
      // Include if: approved member, is app user, and NOT in tree
      return isAppUser && !isInTree;
    });

    // Format the response
    const result = membersNotInTree.map((member) => {
      const user = member.user;
      return {
        id: member.id,
        memberId: member.memberId,
        familyCode: member.familyCode,
        approveStatus: member.approveStatus,
        user: this.applyFamilyVisibility({
          id: user?.id,
          email: user?.email,
          mobile: user?.mobile,
          countryCode: user?.countryCode,
          isAppUser: user?.isAppUser,
          role: user?.role,
          fullName: user?.userProfile
            ? `${user.userProfile.firstName || ''} ${user.userProfile.lastName || ''}`.trim()
            : null,
          profileImage: user?.userProfile?.profile || null,
          userProfile: user?.userProfile
            ? {
                gender: user.userProfile.gender || null,
                familyCode: user.userProfile.familyCode || null,
                address: user.userProfile.address || null,
                phonePrivacy: user.userProfile.phonePrivacy,
                addressPrivacy: user.userProfile.addressPrivacy,
                emailPrivacy: user.userProfile.emailPrivacy,
                contactNumber: user.userProfile.contactNumber || null,
              }
            : null,
        }),
      };
    });

    return {
      message: `${result.length} members not in tree found`,
      data: result,
    };
  }
}



