import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef, Logger } from '@nestjs/common';
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
import { FamilyService } from './family.service';
import { TreeProjectionNode, TreeProjectionService } from './tree-projection.service';

@Injectable()
export class FamilyMemberService {
  private readonly logger = new Logger(FamilyMemberService.name);

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
    private readonly familyService: FamilyService,
    private readonly treeProjectionService: TreeProjectionService,

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

  private normalizeApprovalStatus(value: string | null | undefined) {
    return String(value || '').trim().toLowerCase();
  }

  private async mapTreeNodeToMemberResponse(
    node: TreeProjectionNode,
    familyCode: string,
    requestingUserId?: number,
  ) {
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    const sourceFamilyCode = String(
      node?.sourceFamilyCode || node?.primaryFamilyCode || node?.familyCode || normalizedFamilyCode,
    )
      .trim()
      .toUpperCase();
    const userProfile = node?.userProfile || {};

    let blockStatus = { isBlockedByMe: false, isBlockedByThem: false };
    if (
      requestingUserId &&
      node?.userId &&
      Number(requestingUserId) !== Number(node.userId)
    ) {
      try {
        blockStatus = await this.blockingService.getBlockStatus(
          requestingUserId,
          Number(node.userId),
        );
      } catch (_) {
        // non-blocking
      }
    }

    const role = Number(node?.role || 0);
    const isFamilyAdmin =
      role >= 2 &&
      String(sourceFamilyCode || '').trim().toUpperCase() === normalizedFamilyCode &&
      node?.nodeType === 'birth';

    return {
      id: node?.id,
      memberId: node?.userId,
      familyCode: normalizedFamilyCode,
      creatorId: null,
      approveStatus: node?.nodeType === 'birth' ? 'approved' : node?.nodeType,
      isLinkedUsed: false,
      createdAt: null,
      updatedAt: null,
      user: this.applyFamilyVisibility({
        id: node?.userId,
        email: node?.email || null,
        mobile: node?.mobile || null,
        countryCode: node?.countryCode || null,
        status: node?.status || 1,
        role,
        isAppUser: Boolean(node?.isAppUser),
        fullName: node?.name || 'Family Member',
        profileImage: node?.img || null,
        userProfile: {
          ...(userProfile || {}),
          familyCode: sourceFamilyCode || null,
          contactNumber: node?.contactNumber || userProfile?.contactNumber || null,
          gender: node?.gender || userProfile?.gender || null,
          profile: userProfile?.profile || null,
        },
      }),
      blockStatus,
      membershipType:
        node?.nodeType === 'birth'
          ? 'member'
          : node?.nodeType === 'linked'
            ? 'linked'
            : 'associated',
      familyRole: isFamilyAdmin ? (role === 3 ? 'Superadmin' : 'Admin') : 'Member',
      isFamilyAdmin,
      sourceFamilyCode,
    };
  }
  private async mapApprovedMembershipToMemberResponse(params: {
    membership: any;
    familyCode: string;
    sourceFamilyCode: string;
    membershipType: 'associated' | 'linked';
    requestingUserId?: number;
  }) {
    const normalizedFamilyCode = String(params?.familyCode || '').trim().toUpperCase();
    const sourceFamilyCode = String(params?.sourceFamilyCode || '').trim().toUpperCase();
    const membership = params?.membership;
    const user = membership?.user || {};
    const userProfile = user?.userProfile || {};
    const resolvedUserId = Number(user?.id || membership?.memberId || 0);

    let blockStatus = { isBlockedByMe: false, isBlockedByThem: false };
    if (
      params?.requestingUserId &&
      resolvedUserId &&
      Number(params.requestingUserId) !== resolvedUserId
    ) {
      try {
        blockStatus = await this.blockingService.getBlockStatus(
          params.requestingUserId,
          resolvedUserId,
        );
      } catch (_) {
        // non-blocking
      }
    }

    const role = Number(user?.role || 0);
    const isFamilyAdmin = role >= 2 && sourceFamilyCode === normalizedFamilyCode;

    return {
      id: membership?.id,
      memberId: resolvedUserId || null,
      familyCode: normalizedFamilyCode,
      creatorId: null,
      approveStatus: 'approved',
      isLinkedUsed: Boolean(membership?.isLinkedUsed),
      createdAt: membership?.createdAt || null,
      updatedAt: membership?.updatedAt || null,
      user: this.applyFamilyVisibility({
        id: resolvedUserId || null,
        email: user?.email || null,
        mobile: user?.mobile || null,
        countryCode: user?.countryCode || null,
        status: user?.status || 1,
        role,
        isAppUser: Boolean(user?.isAppUser),
        fullName:
          `${userProfile?.firstName || ''} ${userProfile?.lastName || ''}`.trim() ||
          'Family Member',
        profileImage: userProfile?.profile || null,
        userProfile: {
          ...(userProfile || {}),
          familyCode: sourceFamilyCode || null,
        },
      }),
      blockStatus,
      membershipType: params.membershipType,
      familyRole: isFamilyAdmin ? (role === 3 ? 'Superadmin' : 'Admin') : 'Member',
      isFamilyAdmin,
      sourceFamilyCode,
    };
  }
  private async mapConnectedTreeNodeToMemberResponse(params: {
    node: TreeProjectionNode;
    familyCode: string;
    sourceFamilyCode: string;
    membershipType: 'associated' | 'linked';
    requestingUserId?: number;
  }) {
    const normalizedFamilyCode = String(params?.familyCode || '').trim().toUpperCase();
    const sourceFamilyCode = String(params?.sourceFamilyCode || '').trim().toUpperCase();
    const node = params?.node;
    const userProfile = node?.userProfile || {};
    const resolvedUserId = Number(node?.userId || node?.memberId || 0);

    let blockStatus = { isBlockedByMe: false, isBlockedByThem: false };
    if (
      params?.requestingUserId &&
      resolvedUserId &&
      Number(params.requestingUserId) !== resolvedUserId
    ) {
      try {
        blockStatus = await this.blockingService.getBlockStatus(
          params.requestingUserId,
          resolvedUserId,
        );
      } catch (_) {
        // non-blocking
      }
    }

    const role = Number(node?.role || 0);
    const isFamilyAdmin = role >= 2 && sourceFamilyCode === normalizedFamilyCode;

    return {
      id: node?.id || node?.personId || resolvedUserId || null,
      memberId: resolvedUserId || null,
      familyCode: normalizedFamilyCode,
      creatorId: null,
      approveStatus: 'approved',
      isLinkedUsed: false,
      createdAt: null,
      updatedAt: null,
      user: this.applyFamilyVisibility({
        id: resolvedUserId || null,
        email: node?.email || null,
        mobile: node?.mobile || null,
        countryCode: node?.countryCode || null,
        status: node?.status || 1,
        role,
        isAppUser: Boolean(node?.isAppUser),
        fullName: node?.name || 'Family Member',
        profileImage: node?.img || userProfile?.profile || null,
        userProfile: {
          ...(userProfile || {}),
          familyCode: sourceFamilyCode || null,
          contactNumber: node?.contactNumber || userProfile?.contactNumber || null,
          gender: node?.gender || userProfile?.gender || null,
          profile: userProfile?.profile || null,
        },
      }),
      blockStatus,
      membershipType: params.membershipType,
      familyRole: isFamilyAdmin ? (role === 3 ? 'Superadmin' : 'Admin') : 'Member',
      isFamilyAdmin,
      sourceFamilyCode,
    };
  }
  private toRequestState(status: string | null | undefined) {
    const normalized = this.normalizeApprovalStatus(status);
    switch (normalized) {
      case 'approved':
        return 'ACCEPTED';
      case 'rejected':
        return 'REJECTED';
      case 'cancelled':
        return 'CANCELLED';
      case 'removed':
        return 'REMOVED';
      default:
        return 'PENDING';
    }
  }

  private buildMembershipResponse(message: string, membership: any, familyCode?: string) {
    const plainMembership = membership?.toJSON ? membership.toJSON() : membership;
    const normalizedFamilyCode =
      String(familyCode || plainMembership?.familyCode || '').trim().toUpperCase();

    return {
      message,
      data: {
        ...plainMembership,
        familyCode: normalizedFamilyCode,
        requestState: this.toRequestState(plainMembership?.approveStatus),
      },
    };
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

    const targetFamilyCode = String(familyCode || '').trim().toUpperCase();
    const family = await this.familyModel.findOne({
      where: { familyCode: targetFamilyCode },
      attributes: ['createdBy'],
    });

    if (Number((family as any)?.createdBy || 0) === Number(actingUserId)) {
      return true;
    }

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

      if (profile && profile.familyCode) {
        await profile.update(
          { familyCode: null } as any,
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
        familyCode,
        requestState: 'PENDING',
        replacedPreviousRequest,
        alreadyPending,
      },
    };
  }

  // Approve family member request
  async approveFamilyMember(memberId: number, familyCode: string, actingUserId: number) {
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    this.logger.log(`family-join approve requested requestUser=${memberId} actor=${actingUserId} family=${normalizedFamilyCode}`);

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
        where: { memberId, familyCode: normalizedFamilyCode } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
        order: [['updatedAt', 'DESC'], ['id', 'DESC']],
      });
      if (!membership) {
        throw new NotFoundException('Family join request not found');
      }

      const currentStatus = this.normalizeApprovalStatus((membership as any).approveStatus);
      if (currentStatus === 'approved') {
        await transaction.rollback();
        this.logger.warn(`family-join approve idempotent requestUser=${memberId} actor=${actingUserId} family=${normalizedFamilyCode}`);
        return this.buildMembershipResponse('Family member already approved', membership, normalizedFamilyCode);
      }

      if (currentStatus !== 'pending') {
        throw new BadRequestException(`Family join request is already ${currentStatus}`);
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

    this.logger.log(`family-join approve completed requestUser=${memberId} actor=${actingUserId} family=${normalizedFamilyCode}`);
    return this.buildMembershipResponse('Family member approved successfully', membership, normalizedFamilyCode);
  }

  // Reject family member request (optional, no notification example here)
  async rejectFamilyMember(memberId: number, rejectorId: number, familyCode: string) {
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    this.logger.log(`family-join reject requested requestUser=${memberId} actor=${rejectorId} family=${normalizedFamilyCode}`);

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
        where: { memberId, familyCode: normalizedFamilyCode } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
        order: [['updatedAt', 'DESC'], ['id', 'DESC']],
      });
      if (!membership) {
        throw new NotFoundException('Family join request not found');
      }

      const currentStatus = this.normalizeApprovalStatus((membership as any).approveStatus);
      if (currentStatus === 'rejected') {
        await transaction.rollback();
        this.logger.warn(`family-join reject idempotent requestUser=${memberId} actor=${rejectorId} family=${normalizedFamilyCode}`);
        return this.buildMembershipResponse('Family member already rejected', membership, normalizedFamilyCode);
      }

      if (currentStatus !== 'pending') {
        throw new BadRequestException(`Family join request is already ${currentStatus}`);
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

    this.logger.log(`family-join reject completed requestUser=${memberId} actor=${rejectorId} family=${normalizedFamilyCode}`);
    return this.buildMembershipResponse(`Family member ${userName} rejected successfully`, membership, normalizedFamilyCode);
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
      const [memberUser, membership, treeEntries] = await Promise.all([
        this.userModel.findByPk(memberId, { transaction }),
        this.familyMemberModel.findOne({
          where: { memberId, familyCode },
          transaction,
        }),
        this.familyTreeModel.findAll({
          where: { familyCode, userId: memberId },
          transaction,
        }),
      ]);

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

      const hasTreeEntries = treeEntries.length > 0;
      let dummyUserId: number = null;
      let revokedFamilies: string[] = [];
      let action = 'removed_from_family';

      if (hasTreeEntries) {
        const conversion = await this.familyService.convertFamilyUserNodesToStructuralDummy({
          actingUserId,
          familyCode,
          memberUserId: memberId,
          transaction,
        });
        dummyUserId = Number(conversion?.dummyUserId || 0) || null;
        revokedFamilies = Array.isArray(conversion?.revokedFamilies)
          ? conversion.revokedFamilies
          : [];
        action = params.skipAdminGuard
          ? 'account_deleted_structural_dummy_created'
          : 'converted_to_structural_dummy';
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
        revokedFamilies,
      });

      if (!params.skipAdminGuard && !isSelfRemoval) {
        await this.notifyMemberRemoval(memberId, familyCode);
      }

      return {
        message:
          action === 'converted_to_structural_dummy' ||
          action === 'account_deleted_structural_dummy_created'
            ? 'Family member removed and converted to a structural dummy in the tree'
            : 'Family member removed successfully',
        alreadyProcessed: false,
        dummyUserId,
        action,
        revokedFamilies,
        removedUserWasAppMember: Boolean(memberUser?.isAppUser),
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
    const isAdminOfFamily = await this.isAdminOfFamily(actingUserId, familyCode);
    if (isAdminOfFamily) {
      throw new BadRequestException(
        'Family admins cannot leave the family. Transfer or remove admin access first.',
      );
    }

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
      attributes: [
        'userId',
        'personId',
        'nodeUid',
        'generation',
        'familyCode',
        'isStructuralDummy',
        'nodeType',
        'dummyReason',
      ],
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

    const unique = new Map<string, any>();
    for (const row of rows as any[]) {
      const uid = Number(row?.userId);
      if (!Number.isFinite(uid) || uid <= 0) {
        continue;
      }

      const isStructuralDummy =
        Boolean(row?.isStructuralDummy) ||
        String(row?.nodeType || '').trim() === 'structural_dummy';
      const dedupeKey = isStructuralDummy
        ? `person:${Number(row?.personId || 0)}`
        : `user:${uid}`;
      if (unique.has(dedupeKey)) {
        continue;
      }

      unique.set(dedupeKey, {
        dummyUserId: uid,
        personId: row.personId,
        nodeUid: row.nodeUid,
        generation: row.generation,
        familyCode: row.familyCode,
        name: isStructuralDummy
          ? 'Removed member'
          : `${row?.user?.userProfile?.firstName || ''} ${row?.user?.userProfile?.lastName || ''}`.trim() || 'Familyss User',
        gender: row?.user?.userProfile?.gender || null,
        profile: row?.user?.userProfile?.profile || null,
        isStructuralDummy,
        nodeType: row?.nodeType || null,
        dummyReason: row?.dummyReason || null,
      });
    }

    return {
      message: 'Non-app tree users fetched successfully',
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
        throw new BadRequestException('Invalid non-app tree user');
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
        where: { familyCode, userId: replacementUserId, isStructuralDummy: false } as any,
        transaction,
      });
      if (existingTargetRows > 0) {
        throw new BadRequestException('Replacement user already exists in this family tree');
      }

      const [updatedCount] = await this.familyTreeModel.update(
        { userId: replacementUserId } as any,
        {
          where: { familyCode, userId: dummyUserId, isStructuralDummy: false } as any,
          transaction,
        },
      );

      if (!Number(updatedCount)) {
        throw new NotFoundException('Non-app tree user not found in this family tree');
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
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    const aggregate = await this.treeProjectionService.getFamilyAggregate(normalizedFamilyCode, {
      requestingUserId,
      includeAdminQueue: false,
    });

    const uniqueMembers = new Map<string, any>();
    for (const node of aggregate?.projection?.directoryMembers || []) {
      if (!node?.userId || node?.isStructuralDummy) {
        continue;
      }
      const sourceFamilyCode = String(
        node?.sourceFamilyCode || node?.primaryFamilyCode || node?.familyCode || normalizedFamilyCode,
      )
        .trim()
        .toUpperCase();
      const dedupeKey = `user:${Number(node.userId)}:${node.nodeType}:${sourceFamilyCode}`;
      if (uniqueMembers.has(dedupeKey)) {
        continue;
      }
      uniqueMembers.set(
        dedupeKey,
        await this.mapTreeNodeToMemberResponse(node, normalizedFamilyCode, requestingUserId),
      );
    }

    const connectedFamilyTypes = new Map<string, Set<'associated' | 'linked'>>();
    for (const family of aggregate?.projection?.associatedFamilies || []) {
      const sourceFamilyCode = String(family?.familyCode || '').trim().toUpperCase();
      if (!sourceFamilyCode || sourceFamilyCode === normalizedFamilyCode) {
        continue;
      }
      if (!connectedFamilyTypes.has(sourceFamilyCode)) {
        connectedFamilyTypes.set(sourceFamilyCode, new Set<'associated' | 'linked'>());
      }
      connectedFamilyTypes.get(sourceFamilyCode)!.add('associated');
    }
    for (const family of aggregate?.projection?.linkedFamilies || []) {
      const sourceFamilyCode = String(family?.familyCode || '').trim().toUpperCase();
      if (!sourceFamilyCode || sourceFamilyCode === normalizedFamilyCode) {
        continue;
      }
      if (!connectedFamilyTypes.has(sourceFamilyCode)) {
        connectedFamilyTypes.set(sourceFamilyCode, new Set<'associated' | 'linked'>());
      }
      connectedFamilyTypes.get(sourceFamilyCode)!.add('linked');
    }

    const connectedFamilyCodes = Array.from(connectedFamilyTypes.keys());

    for (const sourceFamilyCode of connectedFamilyCodes) {
      const membershipTypes = connectedFamilyTypes.get(sourceFamilyCode);
      if (!sourceFamilyCode || !membershipTypes?.size) {
        continue;
      }

      try {
        const connectedAggregate = await this.treeProjectionService.getFamilyAggregate(sourceFamilyCode, {
          requestingUserId,
          includeAdminQueue: false,
        });
        const connectedLocalNodes = (connectedAggregate?.nodes || []).filter((node) => {
          if (!node || node.isStructuralDummy) {
            return false;
          }

          const nodeType = String(node?.nodeType || '').trim().toLowerCase();
          if (nodeType !== 'birth') {
            return false;
          }

          const nodeSourceFamilyCode = String(
            node?.sourceFamilyCode || node?.primaryFamilyCode || node?.familyCode || '',
          )
            .trim()
            .toUpperCase();
          const nodeTreeFamilyCode = String(node?.treeFamilyCode || node?.familyCode || '')
            .trim()
            .toUpperCase();

          return (
            nodeSourceFamilyCode === sourceFamilyCode &&
            nodeTreeFamilyCode === sourceFamilyCode
          );
        });

        for (const node of connectedLocalNodes) {
          const identityKey = Number(node?.userId || node?.memberId || 0) > 0
            ? `user:${Number(node?.userId || node?.memberId || 0)}`
            : String(node?.nodeUid || '').trim()
              ? `node:${String(node?.nodeUid || '').trim()}`
              : `person:${Number(node?.personId || node?.id || 0)}`;
          if (!identityKey || identityKey.endsWith(':0')) {
            continue;
          }

          for (const membershipType of membershipTypes) {
            const dedupeKey = `${identityKey}:${membershipType}:${sourceFamilyCode}`;
            if (uniqueMembers.has(dedupeKey)) {
              continue;
            }

            uniqueMembers.set(
              dedupeKey,
              await this.mapConnectedTreeNodeToMemberResponse({
                node,
                familyCode: normalizedFamilyCode,
                sourceFamilyCode,
                membershipType,
                requestingUserId,
              }),
            );
          }
        }
      } catch (_) {
        // non-blocking: fall back to approved membership rows below
      }
    }

    const connectedMembers = connectedFamilyCodes.length
      ? await this.familyMemberModel.findAll({
          where: {
            familyCode: { [Op.in]: connectedFamilyCodes },
            approveStatus: 'approved',
          } as any,
          include: [
            {
              model: this.userModel,
              as: 'user',
              required: true,
              where: {
                isAppUser: true,
                status: 1,
              } as any,
              attributes: ['id', 'email', 'mobile', 'countryCode', 'status', 'role', 'isAppUser'],
              include: [
                {
                  model: this.userProfileModel,
                  as: 'userProfile',
                  required: false,
                },
              ],
            },
          ],
          order: [['familyCode', 'ASC'], ['updatedAt', 'DESC'], ['id', 'DESC']],
        })
      : [];

    for (const member of connectedMembers as any[]) {
      const sourceFamilyCode = String((member as any)?.familyCode || '').trim().toUpperCase();
      const memberUserId = Number((member as any)?.memberId || (member as any)?.user?.id || 0);
      const membershipTypes = connectedFamilyTypes.get(sourceFamilyCode);
      if (!sourceFamilyCode || !memberUserId || !membershipTypes?.size) {
        continue;
      }

      for (const membershipType of membershipTypes) {
        const dedupeKey = `user:${memberUserId}:${membershipType}:${sourceFamilyCode}`;
        if (uniqueMembers.has(dedupeKey)) {
          continue;
        }

        uniqueMembers.set(
          dedupeKey,
          await this.mapApprovedMembershipToMemberResponse({
            membership: member,
            familyCode: normalizedFamilyCode,
            sourceFamilyCode,
            membershipType,
            requestingUserId,
          }),
        );
      }
    }

    const data = Array.from(uniqueMembers.values());
    return {
      message: `${data.length} family members found.`,
      treeVersion: aggregate.treeVersion,
      projection: aggregate.projection,
      data,
    };
  }
  async getMembersNotInTree(familyCode: string, actingUserId: number) {
    await this.requireAdminMembership(actingUserId, familyCode);

    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    const queue = await this.treeProjectionService.getNonTreeAdminQueue(normalizedFamilyCode);
    const data = (queue || []).map((member: any) => ({
      ...member,
      user: this.applyFamilyVisibility(member?.user || {}),
    }));

    return {
      message: `${data.length} members not in tree found`,
      data,
    };
  }
  async getPendingRequestsByUser(userId: number) {
    const normalizedUserId = Number(userId);
    if (!normalizedUserId) {
      throw new BadRequestException('User ID is required');
    }

    const requests = await this.familyMemberModel.findAll({
      where: {
        memberId: normalizedUserId,
        approveStatus: 'pending',
      } as any,
      order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    });

    const familyCodes = Array.from(
      new Set(
        (requests as any[])
          .map((request) => String((request as any).familyCode || '').trim().toUpperCase())
          .filter(Boolean),
      ),
    );
    const families = familyCodes.length
      ? await this.familyModel.findAll({
          where: { familyCode: familyCodes } as any,
          attributes: ['familyCode', 'familyName'],
        })
      : [];
    const familyNameByCode = new Map(
      (families as any[]).map((family: any) => [String(family.familyCode || '').trim().toUpperCase(), family.familyName || null]),
    );

    return {
      message: `${requests.length} pending family request(s) found`,
      data: (requests as any[]).map((request: any) => ({
        ...(request.toJSON ? request.toJSON() : request),
        familyCode: String(request.familyCode || '').trim().toUpperCase(),
        familyName: familyNameByCode.get(String(request.familyCode || '').trim().toUpperCase()) || null,
        requestState: 'PENDING',
      })),
    };
  }

  async getMemberById(memberId: number) {
    const normalizedMemberId = Number(memberId);
    if (!normalizedMemberId) {
      throw new BadRequestException('Member ID is required');
    }

    const user = await this.userModel.findByPk(normalizedMemberId, {
      include: [
        {
          model: this.userProfileModel,
          as: 'userProfile',
          required: false,
        },
      ],
    });
    if (!user) {
      throw new NotFoundException('Family member not found');
    }

    const memberships = await this.familyMemberModel.findAll({
      where: { memberId: normalizedMemberId } as any,
      order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    });
    const treeEntries = await this.familyTreeModel.findAll({
      where: { userId: normalizedMemberId, isStructuralDummy: false } as any,
      attributes: ['familyCode', 'personId', 'nodeUid', 'generation', 'nodeType', 'isStructuralDummy'],
      order: [['familyCode', 'ASC'], ['generation', 'ASC']],
    });

    return {
      message: 'Family member details fetched successfully',
      data: this.applyFamilyVisibility({
        ...(user.toJSON ? user.toJSON() : user),
        memberships: (memberships as any[]).map((membership: any) => ({
          ...(membership.toJSON ? membership.toJSON() : membership),
          requestState: this.toRequestState(membership.approveStatus),
        })),
        treeEntries: (treeEntries as any[]).map((entry: any) =>
          entry.toJSON ? entry.toJSON() : entry,
        ),
      }),
    };
  }

  async suggestFamilyByProfile(userId: number) {
    const normalizedUserId = Number(userId);
    if (!normalizedUserId) {
      throw new BadRequestException('User ID is required');
    }

    const profile = await this.userProfileModel.findOne({ where: { userId: normalizedUserId } });
    if (!profile) {
      throw new NotFoundException('User profile not found');
    }

    const normalizeName = (value: any) => String(value || '').trim().toLowerCase();
    const uniqueNames = Array.from(
      new Set(
        this.collectProfileNames(profile)
          .map((name) => String(name || '').trim())
          .filter(Boolean),
      ),
    );

    if (!uniqueNames.length && !normalizeName((profile as any).fatherName) && !normalizeName((profile as any).motherName)) {
      return {
        message: 'No suggested families found',
        data: [],
      };
    }

    const matches = uniqueNames.length ? await this.fetchMatchingProfiles(uniqueNames) : [];
    const familyMatchMap = this.buildFamilyMatchMap(uniqueNames, matches as any[]);
    await this.applyParentNameMatches(profile, normalizeName, familyMatchMap);
    const foundFamilies = await this.buildFoundFamilies(familyMatchMap);
    foundFamilies.sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return String(a.familyCode).localeCompare(String(b.familyCode));
    });

    const families = await this.attachMembersToFamilies(foundFamilies);
    return {
      message: families.length ? 'Suggested families fetched successfully' : 'No suggested families found',
      data: families,
    };
  }

  async getFamilyStatsByCode(familyCode: string) {
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    await this.requireFamilyOrThrow(normalizedFamilyCode);

    const aggregate = await this.treeProjectionService.getFamilyAggregate(normalizedFamilyCode, {
      includeAdminQueue: false,
    });
    const members = (aggregate?.projection?.directoryMembers || []).filter(
      (node) => !node?.isStructuralDummy,
    );
    const males = members.filter((node) => String(node?.gender || '').toLowerCase() === 'male').length;
    const females = members.filter((node) => String(node?.gender || '').toLowerCase() === 'female').length;
    const ages = members
      .map((node) => Number(node?.age))
      .filter((age) => Number.isFinite(age) && age > 0);

    return {
      totalMembers: members.length,
      males,
      females,
      averageAge: ages.length
        ? Math.round((ages.reduce((sum, age) => sum + age, 0) / ages.length) * 10) / 10
        : 0,
      treeVersion: aggregate?.treeVersion || 1,
      associatedFamilies: (aggregate?.projection?.associatedFamilies || []).length,
      linkedFamilies: (aggregate?.projection?.linkedFamilies || []).length,
    };
  }

  async checkMemberExists(familyCode: string, memberId: number) {
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    const normalizedMemberId = Number(memberId);
    if (!normalizedFamilyCode || !normalizedMemberId) {
      throw new BadRequestException('familyCode and memberId are required');
    }

    const membership = await this.familyMemberModel.findOne({
      where: { familyCode: normalizedFamilyCode, memberId: normalizedMemberId } as any,
      order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    });
    const treeNode = await this.familyTreeModel.findOne({
      where: {
        familyCode: normalizedFamilyCode,
        userId: normalizedMemberId,
        isStructuralDummy: false,
      } as any,
      attributes: ['personId', 'nodeUid'],
      order: [['id', 'DESC']],
    });

    return {
      message: membership || treeNode ? 'Member link is valid' : 'Member not found',
      data: {
        exists: Boolean(membership || treeNode),
        isLinkUsed: Boolean((membership as any)?.isLinkedUsed),
        approveStatus: membership ? (membership as any).approveStatus : null,
        personId: Number((treeNode as any)?.personId || 0) || null,
        nodeUid: (treeNode as any)?.nodeUid || null,
      },
    };
  }

  async markLinkAsUsed(familyCode: string, memberId: number) {
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    const normalizedMemberId = Number(memberId);
    const membership = await this.familyMemberModel.findOne({
      where: { familyCode: normalizedFamilyCode, memberId: normalizedMemberId } as any,
      order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    });

    if (!membership) {
      throw new NotFoundException('Family member link not found');
    }

    if (!(membership as any).isLinkedUsed) {
      await membership.update({ isLinkedUsed: true } as any);
    }

    return {
      message: 'Invitation link marked as used successfully',
      data: {
        familyCode: normalizedFamilyCode,
        memberId: normalizedMemberId,
        isLinkUsed: true,
      },
    };
  }

  async addUserToFamily(userId: number, familyCode: string, addedBy?: number) {
    const normalizedUserId = Number(userId);
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    const normalizedAddedBy = Number(addedBy || 0) || null;

    if (!normalizedUserId || !normalizedFamilyCode) {
      throw new BadRequestException('userId and familyCode are required');
    }

    if (normalizedAddedBy) {
      await this.requireAdminMembership(normalizedAddedBy, normalizedFamilyCode);
    }

    const [user, family] = await Promise.all([
      this.userModel.findByPk(normalizedUserId),
      this.requireFamilyOrThrow(normalizedFamilyCode),
    ]);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const existingApprovedMembership = await this.familyMemberModel.findOne({
      where: { memberId: normalizedUserId, approveStatus: 'approved' } as any,
      order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    });
    if (
      existingApprovedMembership &&
      String((existingApprovedMembership as any).familyCode || '').trim().toUpperCase() !== normalizedFamilyCode
    ) {
      throw new BadRequestException('User already belongs to another family');
    }

    const transaction = await this.sequelize.transaction();
    try {
      let membership = await this.familyMemberModel.findOne({
        where: { memberId: normalizedUserId, familyCode: normalizedFamilyCode } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
        order: [['updatedAt', 'DESC'], ['id', 'DESC']],
      });

      if (membership) {
        await membership.update(
          {
            approveStatus: 'approved',
            removedAt: null,
            removedBy: null,
            creatorId: normalizedAddedBy || (membership as any).creatorId || normalizedUserId,
          } as any,
          { transaction },
        );
      } else {
        membership = await this.familyMemberModel.create(
          {
            memberId: normalizedUserId,
            familyCode: normalizedFamilyCode,
            creatorId: normalizedAddedBy || normalizedUserId,
            approveStatus: 'approved',
          } as any,
          { transaction },
        );
      }

      const profile = await this.userProfileModel.findOne({
        where: { userId: normalizedUserId },
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });
      if (profile && !profile.familyCode) {
        await profile.update({ familyCode: normalizedFamilyCode } as any, { transaction });
      }

      await this.contentVisibilityService.reconcileRecoveredFamilyContent(
        normalizedUserId,
        normalizedFamilyCode,
        transaction,
      );
      await transaction.commit();

      return this.buildMembershipResponse(
        'User added to family successfully',
        membership,
        normalizedFamilyCode,
      );
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}



