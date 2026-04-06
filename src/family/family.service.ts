import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/sequelize';
import { Sequelize, Op, QueryTypes } from 'sequelize';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { Family } from './model/family.model';
import { FamilyMember } from './model/family-member.model';
import { FamilyTree } from './model/family-tree.model';
import { FamilyLink } from './model/family-link.model';
import { TreeLink } from './model/tree-link.model';
import { MailService } from '../utils/mail.service';
import { RelationshipPathService } from './relationship-path.service';
import { UploadService } from '../uploads/upload.service';
import * as jwt from 'jsonwebtoken';

import { CreateFamilyDto } from './dto/create-family.dto';
import {
  CreateFamilyTreeDto,
  FamilyTreeMemberDto,
} from './dto/family-tree.dto';
import { NotificationService } from '../notification/notification.service';
import { saveBase64Image } from '../utils/upload.utils';
import { Relationship } from '../relationships/entities/relationship.model';
import { RelationshipEdgeService } from './relationship-edge.service';
import { repairFamilyTreeIntegrity } from './tree-integrity';
import { canViewScopedField } from '../user/privacy.util';
import { ContentVisibilityService } from '../user/content-visibility.service';
import { TreeProjectionService } from './tree-projection.service';
import {
  filterFamilyContentVisibilitySettings,
  normalizeFamilyContentVisibilitySettings,
} from '../user/content-visibility-settings.util';

@Injectable()
export class FamilyService {
  private async repairFamilyTreeAfterMutation(params: {
    familyCode: string;
    fixExternalGenerations?: boolean;
  }) {
    const familyCode = String(params?.familyCode || '').trim().toUpperCase();
    if (!familyCode) return;

    const transaction = await this.sequelize.transaction();
    try {
      await repairFamilyTreeIntegrity({
        familyCode,
        transaction,
        lock: true,
        fixExternalGenerations: params.fixExternalGenerations !== false,
      });
      await transaction.commit();
    } catch (e) {
      await transaction.rollback();
      console.error('Failed to repair family tree after mutation:', e);
    }
  }

  private async requireAdminActorForFamilyAction(params: {
    actingUserId: number;
    familyCode: string;
    nodeUid: string;
  }) {
    const actingUserId = Number(params?.actingUserId);
    const familyCode = String(params?.familyCode || '').trim().toUpperCase();
    const nodeUid = String(params?.nodeUid || '').trim();

    if (!actingUserId) {
      throw new ForbiddenException('Unauthorized');
    }
    if (!familyCode || !nodeUid) {
      throw new BadRequestException('familyCode and nodeUid are required');
    }

    await this.assertUserNotBlockedInFamily(actingUserId, familyCode);

    const actorUser = await this.userModel.findOne({
      where: { id: actingUserId },
      include: [
        {
          model: this.userProfileModel,
          as: 'userProfile',
          attributes: ['familyCode'],
        },
      ],
    });
    if (!actorUser) {
      throw new ForbiddenException('Unauthorized');
    }

    const actorRole = Number((actorUser as any).role);
    const actorIsAdmin = actorRole === 2 || actorRole === 3;
    if (!actorIsAdmin) {
      throw new ForbiddenException('Only admins can unlink cards');
    }

    const actorFamilyCode = String((actorUser as any)?.userProfile?.familyCode || '')
      .trim()
      .toUpperCase();
    const membership = await this.familyMemberModel.findOne({
      where: {
        memberId: actingUserId,
        familyCode,
        approveStatus: 'approved',
      } as any,
      order: [['id', 'DESC']],
    });
    const isAdminOfThisFamily = actorFamilyCode === familyCode || !!membership;
    if (!isAdminOfThisFamily) {
      throw new ForbiddenException('Not authorized to unlink cards in this family');
    }

    return { actingUserId, familyCode, nodeUid, actorUser, actorFamilyCode };
  }

  private async cleanupOrphanedRelationshipReferences(familyCode: string) {
    const remainingEntries = await this.familyTreeModel.findAll({
      where: { familyCode } as any,
    });

    const remainingPersonIdSet = new Set<number>(
      remainingEntries
        .map((e: any) => Number(e.personId))
        .filter((id) => Number.isFinite(id)),
    );

    const cleanArray = (arr: any) => {
      if (!arr || !Array.isArray(arr)) return [];
      return arr
        .map((id) => (typeof id === 'string' ? Number.parseInt(id, 10) : id))
        .filter((id) => !Number.isNaN(id) && remainingPersonIdSet.has(id));
    };

    for (const entry of remainingEntries as any[]) {
      const cleanedParents = cleanArray(entry.parents);
      const cleanedChildren = cleanArray(entry.children);
      const cleanedSpouses = cleanArray(entry.spouses);
      const cleanedSiblings = cleanArray(entry.siblings);

      const parentsChanged = JSON.stringify(cleanedParents) !== JSON.stringify(entry.parents);
      const childrenChanged = JSON.stringify(cleanedChildren) !== JSON.stringify(entry.children);
      const spousesChanged = JSON.stringify(cleanedSpouses) !== JSON.stringify(entry.spouses);
      const siblingsChanged = JSON.stringify(cleanedSiblings) !== JSON.stringify(entry.siblings);

      if (parentsChanged || childrenChanged || spousesChanged || siblingsChanged) {
        await entry.update({
          parents: cleanedParents,
          children: cleanedChildren,
          spouses: cleanedSpouses,
          siblings: cleanedSiblings,
        });
      }
    }
  }

  async getFamilyByUserId(userId: number) {
    const user = await this.userModel.findOne({
      where: { id: userId },
      include: [
        {
          model: UserProfile,
          as: 'userProfile',
          attributes: ['familyCode', 'id'],
        },
      ],
    });

    if (!user?.userProfile) {
      return null;
    }

    const profileFamilyCode = user.userProfile.familyCode;
    if (!profileFamilyCode) {
      const membership = await this.familyMemberModel.findOne({
        where: {
          memberId: userId,
          approveStatus: 'approved',
        },
        order: [['id', 'DESC']],
      });
      const memberFamilyCode = membership?.familyCode || null;
      return {
        familyCode: memberFamilyCode,
        userId: user.id,
      };
    }

    return {
      familyCode: profileFamilyCode,
      userId: user.id,
    };
  }

  async getUserName(userId: number): Promise<string> {
    try {


      // First try to get name from UserProfile directly
      const userProfile = await this.userProfileModel.findOne({
        where: { userId },
        attributes: ['firstName', 'lastName', 'userId'],
      });


      if (userProfile) {
        const firstName = userProfile.firstName || '';
        const lastName = userProfile.lastName || '';
        const fullName = `${firstName} ${lastName}`.trim();

        if (fullName) {

          return fullName;
        }
      }

      // Fallback to User model if UserProfile doesn't have the name
      const user = await this.userModel.findOne({
        where: { id: userId },
        include: [
          {
            model: UserProfile,
            as: 'userProfile',
            attributes: ['firstName', 'lastName'],
          },
        ],
      });


      if (user?.userProfile) {
        const firstName = user.userProfile.firstName || '';
        const lastName = user.userProfile.lastName || '';
        const fullName = `${firstName} ${lastName}`.trim();

        if (fullName) {

          return fullName;
        }
      }

      return 'Family Member';
    } catch (error) {
      console.error('Error getting user name:', error);
      return 'Family Member';
    }
  }

  async associateFamilies(associateDto: {
    sourceCode: string;
    targetCode: string;
  }) {
    const { sourceCode, targetCode } = associateDto;

    if (!sourceCode || !targetCode || sourceCode === targetCode) {
      throw new BadRequestException('Invalid family codes');
    }

    const transaction = await this.sequelize.transaction();

    try {
      // Update source family's associated codes (JSON array compatible)
      // Update source family's associated codes (JSON array compatible)
      await this.sequelize.query(
        `
        UPDATE ft_user_profile 
        SET "associatedFamilyCodes" = 
          CASE 
            WHEN "associatedFamilyCodes" IS NULL THEN jsonb_build_array(:targetCode)
            WHEN "associatedFamilyCodes" @> jsonb_build_array(:targetCode) THEN "associatedFamilyCodes"
            ELSE "associatedFamilyCodes" || jsonb_build_array(:targetCode)
          END
        WHERE "familyCode" = :sourceCode
      `,
        {
          replacements: { sourceCode, targetCode },
          transaction,
        },
      );

      // Update target family's associated codes (JSON array compatible)
      // Update target family's associated codes (JSON array compatible)
      await this.sequelize.query(
        `
        UPDATE ft_user_profile 
        SET "associatedFamilyCodes" = 
          CASE 
            WHEN "associatedFamilyCodes" IS NULL THEN jsonb_build_array(:sourceCode)
            WHEN "associatedFamilyCodes" @> jsonb_build_array(:sourceCode) THEN "associatedFamilyCodes"
            ELSE "associatedFamilyCodes" || jsonb_build_array(:sourceCode)
          END
        WHERE "familyCode" = :targetCode
      `,
        {
          replacements: { targetCode, sourceCode },
          transaction,
        },
      );

      await transaction.commit();
      return { success: true };
    } catch (error) {
      await transaction.rollback();
      throw new InternalServerErrorException(
        'Failed to associate families',
        error.message,
      );
    }
  }

  private normalizeFamilyPair(familyA: string, familyB: string): { low: string; high: string } {
    const a = String(familyA || '').trim().toUpperCase();
    const b = String(familyB || '').trim().toUpperCase();
    if (a <= b) {
      return { low: a, high: b };
    }
    return { low: b, high: a };
  }

  private async hasActiveTreeFamilyLink(params: {
    familyA: string;
    familyB: string;
  }): Promise<boolean> {
    const { familyA, familyB } = params;
    if (!familyA || !familyB) {
      return false;
    }
    const { low, high } = this.normalizeFamilyPair(familyA, familyB);
    if (!low || !high || low === high) {
      return false;
    }

    const rows = await this.sequelize.query(
      `
      SELECT 1
      FROM public.ft_family_link
      WHERE "familyCodeLow" = :low
        AND "familyCodeHigh" = :high
        AND status = 'active'
        AND source = 'tree'
      LIMIT 1
    `,
      {
        replacements: { low, high },
        type: QueryTypes.SELECT,
      },
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  private async hasRemainingCrossFamilyTreeBridge(params: {
    familyA: string;
    familyB: string;
    transaction?: any;
  }): Promise<boolean> {
    const familyA = String(params?.familyA || '').trim().toUpperCase();
    const familyB = String(params?.familyB || '').trim().toUpperCase();
    const transaction = params?.transaction;

    if (!familyA || !familyB || familyA === familyB) {
      return false;
    }

    const rows = await this.sequelize.query(
      `
      SELECT 1
      FROM public.ft_family_tree ft
      INNER JOIN public.ft_user_profile up
        ON up."userId" = ft."userId"
      WHERE COALESCE(ft."isExternalLinked", false) = false
        AND COALESCE(ft."isStructuralDummy", false) = false
        AND (
          (UPPER(COALESCE(ft."familyCode", '')) = :familyA AND UPPER(COALESCE(up."familyCode", '')) = :familyB)
          OR
          (UPPER(COALESCE(ft."familyCode", '')) = :familyB AND UPPER(COALESCE(up."familyCode", '')) = :familyA)
        )
      LIMIT 1
    `,
      {
        replacements: { familyA, familyB },
        type: QueryTypes.SELECT,
        ...(transaction ? { transaction } : {}),
      },
    );

    return Array.isArray(rows) && rows.length > 0;
  }

  private async pruneAssociatedFamilyCodesForPair(params: {
    familyA: string;
    familyB: string;
    transaction?: any;
  }) {
    const familyA = String(params?.familyA || '').trim().toUpperCase();
    const familyB = String(params?.familyB || '').trim().toUpperCase();
    const transaction = params?.transaction;

    if (!familyA || !familyB || familyA === familyB) {
      return;
    }

    const memberships = await this.familyMemberModel.findAll({
      where: {
        familyCode: { [Op.in]: [familyA, familyB] },
        approveStatus: 'approved',
      } as any,
      attributes: ['memberId', 'familyCode'],
      ...(transaction ? { transaction } : {}),
    });

    const membershipMap = new Map<number, Set<string>>();
    (memberships as any[]).forEach((membership: any) => {
      const memberId = Number(membership?.memberId);
      const membershipFamilyCode = String(membership?.familyCode || '').trim().toUpperCase();
      if (!memberId || !membershipFamilyCode) {
        return;
      }
      const current = membershipMap.get(memberId) || new Set<string>();
      current.add(membershipFamilyCode);
      membershipMap.set(memberId, current);
    });

    const memberIds = Array.from(membershipMap.keys());
    const profileFilters: any[] = [
      { familyCode: { [Op.in]: [familyA, familyB] } } as any,
    ];
    if (memberIds.length > 0) {
      profileFilters.push({ userId: { [Op.in]: memberIds } } as any);
    }

    const profiles = await this.userProfileModel.findAll({
      where: { [Op.or]: profileFilters } as any,
      attributes: ['userId', 'familyCode', 'associatedFamilyCodes'],
      ...(transaction ? { transaction } : {}),
    });
    await Promise.all(
      (profiles as any[]).map(async (profile: any) => {
        const associated = Array.isArray(profile.associatedFamilyCodes)
          ? profile.associatedFamilyCodes.filter(Boolean)
          : [];
        if (associated.length === 0) {
          return;
        }

        const profileFamilyCode = String(profile?.familyCode || '').trim().toUpperCase();
        const membershipCodes = membershipMap.get(Number(profile?.userId)) || new Set<string>();
        const belongsToA = profileFamilyCode === familyA || membershipCodes.has(familyA);
        const belongsToB = profileFamilyCode === familyB || membershipCodes.has(familyB);

        const nextAssociated = associated.filter((code: any) => {
          const normalized = String(code || '').trim().toUpperCase();
          if (belongsToA && normalized === familyB) {
            return false;
          }
          if (belongsToB && normalized === familyA) {
            return false;
          }
          return true;
        });

        if (nextAssociated.length === associated.length) {
          return;
        }

        const profileUserId = Number(profile?.userId || 0);
        if (!profileUserId) {
          return;
        }

        await this.userProfileModel.update(
          { associatedFamilyCodes: nextAssociated } as any,
          {
            where: { userId: profileUserId } as any,
            ...(transaction ? { transaction } : {}),
          } as any,
        );
      }),
    );
  }

  private async pruneContentVisibilitySettingsForPair(params: {
    familyA: string;
    familyB: string;
    transaction?: any;
  }) {
    const familyA = String(params?.familyA || '').trim().toUpperCase();
    const familyB = String(params?.familyB || '').trim().toUpperCase();
    const transaction = params?.transaction;

    if (!familyA || !familyB || familyA === familyB) {
      return;
    }

    const memberships = await this.familyMemberModel.findAll({
      where: {
        familyCode: { [Op.in]: [familyA, familyB] },
        approveStatus: 'approved',
      } as any,
      attributes: ['memberId', 'familyCode'],
      ...(transaction ? { transaction } : {}),
    });

    const membershipMap = new Map<number, Set<string>>();
    (memberships as any[]).forEach((membership: any) => {
      const memberId = Number(membership?.memberId);
      const membershipFamilyCode = String(membership?.familyCode || '').trim().toUpperCase();
      if (!memberId || !membershipFamilyCode) {
        return;
      }
      const current = membershipMap.get(memberId) || new Set<string>();
      current.add(membershipFamilyCode);
      membershipMap.set(memberId, current);
    });

    const memberIds = Array.from(membershipMap.keys());
    const profileFilters: any[] = [
      { familyCode: { [Op.in]: [familyA, familyB] } } as any,
    ];
    if (memberIds.length > 0) {
      profileFilters.push({ userId: { [Op.in]: memberIds } } as any);
    }

    const profiles = await this.userProfileModel.findAll({
      where: { [Op.or]: profileFilters } as any,
      attributes: ['userId', 'familyCode', 'contentVisibilitySettings'],
      ...(transaction ? { transaction } : {}),
    });

    for (const profile of profiles as any[]) {
      const profileFamilyCode = String(profile?.familyCode || '').trim().toUpperCase();
      const membershipCodes = membershipMap.get(Number(profile?.userId)) || new Set<string>();
      const belongsToA = profileFamilyCode === familyA || membershipCodes.has(familyA);
      const belongsToB = profileFamilyCode === familyB || membershipCodes.has(familyB);
      if (!belongsToA && !belongsToB) {
        continue;
      }

      const disallowed = new Set<string>();
      if (belongsToA) {
        disallowed.add(familyB);
      }
      if (belongsToB) {
        disallowed.add(familyA);
      }

      const currentSettings = normalizeFamilyContentVisibilitySettings(
        (profile as any).contentVisibilitySettings,
      );
      const currentCodes = new Set<string>([
        ...currentSettings.posts.familyCodes,
        ...currentSettings.albums.familyCodes,
        ...currentSettings.events.familyCodes,
      ]);
      const allowedFamilyCodes = Array.from(currentCodes).filter(
        (familyCode) => !disallowed.has(String(familyCode || '').trim().toUpperCase()),
      );
      const nextSettings = filterFamilyContentVisibilitySettings(
        currentSettings,
        allowedFamilyCodes,
      );

      if (JSON.stringify(nextSettings) === JSON.stringify(currentSettings)) {
        continue;
      }
      const profileUserId = Number(profile?.userId || 0);
      if (!profileUserId) {
        continue;
      }

      await this.userProfileModel.update(
        { contentVisibilitySettings: nextSettings } as any,
        {
          where: { userId: profileUserId } as any,
          ...(transaction ? { transaction } : {}),
        } as any,
      );
    }
  }

  private async revokeFamilyConnectionIfUnbridged(params: {
    familyA: string;
    familyB: string;
    transaction?: any;
  }): Promise<boolean> {
    const familyA = String(params?.familyA || '').trim().toUpperCase();
    const familyB = String(params?.familyB || '').trim().toUpperCase();
    const transaction = params?.transaction;

    if (!familyA || !familyB || familyA === familyB) {
      return false;
    }

    const { low, high } = this.normalizeFamilyPair(familyA, familyB);

    const [remainingTreeLink, remainingExternalCard, remainingCrossFamilyTreeBridge] = await Promise.all([
      this.treeLinkModel.findOne({
        where: {
          familyCodeLow: low,
          familyCodeHigh: high,
          status: 'active',
        } as any,
        ...(transaction ? { transaction } : {}),
      }),
      this.familyTreeModel.findOne({
        where: {
          isExternalLinked: true,
          [Op.or]: [
            {
              familyCode: familyA,
              canonicalFamilyCode: familyB,
            } as any,
            {
              familyCode: familyB,
              canonicalFamilyCode: familyA,
            } as any,
          ],
        } as any,
        ...(transaction ? { transaction } : {}),
      }),
      this.hasRemainingCrossFamilyTreeBridge({ familyA, familyB, transaction }),
    ]);

    if (remainingTreeLink || remainingExternalCard || remainingCrossFamilyTreeBridge) {
      return false;
    }

    await this.familyLinkModel.update(
      { status: 'inactive' } as any,
      {
        where: {
          familyCodeLow: low,
          familyCodeHigh: high,
          status: 'active',
        } as any,
        ...(transaction ? { transaction } : {}),
      },
    );

    await this.pruneAssociatedFamilyCodesForPair({ familyA, familyB, transaction });
    await this.pruneContentVisibilitySettingsForPair({ familyA, familyB, transaction });
    return true;
  }

  async getLinkedFamiliesForCurrentUser(userId: number) {
    if (!userId) {
      throw new ForbiddenException('Unauthorized');
    }

    const reachableFamilyCodes = await this.treeProjectionService.getReachableFamilyCodesForUser(userId);
    if (!reachableFamilyCodes.length) {
      return [];
    }

    const projectionFamilies = new Map<string, any>();
    for (const familyCode of reachableFamilyCodes) {
      const aggregate = await this.treeProjectionService.getFamilyAggregate(familyCode, {
        requestingUserId: userId,
      });
      (aggregate?.projection?.linkedFamilies || []).forEach((family) => {
        const code = String(family?.familyCode || '').trim().toUpperCase();
        if (!code || code === familyCode || projectionFamilies.has(code)) {
          return;
        }
        projectionFamilies.set(code, {
          familyCode: code,
          familyName: family.familyName || code,
          memberCount: Number(family.memberCount || 0),
          nodeType: 'linked',
        });
      });
    }

    return Array.from(projectionFamilies.values());
  }

  constructor(
    @InjectModel(User)
    private readonly userModel: typeof User,
    @InjectConnection()
    private readonly sequelize: Sequelize,
    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,
    @InjectModel(Family)
    private readonly familyModel: typeof Family,
    @InjectModel(FamilyMember)
    private readonly familyMemberModel: typeof FamilyMember,
    @InjectModel(FamilyTree)
    private readonly familyTreeModel: typeof FamilyTree,
    @InjectModel(FamilyLink)
    private readonly familyLinkModel: typeof FamilyLink,
    @InjectModel(TreeLink)
    private readonly treeLinkModel: typeof TreeLink,
    private readonly mailService: MailService,
    @Inject(forwardRef(() => NotificationService))
    private readonly notificationService: NotificationService,
    private readonly relationshipEdgeService: RelationshipEdgeService,
    private readonly relationshipPathService: RelationshipPathService,
    private readonly uploadService: UploadService,
    private readonly contentVisibilityService: ContentVisibilityService,
    private readonly treeProjectionService: TreeProjectionService,
  ) {}

  async unlinkTreeLinkExternalCard(params: {
    actingUserId: number;
    familyCode: string;
    nodeUid: string;
  }) {
    const { actingUserId, familyCode, nodeUid } =
      await this.requireAdminActorForFamilyAction(params);

    const transaction = await this.sequelize.transaction();
    try {
      const familyRecord = await this.familyModel.findOne({
        where: { familyCode } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });

      const externalCard = await this.familyTreeModel.findOne({
        where: {
          familyCode,
          nodeUid,
          isExternalLinked: true,
          isStructuralDummy: false,
        } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });
      if (!externalCard) {
        throw new NotFoundException('Linked card not found');
      }

      const canonicalFamilyCode = String(
        (externalCard as any).canonicalFamilyCode || '',
      )
        .trim()
        .toUpperCase();
      const canonicalNodeUid = String(
        (externalCard as any).canonicalNodeUid || '',
      ).trim();

      const cardsToConvert = await this.familyTreeModel.findAll({
        where: {
          familyCode,
          isExternalLinked: true,
          isStructuralDummy: false,
          ...(canonicalFamilyCode && canonicalNodeUid
            ? {
              canonicalFamilyCode,
              canonicalNodeUid,
            }
            : { nodeUid }),
        } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });

      const convertedPersonIds = cardsToConvert
        .map((c: any) => Number(c.personId))
        .filter((id) => Number.isFinite(id));
      const revokedFamilies = new Set<string>();

      for (const treeEntry of cardsToConvert as any[]) {
        const converted = await this.convertTreeEntryToStructuralDummy({
          actingUserId,
          familyCode,
          treeEntry,
          transaction,
        });

        (converted.revokedFamilies || []).forEach((code) => {
          revokedFamilies.add(String(code || '').trim().toUpperCase());
        });

        if (converted.originalUserId) {
          await this.contentVisibilityService.hideContentForRemovedFamily(
            Number(converted.originalUserId),
            familyCode,
            'member_removed',
            transaction,
          );
        }
      }

      await repairFamilyTreeIntegrity({
        familyCode,
        transaction,
        lock: true,
        fixExternalGenerations: true,
      });

      if (familyRecord) {
        await familyRecord.increment('treeVersion', { by: 1, transaction });
      }

      await transaction.commit();

      const aggregate = await this.treeProjectionService.getFamilyAggregate(familyCode, {
        requestingUserId: actingUserId,
      });

      this.notificationService.emitFamilyEvent(familyCode, {
        type: 'TREE_CHANGED',
        treeVersion: aggregate.treeVersion,
        unlinkedNodeUid: nodeUid,
        unlinkedBy: actingUserId,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: 'Linked card converted to structural dummy successfully',
        convertedExternalCards: cardsToConvert.length,
        removedExternalCards: cardsToConvert.length,
        removedPersonIds: convertedPersonIds,
        treeVersion: aggregate.treeVersion,
        projection: aggregate.projection,
        revokedFamilies: Array.from(revokedFamilies),
        prunedPrivacyFamilies: Array.from(revokedFamilies),
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  async unlinkLinkedFamily(params: {
    actingUserId: number;
    otherFamilyCode: string;
  }) {
    const actingUserId = Number(params?.actingUserId);
    const otherFamilyCode = String(params?.otherFamilyCode || '')
      .trim()
      .toUpperCase();

    if (!actingUserId) {
      throw new ForbiddenException('Unauthorized');
    }
    if (!otherFamilyCode) {
      throw new BadRequestException('otherFamilyCode is required');
    }

    const actorUser = await this.userModel.findOne({
      where: { id: actingUserId },
      include: [
        {
          model: this.userProfileModel,
          as: 'userProfile',
          attributes: ['familyCode'],
        },
      ],
    });
    if (!actorUser) {
      throw new ForbiddenException('Unauthorized');
    }

    const actorRole = Number((actorUser as any).role);
    const actorIsAdmin = actorRole === 2 || actorRole === 3;
    if (!actorIsAdmin) {
      throw new ForbiddenException('Only admins can unlink linked families');
    }

    const actorProfileFamilyCode = String(
      (actorUser as any)?.userProfile?.familyCode || '',
    )
      .trim()
      .toUpperCase();
    const actorMembership = await this.familyMemberModel.findOne({
      where: {
        memberId: actingUserId,
        approveStatus: 'approved',
      } as any,
      order: [['id', 'DESC']],
    });
    const actorFamilyCode = String(
      actorProfileFamilyCode || actorMembership?.familyCode || '',
    )
      .trim()
      .toUpperCase();

    if (!actorFamilyCode) {
      throw new BadRequestException('Requester must belong to a family');
    }
    if (actorFamilyCode === otherFamilyCode) {
      throw new BadRequestException('Cannot unlink the same family');
    }

    await this.assertUserNotBlockedInFamily(actingUserId, actorFamilyCode);

    const { low, high } = this.normalizeFamilyPair(actorFamilyCode, otherFamilyCode);

    const activeFamilyLink = await this.familyLinkModel.findOne({
      where: {
        familyCodeLow: low,
        familyCodeHigh: high,
        source: 'tree',
        status: 'active',
      } as any,
      order: [['id', 'DESC']],
    });
    if (!activeFamilyLink) {
      throw new NotFoundException('No active linked family connection found');
    }

    const transaction = await this.sequelize.transaction();
    try {
      const familyRecords = await this.familyModel.findAll({
        where: {
          familyCode: { [Op.in]: [actorFamilyCode, otherFamilyCode] },
        } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });
      const familyRecordByCode = new Map(
        familyRecords.map((record: any) => [
          String(record.familyCode || '').trim().toUpperCase(),
          record,
        ]),
      );

      const [familyLinkUpdated] = await this.familyLinkModel.update(
        { status: 'inactive' } as any,
        {
          where: {
            familyCodeLow: low,
            familyCodeHigh: high,
            source: 'tree',
            status: 'active',
          } as any,
          transaction,
        },
      );

      const [treeLinksUpdated] = await this.treeLinkModel.update(
        { status: 'inactive' } as any,
        {
          where: {
            familyCodeLow: low,
            familyCodeHigh: high,
            status: 'active',
          } as any,
          transaction,
        },
      );

      const linkCleanupPairs = [
        { familyCode: actorFamilyCode, canonicalFamilyCode: otherFamilyCode },
        { familyCode: otherFamilyCode, canonicalFamilyCode: actorFamilyCode },
      ];

      const convertedCounts = new Map<string, number>();
      const convertedPersonIds: number[] = [];
      const revokedFamilies = new Set<string>();

      for (const pair of linkCleanupPairs) {
        const cardsToConvert = await this.familyTreeModel.findAll({
          where: {
            familyCode: pair.familyCode,
            isExternalLinked: true,
            isStructuralDummy: false,
            canonicalFamilyCode: pair.canonicalFamilyCode,
          } as any,
          transaction,
          lock: (transaction as any).LOCK.UPDATE,
        });

        convertedCounts.set(pair.familyCode, cardsToConvert.length);

        for (const treeEntry of cardsToConvert as any[]) {
          convertedPersonIds.push(Number((treeEntry as any).personId));
          const converted = await this.convertTreeEntryToStructuralDummy({
            actingUserId,
            familyCode: pair.familyCode,
            treeEntry,
            transaction,
          });

          (converted.revokedFamilies || []).forEach((code) => {
            revokedFamilies.add(String(code || '').trim().toUpperCase());
          });

          if (converted.originalUserId) {
            await this.contentVisibilityService.hideContentForRemovedFamily(
              Number(converted.originalUserId),
              pair.familyCode,
              'member_removed',
              transaction,
            );
          }
        }
      }

      const familiesToRepair = Array.from(
        new Set([actorFamilyCode, otherFamilyCode].filter(Boolean)),
      );
      for (const familyCode of familiesToRepair) {
        await repairFamilyTreeIntegrity({
          familyCode,
          transaction,
          lock: true,
          fixExternalGenerations: true,
        });

        const familyRecord = familyRecordByCode.get(familyCode);
        if (familyRecord) {
          await familyRecord.increment('treeVersion', { by: 1, transaction });
        }
      }

      await transaction.commit();

      const aggregate = await this.treeProjectionService.getFamilyAggregate(actorFamilyCode, {
        requestingUserId: actingUserId,
      });

      familiesToRepair.forEach((familyCode) => {
        this.notificationService.emitFamilyEvent(familyCode, {
          type: 'TREE_CHANGED',
          treeVersion:
            familyCode === actorFamilyCode
              ? aggregate.treeVersion
              : familyRecordByCode.get(familyCode)?.treeVersion,
          unlinkedFamilyCode: otherFamilyCode,
          unlinkedBy: actingUserId,
          timestamp: new Date().toISOString(),
        });
      });

      const totalConverted = Array.from(convertedCounts.values()).reduce(
        (sum, count) => sum + Number(count || 0),
        0,
      );

      return {
        success: true,
        message: 'Linked family connection removed',
        familyLinkUpdated: Number(familyLinkUpdated || 0),
        treeLinksUpdated: Number(treeLinksUpdated || 0),
        convertedExternalCards: totalConverted,
        removedExternalCards: totalConverted,
        removedPersonIds: convertedPersonIds.filter((id) => Number.isFinite(id)),
        revokedFamilyVisibility: revokedFamilies.size > 0,
        revokedFamilies: Array.from(revokedFamilies),
        treeVersion: aggregate.treeVersion,
        projection: aggregate.projection,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  async repairFamilyTree(params: {
    actingUserId: number;
    familyCode: string;
    fixExternalGenerations?: boolean;
  }) {
    const actingUserId = Number(params?.actingUserId);
    const familyCode = String(params?.familyCode || '')
      .trim()
      .toUpperCase();

    if (!actingUserId) {
      throw new ForbiddenException('Unauthorized');
    }
    if (!familyCode) {
      throw new BadRequestException('familyCode is required');
    }

    await this.assertUserNotBlockedInFamily(actingUserId, familyCode);

    const actorUser = await this.userModel.findOne({
      where: { id: actingUserId },
      include: [
        {
          model: this.userProfileModel,
          as: 'userProfile',
          attributes: ['familyCode'],
        },
      ],
    });
    if (!actorUser) {
      throw new ForbiddenException('Unauthorized');
    }

    const actorRole = Number((actorUser as any).role);
    const actorIsAdmin = actorRole === 2 || actorRole === 3;
    if (!actorIsAdmin) {
      throw new ForbiddenException('Only admins can repair trees');
    }

    const actorFamilyCode = String((actorUser as any)?.userProfile?.familyCode || '')
      .trim()
      .toUpperCase();
    const membership = await this.familyMemberModel.findOne({
      where: {
        memberId: actingUserId,
        familyCode,
        approveStatus: 'approved',
      } as any,
      order: [['id', 'DESC']],
    });
    const isAdminOfThisFamily = actorFamilyCode === familyCode || !!membership;
    if (!isAdminOfThisFamily) {
      throw new ForbiddenException('Not authorized to repair this family');
    }

    const transaction = await this.sequelize.transaction();
    try {
      const result = await repairFamilyTreeIntegrity({
        familyCode,
        transaction,
        lock: true,
        fixExternalGenerations: params.fixExternalGenerations !== false,
      });
      await transaction.commit();
      return { success: true, message: 'Family tree repaired', data: result };
    } catch (e: any) {
      await transaction.rollback();
      throw new InternalServerErrorException(
        'Failed to repair family tree: ' + (e?.message || e),
      );
    }
  }

  // Helper function to generate JWT access token
  private generateAccessToken(user: User): string {
    return jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' },
    );
  }

  private async assertUserNotBlockedInFamily(
    userId: number,
    familyCode: string,
  ): Promise<void> {
    // BLOCK OVERRIDE: Legacy family-level block state removed; user-level blocking is handled in ft_user_block.
    void userId;
    void familyCode;
  }

  // Authorization helper: ensure a user can VIEW a given family's tree
  // - Normal flow (/family/tree/:familyCode): user must be an APPROVED member of that family
  // - Admin merge/preview flows may pass allowAdminPreview=true to allow cross-family preview for admins
  private async assertUserCanViewFamilyTree(
    userId: number,
    familyCode: string,
    allowAdminPreview = false,
  ) {
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();

    if (!normalizedFamilyCode) {
      throw new BadRequestException('familyCode is required');
    }

    const [user, membership, reachableFamilyCodes] = await Promise.all([
      this.userModel.findOne({
        where: { id: userId },
        include: [
          {
            model: UserProfile,
            as: 'userProfile',
            attributes: ['familyCode'],
          },
        ],
      }),
      this.familyMemberModel.findOne({
        where: {
          memberId: userId,
          familyCode: normalizedFamilyCode,
          approveStatus: 'approved',
        } as any,
      }),
      this.treeProjectionService.getReachableFamilyCodesForUser(userId),
    ]);

    if (!user) {
      throw new ForbiddenException('Unauthorized');
    }

    const userProfile = (user as any)?.userProfile;
    await this.assertUserNotBlockedInFamily(userId, normalizedFamilyCode);

    if (membership) {
      return;
    }

    const viewerTreeEntry = await this.familyTreeModel.findOne({
      where: {
        familyCode: normalizedFamilyCode,
        userId,
        isStructuralDummy: false,
      } as any,
    });

    if (viewerTreeEntry) {
      return;
    }

    if (reachableFamilyCodes.includes(normalizedFamilyCode)) {
      return;
    }

    if (!allowAdminPreview) {
      throw new ForbiddenException(
        'Access denied: you are not a visible member of this family tree',
      );
    }

    await this.assertAdminPreviewAllowed(userId);
  }

  private isCrossFamilyTreeViewEnabled(): boolean {
    return ['1', 'true', 'yes'].includes(
      String(process.env.ALLOW_CROSS_FAMILY_TREE_VIEW || '').trim().toLowerCase(),
    );
  }

  private hasAssociatedFamilyAccess(associated: any[], familyCode: string): boolean {
    const normalizedTargetFamilyCode = String(familyCode).trim().toUpperCase();
    return associated.some((c) => {
      if (!c) return false;
      return String(c).trim().toUpperCase() === normalizedTargetFamilyCode;
    });
  }

  private async hasTreeLinkFamilyVisibility(
    userId: number,
    familyCode: string,
    userProfile: any,
  ): Promise<boolean> {
    try {
      const viewerFamilyCodeFromProfile = userProfile?.familyCode;
      const viewerMembership = await this.familyMemberModel.findOne({
        where: {
          memberId: userId,
          approveStatus: 'approved',
        } as any,
        order: [['id', 'DESC']],
      });

      const viewerFamilyCode =
        viewerFamilyCodeFromProfile || viewerMembership?.familyCode;
      if (!viewerFamilyCode) {
        return false;
      }
      return await this.hasActiveTreeFamilyLink({
        familyA: viewerFamilyCode,
        familyB: familyCode,
      });
    } catch (error_) {
      console.error('Error checking tree-link family visibility (viewer):', error_);
      return false;
    }
  }

  private async hasFamilyLevelVisibilityViaMembers(
    userId: number,
    familyCode: string,
    userProfile: any,
  ): Promise<boolean> {
    try {
      const viewerFamilyCodeFromProfile = userProfile?.familyCode;
      const viewerMembership = await this.familyMemberModel.findOne({
        where: {
          memberId: userId,
          approveStatus: 'approved',
        } as any,
        order: [['id', 'DESC']],
      });

      const viewerFamilyCode =
        viewerFamilyCodeFromProfile || viewerMembership?.familyCode;

      if (!viewerFamilyCode) {
        return false;
      }

      const familyMembers = await this.familyMemberModel.findAll({
        where: {
          familyCode: viewerFamilyCode,
          approveStatus: 'approved',
        } as any,
        attributes: ['memberId'],
      });

      const memberIds = (familyMembers as any[])
        .map((m: any) => Number(m?.memberId))
        .filter((id) => id && !Number.isNaN(id));

      if (memberIds.length === 0) {
        return false;
      }

      const memberTreeEntry = await this.familyTreeModel.findOne({
        where: {
          familyCode,
          userId: { [Op.in]: memberIds },
        } as any,
      });

      if (memberTreeEntry) {
        return true;
      }

      return await this.anyUserHasAssociatedFamilyCode(memberIds, familyCode);
    } catch (error_) {
      console.error('Error checking family-level visibility (members):', error_);
      return false;
    }
  }

  private async hasActingAdminVisibility(
    userId: number,
    familyCode: string,
    userProfile: any,
  ): Promise<boolean> {
    try {
      const actingUser = await this.userModel.findByPk(userId);
      const isAdmin = actingUser && (actingUser.role === 2 || actingUser.role === 3);
      if (!isAdmin) {
        return false;
      }

      const adminFamilyCodeFromProfile = userProfile?.familyCode;
      const adminMembership = await this.familyMemberModel.findOne({
        where: {
          memberId: userId,
          approveStatus: 'approved',
        } as any,
        order: [['id', 'DESC']],
      });

      const adminFamilyCode = adminFamilyCodeFromProfile || adminMembership?.familyCode;
      if (!adminFamilyCode) {
        return false;
      }

      const adminFamilyMembers = await this.familyMemberModel.findAll({
        where: {
          familyCode: adminFamilyCode,
          approveStatus: 'approved',
        } as any,
        attributes: ['memberId'],
      });

      const memberIds = (adminFamilyMembers as any[])
        .map((m: any) => Number(m?.memberId))
        .filter((id) => id && !Number.isNaN(id));

      if (memberIds.length === 0) {
        return false;
      }

      const memberTreeEntry = await this.familyTreeModel.findOne({
        where: {
          familyCode,
          userId: { [Op.in]: memberIds },
        } as any,
      });

      if (memberTreeEntry) {
        return true;
      }

      return await this.anyUserHasAssociatedFamilyCode(memberIds, familyCode);
    } catch (error) {
      console.error('Error checking acting-admin visibility:', error);
      return false;
    }
  }

  private async anyUserHasAssociatedFamilyCode(
    userIds: number[],
    familyCode: string,
  ): Promise<boolean> {
    const memberProfiles = await this.userProfileModel.findAll({
      where: { userId: { [Op.in]: userIds } } as any,
      attributes: ['userId', 'associatedFamilyCodes'],
    });

    const normalizedTarget = String(familyCode).trim().toUpperCase();
    return (memberProfiles as any[]).some((p: any) => {
      const codes = Array.isArray(p?.associatedFamilyCodes)
        ? (p.associatedFamilyCodes as any[])
        : [];
      return codes.some(
        (c) => c && String(c).trim().toUpperCase() === normalizedTarget,
      );
    });
  }

  private async hasSpouseLinkedAccess(
    userId: number,
    familyCode: string,
  ): Promise<boolean> {
    try {
      const relationships = await this.relationshipEdgeService.getUserRelationships(
        Number(userId),
      );
      const spouseRelationships = Array.isArray(relationships)
        ? relationships.filter((r: any) => r?.relationshipType === 'spouse')
        : [];

      if (spouseRelationships.length === 0) {
        return false;
      }

      const counterpartIds = Array.from(
        new Set(
          spouseRelationships
            .map((r: any) =>
              Number(r.user1Id) === Number(userId)
                ? Number(r.user2Id)
                : Number(r.user1Id),
            )
            .filter((id: any) => id && !Number.isNaN(Number(id))),
        ),
      );

      if (counterpartIds.length === 0) {
        return false;
      }

      const [counterpartMembership, counterpartProfile, counterpartTree] =
        await Promise.all([
          this.familyMemberModel.findOne({
            where: {
              familyCode,
              memberId: { [Op.in]: counterpartIds },
              approveStatus: 'approved',
            } as any,
          }),
          this.userProfileModel.findOne({
            where: {
              userId: { [Op.in]: counterpartIds },
              familyCode,
            } as any,
          }),
          this.familyTreeModel.findOne({
            where: {
              familyCode,
              userId: { [Op.in]: counterpartIds },
            } as any,
          }),
        ]);

      return Boolean(counterpartMembership || counterpartProfile || counterpartTree);
    } catch (error) {
      console.error('Error checking spouse-linked access:', error);
      return false;
    }
  }

  private async assertAdminPreviewAllowed(userId: number): Promise<void> {
    const user = await this.userModel.findByPk(userId);
    if (!user || (user.role !== 2 && user.role !== 3)) {
      throw new ForbiddenException('Only admins can preview other families');
    }
  }

  /**
   * Safely parse age value to prevent NaN issues
   */
  private parseAge(age: any): number {
    if (age === null || age === undefined) {
      return 0;
    }

    const parsedAge = typeof age === 'number' ? age : Number.parseInt(age, 10);
    return Number.isNaN(parsedAge) ? 0 : parsedAge;
  }

  private parseAgeNullable(age: any): number | null {
    if (age === null || age === undefined) {
      return null;
    }

    if (typeof age === 'string') {
      const normalized = age.trim().toLowerCase();
      if (!normalized || normalized === 'null' || normalized === 'undefined') {
        return null;
      }
    }

    const parsedAge = typeof age === 'number' ? age : Number.parseInt(age, 10);
    return Number.isNaN(parsedAge) ? null : parsedAge;
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
  private splitName(fullName: string): {
    firstName: string;
    lastName: string | null;
  } {
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
    // A user can only have one "primary" familyCode (user_profile.familyCode) in this app.
    // Creating a new family therefore becomes a "switch primary family" operation when the
    // user already belongs to another family.
    const existingProfile = await this.userProfileModel.findOne({
      where: { userId: createdBy } as any,
      attributes: ['familyCode', 'associatedFamilyCodes', 'userId'],
    });
    const previousFamilyCodeRaw = (existingProfile as any)?.familyCode || null;
    const previousFamilyCode = previousFamilyCodeRaw
      ? String(previousFamilyCodeRaw).trim().toUpperCase()
      : null;

    const existing = await this.familyModel.findOne({
      where: { familyCode: dto.familyCode },
    });
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
    await this.userModel.update({ role: 2 }, { where: { id: createdBy } });

    // Create family
    const created = await this.familyModel.create({
      ...dto,
      createdBy,
    });

    // Ensure the creator has a single active membership row (the system historically assumes 1 row/user).
    // If they previously joined another family, this will remove that membership and replace it with the
    // new primary family membership.
    await this.familyMemberModel.destroy({ where: { memberId: createdBy } as any });

    // Add creator to family_member table as default approved member
    await this.familyMemberModel.create({
      memberId: createdBy,
      familyCode: created.familyCode,
      creatorId: null,
      approveStatus: 'approved',
    } as any);

    // Update user's UserProfile with familyCode
    await this.userProfileModel.update(
      { familyCode: created.familyCode },
      { where: { userId: createdBy } },
    );

    // Preserve previous primary family visibility by adding it to associatedFamilyCodes.
    // This helps users keep access/navigation after switching primary family.
    try {
      const nextFamilyCode = String(created.familyCode || '').trim().toUpperCase();
      if (previousFamilyCode && previousFamilyCode !== nextFamilyCode) {
        await this.relationshipEdgeService.updateAssociatedFamilyCodes(
          createdBy,
          previousFamilyCode,
        );
      }
    } catch (e) {
      // Non-fatal: family is created; association is a best-effort convenience.
      console.warn('Failed to preserve previous family association:', e?.message || e);
    }

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
      },
    };
  }

  async getAll() {
    return await this.familyModel.findAll();
  }

  async getByCode(code: string) {
    const family = await this.familyModel.findOne({
      where: { familyCode: code },
    });
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

    // Blocked users must not be allowed to edit family details.
    // This is Bug 65: enforce write-authorization at the backend.
    if (loggedId) {
      await this.assertUserNotBlockedInFamily(Number(loggedId), String(family.familyCode));
    }

    // Delete old file from S3 if a new file is uploaded
    if (
      newFileName &&
      family.familyPhoto &&
      family.familyPhoto !== newFileName
    ) {
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
      include: [
        {
          model: this.userModel,
          as: 'userProfile', // or change based on your association name
          where: {
            role: [2, 3],
          },
        },
      ],
    });

    if (!isAdmin) {
      throw new ForbiddenException('Only family admins can delete this family');
    }

    // Get all family members
    const members = await this.familyMemberModel.findAll({
      where: { familyCode },
    });
    const userIds = members.map((m) => m.memberId);

    // Delete all family members
    await this.familyMemberModel.destroy({ where: { familyCode } });

    // Delete the family
    await family.destroy();

    // Notify members
    if (userIds.length > 0) {
      await this.notificationService.createNotification(
        {
          type: 'FAMILY_REMOVED',
          title: 'Family Deleted',
          message: `The family (${family.familyName}) has been deleted by the admin.`,
          familyCode,
          referenceId: familyId,
          userIds,
        },
        userId,
      );
    }

    return { message: 'Family and its members deleted successfully' };
  }

  async searchFamilies(query: string) {
    return await this.familyModel.findAll({
      where: {
        [Op.or]: [
          { familyCode: { [Op.iLike]: `${query}%` } }, // starts with, case-insensitive
          { familyName: { [Op.iLike]: `%${query}%` } }, // contains, case-insensitive
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
    console.log(
      `🚀 Starting createFamilyTree for ${dto.familyCode} with ${dto.members?.length || 0
      } members`,
    );

    const { familyCode, members } = dto;

    const actorContext = await this.getActorContextForTreeSave(
      loggedInUserId,
      familyCode,
    );
    await this.assertFamilyExistsForTreeSave(familyCode);
    this.validateFamilyTreeSaveOrThrow(familyCode, members);

    await this.deleteStaleFamilyTreeEntriesAndCleanup({
      familyCode,
      members,
    });

    const memberIdsInTree = this.getMemberIdsInTree(members);
    console.log('✅ Members in tree:', memberIdsInTree);
    await this.syncFamilyMemberTableForTreeSave({
      familyCode,
      memberIdsInTree,
    });

    const createdMembers: any[] = [];
    const bulkContext = await this.buildCreateFamilyTreeBulkContext({
      familyCode,
      members,
    });
    const imageMap = await this.processFamilyTreeImages(members);

    await this.planAndCreateNonAppUsers({
      members,
      bulkContext,
    });

    await this.prepareBulkWritesFromMembers({
      familyCode,
      members,
      loggedInUserId,
      actorContext,
      bulkContext,
      imageMap,
      createdMembers,
    });

    await this.executeCreateFamilyTreeBulkWrites({
      bulkContext,
    });

    await this.createRelationshipEdgesFromFamilyTree(
      members.filter((m) => !(m as any).isExternalLinked),
      familyCode,
    );

    await this.repairFamilyTreeAfterMutation({ familyCode });
    await this.familyModel.increment('treeVersion', {
      by: 1,
      where: { familyCode } as any,
    });

    await this.ensureRelationshipCodesExist(members);

    const totalTime = Date.now() - startTime;
    console.log(
      `✅ Family tree sync completed successfully! Tree entries: ${createdMembers.length}`,
    );
    console.log(
      `⚡ Total operation time: ${totalTime}ms (${(totalTime / 1000).toFixed(
        2,
      )}s)`,
    );

    return {
      message: 'Family tree saved successfully',
      data: createdMembers,
      performanceStats: {
        totalTimeMs: totalTime,
        membersProcessed: members.length,
        avgTimePerMember: (totalTime / members.length).toFixed(2) + 'ms',
      },
    };
  }

  private async getActorContextForTreeSave(
    loggedInUserId: number,
    familyCode: string,
  ) {
    const actorUser = await this.userModel.findOne({
      where: { id: loggedInUserId },
      include: [
        {
          model: this.userProfileModel,
          as: 'userProfile',
          attributes: ['familyCode'],
        },
      ],
    });

    if (!actorUser) {
      throw new NotFoundException('Logged in user not found');
    }

    const actorFamilyCode = (actorUser as any).userProfile?.familyCode;
    const actorRole = actorUser.role;
    const actorIsAdmin = actorRole === 2 || actorRole === 3;

    await this.assertUserNotBlockedInFamily(loggedInUserId, familyCode);

    return { actorFamilyCode, actorRole, actorIsAdmin };
  }

  private async assertFamilyExistsForTreeSave(familyCode: string) {
    const family = await this.familyModel.findOne({ where: { familyCode } });
    if (!family) {
      throw new NotFoundException('Family not found');
    }
  }

  private normalizeTreeRelationIdsForValidation(list: any): number[] {
    const arr = Array.isArray(list) ? list : [];
    const seen = new Set<number>();
    const out: number[] = [];
    for (const raw of arr) {
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0 || seen.has(value)) {
        continue;
      }
      seen.add(value);
      out.push(value);
    }
    return out;
  }

  private getTreeValidationDisplayName(member: Partial<FamilyTreeMemberDto> | any, fallbackId?: number) {
    const name = String(member?.name || '').trim();
    if (name) {
      return name;
    }
    return fallbackId ? `Member #${fallbackId}` : 'This member';
  }

  private validateFamilyTreeSaveOrThrow(
    familyCode: string,
    members: FamilyTreeMemberDto[],
  ) {
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    if (!normalizedFamilyCode) {
      throw new BadRequestException('Family code is required to save the tree.');
    }
    if (!Array.isArray(members) || members.length === 0) {
      throw new BadRequestException('Add at least one member before saving the tree.');
    }

    const membersById = new Map<number, FamilyTreeMemberDto>();
    const adjacency = new Map<number, Set<number>>();
    const parentSets = new Map<number, Set<number>>();
    const nodeUidSet = new Set<string>();

    const ensureAdjacency = (id: number) => {
      if (!adjacency.has(id)) {
        adjacency.set(id, new Set<number>());
      }
      return adjacency.get(id)!;
    };

    const addUndirectedEdge = (a: number, b: number) => {
      if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) {
        return;
      }
      ensureAdjacency(a).add(b);
      ensureAdjacency(b).add(a);
    };

    const addParent = (childId: number, parentId: number) => {
      if (!parentSets.has(childId)) {
        parentSets.set(childId, new Set<number>());
      }
      parentSets.get(childId)!.add(parentId);
    };

    for (const member of members) {
      const personId = Number(member?.id || 0);
      if (!Number.isFinite(personId) || personId <= 0) {
        throw new BadRequestException('Every card in the tree must have a valid id before saving.');
      }
      if (membersById.has(personId)) {
        throw new BadRequestException('The tree contains duplicate cards. Refresh the tree and try saving again.');
      }
      membersById.set(personId, member);
      ensureAdjacency(personId);

      const nodeUid = String((member as any)?.nodeUid || '').trim();
      if (nodeUid) {
        if (nodeUidSet.has(nodeUid)) {
          throw new BadRequestException('Two tree cards share the same internal id. Refresh the tree and try again.');
        }
        nodeUidSet.add(nodeUid);
      }
    }

    const validateRefs = (
      member: FamilyTreeMemberDto,
      refs: number[],
      relationLabel: 'parent' | 'child' | 'spouse' | 'sibling',
      onValidRef?: (refId: number) => void,
    ) => {
      const personId = Number(member.id);
      const name = this.getTreeValidationDisplayName(member, personId);
      for (const refId of refs) {
        if (refId === personId) {
          throw new BadRequestException(`${name} cannot be connected to the same card.`);
        }
        if (!membersById.has(refId)) {
          throw new BadRequestException(`${name} has a ${relationLabel} link to a missing card. Refresh the tree and try again.`);
        }
        addUndirectedEdge(personId, refId);
        onValidRef?.(refId);
      }
    };

    for (const member of members) {
      const personId = Number(member.id);
      const parents = this.normalizeTreeRelationIdsForValidation(member.parents);
      const children = this.normalizeTreeRelationIdsForValidation(member.children);
      const spouses = this.normalizeTreeRelationIdsForValidation(member.spouses);
      const siblings = this.normalizeTreeRelationIdsForValidation(member.siblings);
      const isStructuralDummy =
        Boolean((member as any)?.isStructuralDummy) ||
        String((member as any)?.nodeType || '').trim() === 'structural_dummy';

      if (
        isStructuralDummy &&
        (Boolean((member as any)?.isExternalLinked) ||
          String((member as any)?.canonicalFamilyCode || '').trim() ||
          String((member as any)?.canonicalNodeUid || '').trim())
      ) {
        const name = this.getTreeValidationDisplayName(member, personId);
        throw new BadRequestException(`${name} is a removed placeholder and cannot also be saved as a linked card.`);
      }

      validateRefs(member, parents, 'parent', (parentId) => addParent(personId, parentId));
      validateRefs(member, children, 'child', (childId) => addParent(childId, personId));
      validateRefs(member, spouses, 'spouse');
      validateRefs(member, siblings, 'sibling');
    }

    const relationPairs = [
      { sourceKey: 'parents', targetKey: 'children', sourceLabel: 'parent', targetLabel: 'child' },
      { sourceKey: 'children', targetKey: 'parents', sourceLabel: 'child', targetLabel: 'parent' },
      { sourceKey: 'spouses', targetKey: 'spouses', sourceLabel: 'spouse', targetLabel: 'spouse' },
      { sourceKey: 'siblings', targetKey: 'siblings', sourceLabel: 'sibling', targetLabel: 'sibling' },
    ] as const;

    for (const member of members) {
      const personId = Number(member.id);
      const name = this.getTreeValidationDisplayName(member, personId);

      for (const pair of relationPairs) {
        const relatedIds = this.normalizeTreeRelationIdsForValidation((member as any)?.[pair.sourceKey]);
        for (const relatedId of relatedIds) {
          const relatedMember = membersById.get(relatedId);
          if (!relatedMember) {
            continue;
          }
          const relatedName = this.getTreeValidationDisplayName(relatedMember, relatedId);
          const reciprocalIds = this.normalizeTreeRelationIdsForValidation((relatedMember as any)?.[pair.targetKey]);
          if (!reciprocalIds.includes(personId)) {
            throw new BadRequestException(`${name} lists ${relatedName} as a ${pair.sourceLabel}, but ${relatedName} does not list ${name} as a ${pair.targetLabel}. Refresh the tree and try again.`);
          }
        }
      }
    }

    for (const [childId, parentIds] of parentSets.entries()) {
      if (parentIds.size <= 2) {
        continue;
      }
      const child = membersById.get(childId);
      const childName = this.getTreeValidationDisplayName(child, childId);
      throw new BadRequestException(`${childName} has more than two parents. Keep only the valid father and/or mother cards before saving.`);
    }

    if (membersById.size > 1) {
      const startId = Number(members[0]?.id);
      const queue: number[] = Number.isFinite(startId) ? [startId] : [];
      const visited = new Set<number>();

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) {
          continue;
        }
        visited.add(current);
        const neighbours = adjacency.get(current) || new Set<number>();
        neighbours.forEach((nextId) => {
          if (!visited.has(nextId)) {
            queue.push(nextId);
          }
        });
      }

      if (visited.size !== membersById.size) {
        const disconnectedId = Array.from(membersById.keys()).find((id) => !visited.has(id));
        const disconnectedMember = disconnectedId ? membersById.get(disconnectedId) : null;
        const disconnectedName = this.getTreeValidationDisplayName(
          disconnectedMember,
          disconnectedId || undefined,
        );
        throw new BadRequestException(`The tree has disconnected cards. ${disconnectedName} is not connected to the main family. Connect every card before saving.`);
      }
    }
  }

  private assertStructuralDummyCanBeDeletedPermanently(params: {
    treeEntry: any;
    totalNodes: number;
  }) {
    const totalNodes = Number(params?.totalNodes || 0);
    const treeEntry = params?.treeEntry;
    const children = this.normalizeTreeRelationIdsForValidation((treeEntry as any)?.children);

    if (totalNodes <= 1) {
      throw new BadRequestException('This empty slot is the last card in the tree. Replace it with a real member instead of clearing it.');
    }

    if (children.length > 0) {
      throw new BadRequestException('This empty slot still protects children or descendants. Replace it with a real member instead of clearing it.');
    }
  }

  private async deleteStaleFamilyTreeEntriesAndCleanup(params: {
    familyCode: string;
    members: FamilyTreeMemberDto[];
  }) {
    const { familyCode, members } = params;
    const personIdsInPayload = members.map((m) => m.id);
    console.log('📋 PersonIds in payload:', personIdsInPayload);
    console.log(
      `ℹ️ Skipping destructive tree pruning during save for ${familyCode}. Nodes omitted from the payload remain in the tree until an explicit delete converts them to structural dummies.`,
    );
  }

  private getMemberIdsInTree(members: FamilyTreeMemberDto[]): number[] {
    return members
      .filter(
        (member) =>
          member.memberId &&
          member.memberId !== null &&
          !(member as any).isExternalLinked,
      )
      .map((member) => Number(member.memberId));
  }

  private async cleanupRemovedMemberProfilesForTreeSave(params: {
    familyCode: string;
    removedMemberIds: number[];
  }) {
    const { familyCode, removedMemberIds } = params;
    const ids = Array.from(
      new Set(
        (removedMemberIds || [])
          .map(Number)
          .filter((x) => Number.isFinite(x) && x > 0),
      ),
    );
    if (ids.length === 0) return;

    const profiles = await this.userProfileModel.findAll({
      where: { userId: { [Op.in]: ids } as any },
      attributes: ['userId', 'familyCode', 'associatedFamilyCodes'],
    });

    await Promise.all(
      profiles.map(async (p: any) => {
        const associated = Array.isArray(p.associatedFamilyCodes)
          ? p.associatedFamilyCodes.filter(Boolean)
          : [];
        const nextAssociated = associated.filter(
          (code: any) =>
            String(code || '').trim() !== String(familyCode || '').trim(),
        );

        const shouldClearPrimary =
          String(p.familyCode || '').trim() === String(familyCode || '').trim();

        if (!shouldClearPrimary && nextAssociated.length === associated.length) {
          return;
        }

        await this.userProfileModel.update(
          {
            ...(shouldClearPrimary ? { familyCode: null } : {}),
            associatedFamilyCodes: nextAssociated,
          } as any,
          {
            where: { userId: Number(p.userId) } as any,
          },
        );
      }),
    );
  }

  private async syncFamilyMemberTableForTreeSave(params: {
    familyCode: string;
    memberIdsInTree: number[];
  }) {
    const { familyCode, memberIdsInTree } = params;
    console.log(
      `ℹ️ Skipping family_member/profile pruning during tree save for ${familyCode}. Active visibility is now derived from non-dummy tree nodes only. Payload member count: ${memberIdsInTree.length}.`,
    );
  }

  private async buildCreateFamilyTreeBulkContext(params: {
    familyCode: string;
    members: FamilyTreeMemberDto[];
  }) {
    const { familyCode, members } = params;
    const memberIds = members.filter((m) => m.memberId).map((m) => m.memberId);
    const nodeUidsInPayload = members
      .map((m) => (m.nodeUid ? String(m.nodeUid) : null))
      .filter((v): v is string => !!v);

    const existingEntries = await this.familyTreeModel.findAll({
      where: {
        familyCode,
        [Op.or]: [
          { personId: members.map((m) => m.id) },
          ...(nodeUidsInPayload.length > 0
            ? [{ nodeUid: { [Op.in]: nodeUidsInPayload } }]
            : []),
        ],
      },
    });

    const existingUsers =
      memberIds.length > 0
        ? await this.userModel.findAll({ where: { id: memberIds } })
        : [];

    const existingProfiles =
      memberIds.length > 0
        ? await this.userProfileModel.findAll({ where: { userId: memberIds } })
        : [];

    const existingFamilyMembers =
      memberIds.length > 0
        ? await this.familyMemberModel.findAll({
          where: { memberId: memberIds, familyCode },
        })
        : [];

    console.log(`📊 Performance stats:
      - Family tree entries: ${existingEntries.length}/${members.length}
      - Existing users: ${existingUsers.length}
      - Existing profiles: ${existingProfiles.length}
      - Existing family members: ${existingFamilyMembers.length}
    `);

    return {
      entriesToUpdate: [] as any[],
      entriesToCreate: [] as any[],
      profilesToUpdate: [] as any[],
      profilesToCreate: [] as any[],
      usersToCreate: [] as any[],
      familyMembersToCreate: [] as any[],
      newUserIndexMap: new Map<number, number>(),
      createdUsers: [] as any[],
      existingEntriesByPersonId: new Map(
        existingEntries.map((entry: any) => [entry.personId, entry]),
      ),
      existingEntriesByNodeUid: new Map(
        existingEntries.map((entry: any) => [String(entry?.nodeUid), entry]),
      ),
      existingUsersMap: new Map(existingUsers.map((user) => [user.id, user])),
      existingProfilesMap: new Map(
        existingProfiles.map((profile) => [profile.userId, profile]),
      ),
      existingFamilyMembersMap: new Map(
        existingFamilyMembers.map((fm) => [fm.memberId, fm]),
      ),
    };
  }

  private async processFamilyTreeImages(members: FamilyTreeMemberDto[]) {
    console.log('🖼️ Processing images in parallel...');
    const imageStartTime = Date.now();

    const imageProcessingPromises = members.map(async (member, index) => {
      if (member.img?.startsWith('data:image/')) {
        const uploadPath =
          process.env.PROFILE_PHOTO_UPLOAD_PATH || './uploads/profile';
        try {
          const processedImage = await saveBase64Image(member.img, uploadPath);
          return { index, image: processedImage };
        } catch (err) {
          console.error(`Error processing image for member ${index}:`, err);
          return { index, image: null };
        }
      }
      return { index, image: member.img };
    });

    const processedImages = await Promise.all(imageProcessingPromises);
    const imageMap = new Map(
      processedImages.map((item) => [item.index, item.image]),
    );

    console.log(
      `✅ Processed ${processedImages.length} images in ${Date.now() - imageStartTime
      }ms`,
    );
    return imageMap;
  }

  private async planAndCreateNonAppUsers(params: {
    members: FamilyTreeMemberDto[];
    bulkContext: any;
  }) {
    const { members, bulkContext } = params;

    for (let memberIndex = 0; memberIndex < members.length; memberIndex++) {
      const member = members[memberIndex];
      if ((member as any).isExternalLinked) {
        continue;
      }
      let userId = member.memberId;
      if (userId) {
        const existingUser = bulkContext.existingUsersMap.get(userId);
        if (!existingUser) {
          userId = null;
        }
      }

      if (!userId) {
        bulkContext.usersToCreate.push({
          email: null,
          countryCode: null,
          mobile: null,
          status: 1,
          role: 1,
          isAppUser: false,
        });
        bulkContext.newUserIndexMap.set(
          memberIndex,
          bulkContext.usersToCreate.length - 1,
        );
      }
    }

    if (bulkContext.usersToCreate.length > 0) {
      const userStartTime = Date.now();
      console.log(
        `👥 Creating ${bulkContext.usersToCreate.length} new users in bulk...`,
      );
      bulkContext.createdUsers = await this.userModel.bulkCreate(
        bulkContext.usersToCreate,
      );
      console.log(
        `✅ Created ${bulkContext.createdUsers.length} users in ${Date.now() - userStartTime
        }ms`,
      );
    }
  }

  private async prepareBulkWritesFromMembers(params: {
    familyCode: string;
    members: FamilyTreeMemberDto[];
    loggedInUserId: number;
    actorContext: any;
    bulkContext: any;
    imageMap: Map<number, any>;
    createdMembers: any[];
  }) {
    const {
      familyCode,
      members,
      loggedInUserId,
      actorContext,
      bulkContext,
      imageMap,
      createdMembers,
    } = params;

    for (let memberIndex = 0; memberIndex < members.length; memberIndex++) {
      const member = members[memberIndex];
      let userId = member.memberId;

      const newUserIndex = bulkContext.newUserIndexMap.get(memberIndex);
      if (newUserIndex !== undefined) {
        userId = bulkContext.createdUsers[newUserIndex].id;
      }

      const existingEntry =
        (member.nodeUid
          ? bulkContext.existingEntriesByNodeUid.get(String(member.nodeUid))
          : null) || bulkContext.existingEntriesByPersonId.get(member.id);

      const incomingIsStructuralDummy =
        Boolean((member as any).isStructuralDummy) ||
        String((member as any).nodeType || '').trim() === 'structural_dummy';

      if (Boolean(existingEntry?.isStructuralDummy) && !incomingIsStructuralDummy) {
        throw new ConflictException(
          `Tree has changed for person ${member.id}. Please refresh before saving.`,
        );
      }

      const isStructuralDummy =
        Boolean(existingEntry?.isStructuralDummy) || incomingIsStructuralDummy;
      const isExternalLinked =
        !isStructuralDummy &&
        (Boolean(member.isExternalLinked) || Boolean(existingEntry?.isExternalLinked));

      if (Boolean(existingEntry?.isExternalLinked) && !member.isExternalLinked) {
        member.isExternalLinked = true;
      }

      if (Boolean(existingEntry?.isStructuralDummy)) {
        userId = Number(existingEntry?.userId || 0) || userId;
      }

      const existingUserProfile = userId
        ? bulkContext.existingProfilesMap.get(userId)
        : null;
      const resolvedPrimaryFamilyCode = String(
        existingUserProfile?.familyCode || '',
      )
        .trim()
        .toUpperCase();
      const resolvedNodeType = isStructuralDummy
        ? 'structural_dummy'
        : isExternalLinked
          ? 'linked'
          : resolvedPrimaryFamilyCode &&
              resolvedPrimaryFamilyCode !== String(familyCode || '').trim().toUpperCase()
            ? 'associated'
            : 'birth';

      if (userId && member.memberId && !isExternalLinked && !isStructuralDummy) {
        const existingUser = bulkContext.existingUsersMap.get(userId);
        if (existingUser) {
          const profileImage = imageMap.get(memberIndex);

          const isAppUser = Boolean((existingUser as any).isAppUser);
          const isSelf = userId === loggedInUserId;
          const sameFamilyAsActor = Boolean(
            actorContext.actorFamilyCode &&
            familyCode &&
            actorContext.actorFamilyCode === familyCode,
          );
          const canUpdateProfile =
            isSelf ||
            (!isAppUser && actorContext.actorIsAdmin && sameFamilyAsActor);

          const userProfile = bulkContext.existingProfilesMap.get(userId);
          if (canUpdateProfile) {
            if (userProfile) {
              const { firstName, lastName } = this.splitName(member.name);
              const parsedAge = this.parseAgeNullable(member.age);
              const updateData: any = {
                firstName: firstName,
                lastName: lastName,
                gender: member.gender,
              };
              if (parsedAge !== null) {
                updateData.age = parsedAge;
              }
              if (profileImage) {
                updateData.profile = profileImage;
              }
              bulkContext.profilesToUpdate.push({
                id: userProfile.id,
                ...updateData,
              });
            } else {
              const { firstName, lastName } = this.splitName(member.name);
              const parsedAge = this.parseAgeNullable(member.age);
              bulkContext.profilesToCreate.push({
                userId: userId,
                firstName: firstName,
                lastName: lastName,
                gender: member.gender,
                age: parsedAge,
                profile: profileImage,
                familyCode: familyCode,
              });
            }
          }

          const existingMember = bulkContext.existingFamilyMembersMap.get(userId);
          if (!existingMember) {
            bulkContext.familyMembersToCreate.push({
              memberId: userId,
              familyCode: familyCode,
              creatorId: null,
              approveStatus: 'approved',
            });
          }
        }
      }

      if (userId && bulkContext.newUserIndexMap.has(memberIndex) && !isExternalLinked && !isStructuralDummy) {
        const profileImage = imageMap.get(memberIndex);
        const { firstName, lastName } = this.splitName(member.name);
        const parsedAge = this.parseAgeNullable(member.age);
        bulkContext.profilesToCreate.push({
          userId: userId,
          firstName: firstName,
          lastName: lastName,
          gender: member.gender,
          age: parsedAge,
          profile: profileImage,
          familyCode: familyCode,
        });
        bulkContext.familyMembersToCreate.push({
          memberId: userId,
          familyCode: familyCode,
          creatorId: null,
          approveStatus: 'approved',
        });
      }

      const entryData = {
        familyCode,
        userId,
        personId: member.id,
        nodeUid: member.nodeUid || existingEntry?.nodeUid,
        isStructuralDummy: isStructuralDummy,
        nodeType: resolvedNodeType,
        isExternalLinked: isExternalLinked,
        canonicalFamilyCode: isExternalLinked
          ? member.canonicalFamilyCode || existingEntry?.canonicalFamilyCode || null
          : null,
        canonicalNodeUid: isExternalLinked
          ? member.canonicalNodeUid || existingEntry?.canonicalNodeUid || null
          : null,
        generation: member.generation,
        lifeStatus: member.lifeStatus ?? 'living',
        parents: Array.isArray(member.parents)
          ? member.parents
          : Array.from(member.parents || []).map(Number),
        children: Array.isArray(member.children)
          ? member.children
          : Array.from(member.children || []).map(Number),
        spouses: Array.isArray(member.spouses)
          ? member.spouses
          : Array.from(member.spouses || []).map(Number),
        siblings: Array.isArray(member.siblings)
          ? member.siblings
          : Array.from(member.siblings || []).map(Number),
      };

      try {
        if (existingEntry) {
          bulkContext.entriesToUpdate.push({
            id: existingEntry.id,
            ...entryData,
          });
          createdMembers.push({
            id: existingEntry.id,
            userId,
            personId: member.id,
            nodeUid: entryData.nodeUid,
            isExternalLinked: entryData.isExternalLinked,
            canonicalFamilyCode: entryData.canonicalFamilyCode,
            canonicalNodeUid: entryData.canonicalNodeUid,
            name: member.name,
            generation: member.generation,
            parents: entryData.parents,
            children: entryData.children,
            spouses: entryData.spouses,
            siblings: entryData.siblings,
            lifeStatus: entryData.lifeStatus,
          });
        } else {
          bulkContext.entriesToCreate.push(entryData);
          createdMembers.push({
            id: null,
            userId,
            personId: member.id,
            nodeUid: entryData.nodeUid,
            isExternalLinked: entryData.isExternalLinked,
            canonicalFamilyCode: entryData.canonicalFamilyCode,
            canonicalNodeUid: entryData.canonicalNodeUid,
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
  }

  private async executeCreateFamilyTreeBulkWrites(params: { bulkContext: any }) {
    const { bulkContext } = params;
    const totalStartTime = Date.now();
    console.log(`📊 Bulk operations summary:
      - Family tree entries: ${bulkContext.entriesToUpdate.length} updates, ${bulkContext.entriesToCreate.length} creates
      - User profiles: ${bulkContext.profilesToUpdate.length} updates, ${bulkContext.profilesToCreate.length} creates
      - Family members: ${bulkContext.familyMembersToCreate.length} creates
    `);

    if (bulkContext.profilesToUpdate.length > 0) {
      const startTime = Date.now();
      await Promise.all(
        bulkContext.profilesToUpdate.map((profile) =>
          this.userProfileModel.update(
            {
              firstName: profile.firstName,
              lastName: profile.lastName,
              gender: profile.gender,
              ...(profile.age === undefined ? {} : { age: profile.age }),
              ...(profile.profile && { profile: profile.profile }),
            },
            {
              where: { id: profile.id },
            },
          ),
        ),
      );
      console.log(
        `✅ Bulk updated ${bulkContext.profilesToUpdate.length} profiles in ${Date.now() - startTime
        }ms`,
      );
    }

    if (bulkContext.profilesToCreate.length > 0) {
      const startTime = Date.now();
      await this.userProfileModel.bulkCreate(bulkContext.profilesToCreate);
      console.log(
        `✅ Bulk created ${bulkContext.profilesToCreate.length} profiles in ${Date.now() - startTime
        }ms`,
      );
    }

    if (bulkContext.familyMembersToCreate.length > 0) {
      const startTime = Date.now();
      await this.familyMemberModel.bulkCreate(bulkContext.familyMembersToCreate);
      console.log(
        `✅ Bulk created ${bulkContext.familyMembersToCreate.length} family members in ${Date.now() - startTime
        }ms`,
      );
    }

    if (bulkContext.entriesToUpdate.length > 0) {
      const startTime = Date.now();
      await Promise.all(
        bulkContext.entriesToUpdate.map((entry) =>
          this.familyTreeModel.update(
            {
              userId: entry.userId,
              nodeUid: entry.nodeUid,
              isStructuralDummy: entry.isStructuralDummy,
              nodeType: entry.nodeType,
              isExternalLinked: entry.isExternalLinked,
              canonicalFamilyCode: entry.canonicalFamilyCode,
              canonicalNodeUid: entry.canonicalNodeUid,
              generation: entry.generation,
              lifeStatus: entry.lifeStatus,
              parents: entry.parents,
              children: entry.children,
              spouses: entry.spouses,
              siblings: entry.siblings,
            },
            {
              where: { id: entry.id },
            },
          ),
        ),
      );
      console.log(
        `✅ Bulk updated ${bulkContext.entriesToUpdate.length} family tree entries in ${Date.now() - startTime
        }ms`,
      );
    }

    if (bulkContext.entriesToCreate.length > 0) {
      const startTime = Date.now();
      await this.familyTreeModel.bulkCreate(bulkContext.entriesToCreate);
      console.log(
        `✅ Bulk created ${bulkContext.entriesToCreate.length} family tree entries in ${Date.now() - startTime
        }ms`,
      );
    }

    console.log(
      `⚡ Total bulk operations completed in ${Date.now() - totalStartTime}ms`,
    );
  }

  private async ensureRelationshipCodesExist(members: FamilyTreeMemberDto[]) {
    const allCodes = new Set<string>();
    for (const member of members) {
      if (member.relationshipCode) {
        const trimmedCode = String(member.relationshipCode).trim();
        if (trimmedCode) {
          allCodes.add(trimmedCode);
        }
      }
    }
    const codesArray = Array.from(allCodes);
    if (codesArray.length === 0) {
      return;
    }
    const existing = await Relationship.findAll({
      where: { key: codesArray },
    });
    const existingKeys = new Set(existing.map((r) => r.key));
    const missingCodes = codesArray.filter((code) => !existingKeys.has(code));
    if (missingCodes.length === 0) {
      return;
    }
    await Relationship.bulkCreate(
      missingCodes.map((code) => ({
        key: code,
        description: code,
        is_auto_generated: true,
      })),
      {
        ignoreDuplicates: true,
      },
    );
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
          },
        ],
        where: {
          userId: { [Op.ne]: null }, // Only check non-null userIds
        },
      });

      // Filter out records where the user doesn't exist
      const recordsToFix = invalidUserIds.filter((record) => !record.user);

      if (recordsToFix.length > 0) {
        const userIdsToFix = recordsToFix.map((record) => record.userId);

        // Update invalid userId references to NULL
        const result = await this.familyTreeModel.update(
          { userId: null },
          {
            where: {
              userId: { [Op.in]: userIdsToFix },
            },
          },
        );

        console.log(
          `Cleaned up ${result[0]} records with invalid userId references`,
        );
        return result[0];
      }

      console.log('No invalid userId data found to clean up');
      return 0;
    } catch (error) {
      console.error('Error cleaning up userId data:', error);
      throw error;
    }
  }

  async getTreeLinkCandidates(familyCode: string, actingUserId: number) {
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();

    if (!normalizedFamilyCode) {
      throw new BadRequestException('familyCode is required');
    }
    if (!actingUserId) {
      throw new ForbiddenException('Unauthorized');
    }

    const actingUser = await this.userModel.findByPk(actingUserId, {
      attributes: ['id', 'status'],
    });
    if (!actingUser || Number((actingUser as any).status) !== 1) {
      throw new ForbiddenException('Unauthorized');
    }

    const familyRecord = await this.familyModel.findOne({
      where: { familyCode: normalizedFamilyCode } as any,
      attributes: ['familyCode', 'treeVersion'],
    });

    if (!familyRecord) {
      return {
        message: 'Family not found',
        treeVersion: 0,
        people: [],
      };
    }

    const actingProfile = await this.userProfileModel.findOne({
      where: { userId: actingUserId },
      attributes: ['userId', 'familyCode'],
    });
    const actingFamilyCode = String((actingProfile as any)?.familyCode || '').trim().toUpperCase();
    if (actingFamilyCode && actingFamilyCode === normalizedFamilyCode) {
      return {
        message: 'Link Tree works only between different families. Choose another family code.',
        treeVersion: Number((familyRecord as any)?.treeVersion || 0),
        people: [],
      };
    }

    await this.cleanupInvalidUserIdData();

    const aggregate = await this.treeProjectionService.getFamilyAggregate(normalizedFamilyCode, {
      requestingUserId: actingUserId,
      includeAdminQueue: false,
    });

    const seenNodeUids = new Set<string>();
    const people = (aggregate?.people || [])
      .filter((node) => {
        if (!node || node.isStructuralDummy || node.isExternalLinked || !node.isAppUser) {
          return false;
        }

        const primaryFamilyCode = String(
          node?.primaryFamilyCode || node?.sourceFamilyCode || node?.familyCode || '',
        )
          .trim()
          .toUpperCase();
        const treeFamilyCode = String(node?.treeFamilyCode || node?.familyCode || '')
          .trim()
          .toUpperCase();
        const nodeUid = String(node?.nodeUid || '').trim();

        if (
          !nodeUid ||
          primaryFamilyCode !== normalizedFamilyCode ||
          treeFamilyCode !== normalizedFamilyCode ||
          seenNodeUids.has(nodeUid)
        ) {
          return false;
        }

        seenNodeUids.add(nodeUid);
        return true;
      })
      .sort((a, b) => {
        const nameCompare = String(a?.name || '').localeCompare(String(b?.name || ''));
        if (nameCompare !== 0) {
          return nameCompare;
        }
        return Number(a?.personId || 0) - Number(b?.personId || 0);
      });

    return {
      message: people.length
        ? 'Link candidates fetched successfully'
        : 'No members are available to link from this family right now.',
      treeVersion: aggregate.treeVersion,
      people,
    };
  }
  async getFamilyTree(
    familyCode: string,
    userId?: number,
    allowAdminPreview: boolean = false,
  ) {
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    if (userId) {
      await this.assertUserCanViewFamilyTree(
        userId,
        normalizedFamilyCode,
        allowAdminPreview,
      );
    }

    await this.cleanupInvalidUserIdData();

    const aggregate = await this.treeProjectionService.getFamilyAggregate(normalizedFamilyCode, {
      requestingUserId: userId,
      includeAdminQueue: false,
    });

    if (!aggregate.people.length) {
      return {
        message: 'Family tree not created yet',
        treeVersion: aggregate.treeVersion,
        people: [],
        nodes: [],
        projection: aggregate.projection,
      };
    }

    return {
      message: 'Family tree retrieved successfully',
      treeVersion: aggregate.treeVersion,
      people: aggregate.people,
      nodes: aggregate.nodes,
      projection: aggregate.projection,
    };
  }

  async ensureRelationshipCodeExists(universalCode: string) {
    // Check if the code exists
    const exists = await Relationship.findOne({
      where: { key: universalCode },
    });
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
    const relationships =
      await this.relationshipEdgeService.getUserRelationships(userId);

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
            name: user1Profile
              ? `${user1Profile.firstName} ${user1Profile.lastName}`.trim()
              : 'Unknown',
          },
          user2: {
            id: rel.user2Id,
            name: user2Profile
              ? `${user2Profile.firstName} ${user2Profile.lastName}`.trim()
              : 'Unknown',
          },
          relationshipType: rel.relationshipType,
          generatedFamilyCode: rel.generatedFamilyCode,
          createdAt: rel.createdAt,
        };
      }),
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

    const blockedFamilyCodes = await this.getBlockedFamilyCodesForUser(userId);
    const userProfile = await this.getUserProfileForAssociatedTree(userId);

    const relationships =
      await this.relationshipEdgeService.getUserRelationships(userId);

    const allFamilyCodes = this.collectAssociatedFamilyCodes({
      userProfile,
      blockedFamilyCodes,
      relationships,
    });

    if (allFamilyCodes.size === 0) {
      throw new NotFoundException(
        'No associated family trees found for this user',
      );
    }

    const familyTreeEntries = await this.fetchFamilyTreeEntriesForFamilyCodes(
      allFamilyCodes,
    );

    const allPeople = this.buildUnifiedPeopleMap({
      familyTreeEntries,
      relationships,
    });

    this.addRelationshipConnectionsToUnifiedPeople(allPeople, relationships);

    // Fix generation inconsistencies before returning
    this.fixGenerationConsistency(allPeople);

    const people = this.serializeUnifiedPeople(allPeople);

    return {
      message: 'Associated family tree retrieved successfully',
      rootUserId: userId,
      familyCodes: Array.from(allFamilyCodes),
      people,
      totalConnections: relationships.length,
    };
  }

  private async getBlockedFamilyCodesForUser(userId: number): Promise<Set<string>> {
    // BLOCK OVERRIDE: Family-member blocked-family filtering removed with legacy columns.
    void userId;
    return new Set<string>();
  }

  private async getUserProfileForAssociatedTree(userId: number): Promise<any> {
    const userProfile = await this.userProfileModel.findOne({
      where: { userId },
      include: [{ model: this.userModel, as: 'user' }],
    });
    if (!userProfile) {
      throw new NotFoundException('User profile not found');
    }
    return userProfile;
  }

  private collectAssociatedFamilyCodes(params: {
    userProfile: any;
    blockedFamilyCodes: Set<string>;
    relationships: any[];
  }): Set<string> {
    const { userProfile, blockedFamilyCodes, relationships } = params;
    const allFamilyCodes = new Set<string>();

    if (userProfile.familyCode && !blockedFamilyCodes.has(userProfile.familyCode)) {
      allFamilyCodes.add(userProfile.familyCode);
    }

    if (userProfile.associatedFamilyCodes && Array.isArray(userProfile.associatedFamilyCodes)) {
      userProfile.associatedFamilyCodes.forEach((code) => {
        if (code && !code.startsWith('REL_') && !blockedFamilyCodes.has(code)) {
          allFamilyCodes.add(code);
        }
      });
    }

    for (const rel of relationships) {
      if (
        rel.generatedFamilyCode &&
        !rel.generatedFamilyCode.startsWith('REL_') &&
        !blockedFamilyCodes.has(rel.generatedFamilyCode)
      ) {
        allFamilyCodes.add(rel.generatedFamilyCode);
      }
    }

    return allFamilyCodes;
  }

  private async fetchFamilyTreeEntriesForFamilyCodes(allFamilyCodes: Set<string>) {
    return this.familyTreeModel.findAll({
      where: {
        familyCode: { [Op.in]: Array.from(allFamilyCodes) },
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
  }

  private buildUnifiedPeopleMap(params: { familyTreeEntries: any[]; relationships: any[] }) {
    const { familyTreeEntries } = params;

    const allPeople = new Map<string, any>();
    const personKeyByFamilyPersonId = new Map<string, string>();
    for (const entry of familyTreeEntries) {
      const familyCode = String((entry as any).familyCode || '');
      const personId = Number((entry as any).personId);
      if (!familyCode || !personId) continue;

      const key = (entry as any).userId
        ? `user_${Number((entry as any).userId)}`
        : `fp_${familyCode}_${personId}`;

      personKeyByFamilyPersonId.set(`${familyCode}:${personId}`, key);
    }

    const uniqueIdByKey = new Map<string, number>();
    let nextUniqueId = 1;
    const getOrCreateUniqueId = (key: string): number => {
      const existing = uniqueIdByKey.get(key);
      if (existing) return existing;
      const created = nextUniqueId;
      nextUniqueId += 1;
      uniqueIdByKey.set(key, created);
      return created;
    };

    const baseUrl = process.env.BASE_URL || '';
    const profilePhotoPath =
      process.env.PROFILE_PHOTO_UPLOAD_PATH?.replace(/^\.\/?/, '') ||
      'uploads/profile';

    for (const entry of familyTreeEntries) {
      const entryFamilyCode = String((entry as any).familyCode || '');
      const entryPersonId = Number((entry as any).personId);
      const personKey = (entry as any).userId
        ? `user_${Number((entry as any).userId)}`
        : `fp_${entryFamilyCode}_${entryPersonId}`;

      const personUniqueId = getOrCreateUniqueId(personKey);

      const mapRelIds = (relIds: any): number[] => {
        const ids = Array.isArray(relIds) ? relIds : [];
        return ids
          .map((raw) => {
            const relPersonId = Number(raw);
            if (!relPersonId) return null;
            const relKey =
              personKeyByFamilyPersonId.get(
                `${entryFamilyCode}:${relPersonId}`,
              ) || `fp_${entryFamilyCode}_${relPersonId}`;
            return getOrCreateUniqueId(relKey);
          })
          .filter((x): x is number => x !== null);
      };

      if (allPeople.has(personKey)) {
        const existing = allPeople.get(personKey);
        existing.parents = new Set([
          ...existing.parents,
          ...mapRelIds((entry as any).parents),
        ]);
        existing.children = new Set([
          ...existing.children,
          ...mapRelIds((entry as any).children),
        ]);
        existing.spouses = new Set([
          ...existing.spouses,
          ...mapRelIds((entry as any).spouses),
        ]);
        existing.siblings = new Set([
          ...existing.siblings,
          ...mapRelIds((entry as any).siblings),
        ]);

        if (!existing.memberId && (entry as any).userId) {
          existing.memberId = (entry as any).userId;
          existing.userId = (entry as any).userId;
        }

        if (!existing.familyCode) {
          const userProfile = entry.user?.userProfile;
          existing.familyCode = userProfile?.familyCode || entry.familyCode;
        }

        if (entry.user?.userProfile?.associatedFamilyCodes) {
          const current = Array.isArray(existing.associatedFamilyCodes)
            ? existing.associatedFamilyCodes
            : [];
          const extra = Array.isArray(entry.user.userProfile.associatedFamilyCodes)
            ? entry.user.userProfile.associatedFamilyCodes
            : [];
          existing.associatedFamilyCodes = Array.from(new Set([...current, ...extra]));
        }
        continue;
      }

      let personData;
      if ((entry as any).userId) {
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
          id: personUniqueId,
          memberId: (entry as any).userId,
          userId: (entry as any).userId,
          name: userProfile
            ? `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim()
            : 'Unknown',
          gender: this.normalizeGender(userProfile?.gender),
          age: userProfile?.age || null,
          generation: entry.generation,
          parents: new Set(mapRelIds((entry as any).parents)),
          children: new Set(mapRelIds((entry as any).children)),
          spouses: new Set(mapRelIds((entry as any).spouses)),
          siblings: new Set(mapRelIds((entry as any).siblings)),
          img: img,
          associatedFamilyCodes: userProfile?.associatedFamilyCodes || [],
          familyCode: userProfile?.familyCode || entry.familyCode,
          isManual: false,
        };
      } else {
        personData = {
          id: personUniqueId,
          memberId: null,
          name: 'Unknown',
          gender: 'unknown',
          age: null,
          generation: entry.generation,
          parents: new Set(mapRelIds((entry as any).parents)),
          children: new Set(mapRelIds((entry as any).children)),
          spouses: new Set(mapRelIds((entry as any).spouses)),
          siblings: new Set(mapRelIds((entry as any).siblings)),
          img: null,
          associatedFamilyCodes: [],
          familyCode: entry.familyCode,
          isManual: false,
        };
      }

      allPeople.set(personKey, personData);
    }

    return allPeople;
  }

  private addRelationshipConnectionsToUnifiedPeople(allPeople: Map<string, any>, relationships: any[]) {
    for (const rel of relationships) {
      const person1Key = `user_${rel.user1Id}`;
      const person2Key = `user_${rel.user2Id}`;

      if (!(allPeople.has(person1Key) && allPeople.has(person2Key))) {
        continue;
      }

      const person1 = allPeople.get(person1Key);
      const person2 = allPeople.get(person2Key);

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

  private serializeUnifiedPeople(allPeople: Map<string, any>) {
    return Array.from(allPeople.values()).map((person) => ({
      ...person,
      parents: Array.from(person.parents),
      children: Array.from(person.children),
      spouses: Array.from(person.spouses),
      siblings: Array.from(person.siblings),
    }));
  }

  /**
   * Fix generation inconsistencies in family tree data
   */
  private fixGenerationConsistency(allPeople: Map<any, any>): void {
    // Convert to array for easier processing
    const people = Array.from(allPeople.values());

    // Find root people (those without parents)
    const rootPeople = people.filter(
      (person) => !person.parents || person.parents.size === 0,
    );

    // If no clear root, use the oldest person or generation 0 people
    if (rootPeople.length === 0) {
      const gen0People = people.filter((person) => person.generation === 0);
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
    rootPeople.forEach((rootPerson) => {
      rootPerson.generation = 0;
      queue.push({ person: rootPerson, generation: 0 });
      visited.add(rootPerson.id);
    });

    // BFS to assign generations
    while (queue.length > 0) {
      const { person, generation } = queue.shift();

      // Process spouses (same generation)
      if (person.spouses) {
        person.spouses.forEach((spouseId) => {
          const spouse = people.find((p) => p.id === spouseId);
          if (spouse && !visited.has(spouse.id)) {
            spouse.generation = generation;
            queue.push({ person: spouse, generation });
            visited.add(spouse.id);
            console.log(
              `🔧 Set spouse ${spouse.name} to generation ${generation}`,
            );
          }
        });
      }

      // Process children (next generation)
      if (person.children) {
        person.children.forEach((childId) => {
          const child = people.find((p) => p.id === childId);
          if (child && !visited.has(child.id)) {
            child.generation = generation + 1;
            queue.push({ person: child, generation: generation + 1 });
            visited.add(child.id);
            console.log(
              `🔧 Set child ${child.name} to generation ${generation + 1}`,
            );
          }
        });
      }

      // Process siblings (same generation)
      if (person.siblings) {
        person.siblings.forEach((siblingId) => {
          const sibling = people.find((p) => p.id === siblingId);
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
      where: { familyCode, userId: { [Op.not]: null } },
    });

    if (!familyEntry?.userId) {
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
        transaction,
      });

      // Find all family tree entries for this user
      const allEntries = await this.familyTreeModel.findAll({
        where: { userId },
        transaction,
      });

      // Update each entry if needed (e.g., generation changes)
      for (const entry of allEntries) {
        if (updates.generation !== undefined) {
          await entry.update(
            { generation: updates.generation },
            { transaction },
          );
        }
      }

      if (updates.generation !== undefined) {
        const familyCodes = Array.from(
          new Set(
            (allEntries as any[])
              .map((e: any) => String(e?.familyCode || '').trim().toUpperCase())
              .filter((c) => !!c),
          ),
        );

        await Promise.all(
          familyCodes.map((familyCode) =>
            repairFamilyTreeIntegrity({
              familyCode,
              transaction,
              lock: true,
              fixExternalGenerations: true,
            }),
          ),
        );
      }

      await transaction.commit();

      return {
        message: 'Person data synced across all trees',
        updatedTrees: allEntries.length,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Create manual associated tree for a user
   */
  async createManualAssociatedTree(
    userId: number,
    familyCode: string,
    basicInfo: any,
  ) {
    const transaction = await this.familyTreeModel.sequelize.transaction();

    try {
      // Create family entry
      await this.familyModel.create(
        {
          familyCode,
          familyName: basicInfo.familyName || `${basicInfo.name}'s Family`,
          createdBy: userId,
        },
        { transaction },
      );

      // Add person to family tree
      await this.familyTreeModel.create(
        {
          familyCode,
          userId,
          personId: 1, // Root person in this tree
          generation: 0,
        },
        { transaction },
      );

      await repairFamilyTreeIntegrity({
        familyCode,
        transaction,
        lock: true,
        fixExternalGenerations: true,
      });

      // Update user's associated family codes
      await this.relationshipEdgeService.updateAssociatedFamilyCodes(
        userId,
        familyCode,
        transaction,
      );

      await transaction.commit();

      return {
        message: 'Manual associated tree created successfully',
        familyCode,
        isManual: true,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Replace manual tree with auto-generated complete tree
   */
  async replaceManualTreeWithComplete(
    oldFamilyCode: string,
    newCompleteTreeData: any,
  ) {
    const transaction = await this.familyTreeModel.sequelize.transaction();

    try {
      // Get all users who had the old family code in their associated codes
      const affectedUsers = await this.userProfileModel.findAll({
        where: {
          associatedFamilyCodes: { [Op.contains]: [oldFamilyCode] },
        },
        transaction,
      });

      // Create new complete tree
      const newFamilyCode = newCompleteTreeData.familyCode;

      // Update all affected users' associated codes
      for (const user of affectedUsers) {
        const updatedCodes = user.associatedFamilyCodes.map((code) =>
          code === oldFamilyCode ? newFamilyCode : code,
        );

        await user.update(
          {
            associatedFamilyCodes: updatedCodes,
          },
          { transaction },
        );
      }

      // Delete old manual tree
      await this.familyTreeModel.destroy({
        where: { familyCode: oldFamilyCode },
        transaction,
      });

      await this.familyModel.destroy({
        where: { familyCode: oldFamilyCode },
        transaction,
      });

      await transaction.commit();

      return {
        message: 'Manual tree replaced with complete tree successfully',
        oldFamilyCode,
        newFamilyCode,
        affectedUsers: affectedUsers.length,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async addSpouseRelationship(yourUserId: number, spouseUserId: number) {
    // Fetch spouse profile
    const spouseProfile = await this.userProfileModel.findOne({
      where: { userId: spouseUserId },
    });
    const spouseMembership = await this.familyMemberModel.findOne({
      where: {
        memberId: spouseUserId,
        approveStatus: 'approved',
      } as any,
      order: [['id', 'DESC']],
    });
    const spouseFamilyCode =
      spouseProfile?.familyCode || spouseMembership?.familyCode || null;
    const spouseHasFamilyCode = Boolean(spouseFamilyCode);

    // Create relationship edge
    const { generatedFamilyCode } =
      await this.relationshipEdgeService.createRelationshipEdge(
        yourUserId,
        spouseUserId,
        'spouse',
      );

    // Add REL_... code to both users
    await this.relationshipEdgeService.updateAssociatedFamilyCodes(
      yourUserId,
      generatedFamilyCode,
    );
    await this.relationshipEdgeService.updateAssociatedFamilyCodes(
      spouseUserId,
      generatedFamilyCode,
    );

    // If spouse has a family code, add it to your associated codes
    if (spouseHasFamilyCode) {
      await this.relationshipEdgeService.updateAssociatedFamilyCodes(
        yourUserId,
        spouseFamilyCode,
      );
    }

    // Optionally, add your family code to spouse's associated codes
    const yourProfile = await this.userProfileModel.findOne({
      where: { userId: yourUserId },
    });
    const yourMembership = await this.familyMemberModel.findOne({
      where: {
        memberId: yourUserId,
        approveStatus: 'approved',
      } as any,
      order: [['id', 'DESC']],
    });
    const yourFamilyCode =
      yourProfile?.familyCode || yourMembership?.familyCode || null;
    if (yourFamilyCode) {
      await this.relationshipEdgeService.updateAssociatedFamilyCodes(
        spouseUserId,
        yourFamilyCode,
      );
    }

    // Sync spouse data across all their trees
    await this.syncPersonAcrossAllTrees(spouseUserId, {
      maritalStatus: 'married',
    });
    await this.syncPersonAcrossAllTrees(yourUserId, {
      maritalStatus: 'married',
    });

    return {
      message: 'Spouse relationship created and associated codes updated',
      generatedFamilyCode,
      yourUserId,
      spouseUserId,
    };
  }

  private async createRelationshipEdgesFromFamilyTree(
    members: FamilyTreeMemberDto[],
    familyCode: string,
  ) {
    // Create a map of personId to userId for easy lookup
    const personIdToUserIdMap = new Map<number, number>();
    members.forEach((member) => {
      if (member.memberId) {
        personIdToUserIdMap.set(member.id, member.memberId);
      }
    });

    for (const member of members) {
      const userId = member.memberId;
      if (!userId) continue; // Skip if no userId

      // Create spouse relationships
      if (member.spouses && member.spouses.length > 0) {
        await this.createEdgesForRelationType({
          sourceUserId: userId,
          targetPersonIds: member.spouses,
          personIdToUserIdMap,
          relationshipType: 'spouse',
          errorLabel: 'spouse relationship',
        });
      }

      // Create parent-child relationships
      if (member.children && member.children.length > 0) {
        await this.createEdgesForRelationType({
          sourceUserId: userId,
          targetPersonIds: member.children,
          personIdToUserIdMap,
          relationshipType: 'parent-child',
          errorLabel: 'parent-child relationship',
        });
      }

      // Create sibling relationships
      if (member.siblings && member.siblings.length > 0) {
        await this.createEdgesForRelationType({
          sourceUserId: userId,
          targetPersonIds: member.siblings,
          personIdToUserIdMap,
          relationshipType: 'sibling',
          errorLabel: 'sibling relationship',
        });
      }
    }
  }

  private async createEdgesForRelationType(params: {
    sourceUserId: number;
    targetPersonIds: number[];
    personIdToUserIdMap: Map<number, number>;
    relationshipType: 'spouse' | 'parent-child' | 'sibling';
    errorLabel: string;
  }): Promise<void> {
    const {
      sourceUserId,
      targetPersonIds,
      personIdToUserIdMap,
      relationshipType,
      errorLabel,
    } = params;

    for (const personId of targetPersonIds) {
      const targetUserId = personIdToUserIdMap.get(personId);
      if (!targetUserId || targetUserId === sourceUserId) {
        continue;
      }

      try {
        await this.relationshipEdgeService.createRelationshipEdge(
          sourceUserId,
          targetUserId,
          relationshipType,
        );
      } catch (error) {
        console.error(
          `Error creating ${errorLabel}: ${sourceUserId} -> ${targetUserId}`,
          error,
        );
      }
    }
  }

  /**
   * Delete a person from family tree
   * - Admin can delete any non-root person
   * - Users can delete themselves
   * - Preserves tree integrity by cleaning up relationship references
   * - Emits WebSocket event for real-time synchronization
   */
  private async createStructuralDummyCarrier(params: {
    sourceUserId?: number | null;
    actingUserId: number;
    transaction: any;
  }) {
    const sourceUserId = Number(params?.sourceUserId || 0);
    const sourceProfile = sourceUserId
      ? await this.userProfileModel.findOne({
          where: { userId: sourceUserId } as any,
          attributes: ['gender'],
          transaction: params.transaction,
        })
      : null;

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
        createdBy: params.actingUserId || 0,
        lifecycleState: 'active',
      } as any,
      { transaction: params.transaction },
    );

    await this.userProfileModel.create(
      {
        userId: dummyUser.id,
        firstName: 'Removed',
        lastName: 'Member',
        gender: (sourceProfile as any)?.gender || null,
        familyCode: null,
        associatedFamilyCodes: [],
      } as any,
      { transaction: params.transaction },
    );

    return dummyUser;
  }

  private async deactivateSyntheticDummyCarrierIfUnused(dummyUserId: number, transaction: any) {
    const normalizedDummyUserId = Number(dummyUserId || 0);
    if (!normalizedDummyUserId) {
      return;
    }

    const dummyUser = await this.userModel.findByPk(normalizedDummyUserId, {
      transaction,
      lock: (transaction as any).LOCK.UPDATE,
    });
    if (!dummyUser || (dummyUser as any).isAppUser) {
      return;
    }

    const remainingTreeRefs = await this.familyTreeModel.count({
      where: { userId: normalizedDummyUserId } as any,
      transaction,
    });
    if (remainingTreeRefs > 0) {
      return;
    }

    const isSyntheticDummy =
      !(dummyUser as any).email &&
      !(dummyUser as any).mobile &&
      !(dummyUser as any).password;

    if (isSyntheticDummy && Number((dummyUser as any).status) !== 2) {
      await dummyUser.update({ status: 2 } as any, { transaction });
    }
  }

  private async deactivateTreeLinksForNode(params: {
    nodeUid: string;
    transaction: any;
  }) {
    const nodeUid = String(params?.nodeUid || '').trim();
    if (!nodeUid) {
      return;
    }

    await this.treeLinkModel.update(
      { status: 'inactive' } as any,
      {
        where: {
          status: 'active',
          [Op.or]: [{ nodeUidLow: nodeUid }, { nodeUidHigh: nodeUid }],
        } as any,
        transaction: params.transaction,
      },
    );
  }

  async convertFamilyUserNodesToStructuralDummy(params: {
    actingUserId: number;
    familyCode: string;
    memberUserId: number;
    transaction: any;
  }) {
    const normalizedFamilyCode = String(params?.familyCode || '').trim().toUpperCase();
    const memberUserId = Number(params?.memberUserId || 0);
    if (!normalizedFamilyCode || !memberUserId) {
      return { updatedNodes: 0, dummyUserId: null, revokedFamilies: [] as string[] };
    }

    const treeEntries = await this.familyTreeModel.findAll({
      where: {
        familyCode: normalizedFamilyCode,
        userId: memberUserId,
        isStructuralDummy: false,
      } as any,
      transaction: params.transaction,
      lock: (params.transaction as any).LOCK.UPDATE,
    });

    if (!treeEntries.length) {
      return { updatedNodes: 0, dummyUserId: null, revokedFamilies: [] as string[] };
    }

    const sourceProfile = await this.userProfileModel.findOne({
      where: { userId: memberUserId } as any,
      attributes: ['familyCode'],
      transaction: params.transaction,
    });
    const sourceFamilyCode = String((sourceProfile as any)?.familyCode || '').trim().toUpperCase();
    const impactedFamilies = new Set<string>();
    const dummyCarrier = await this.createStructuralDummyCarrier({
      sourceUserId: memberUserId,
      actingUserId: params.actingUserId,
      transaction: params.transaction,
    });

    for (const treeEntry of treeEntries as any[]) {
      const previousNodeType = this.treeProjectionService.resolveNodeType({
        entry: treeEntry,
        treeFamilyCode: normalizedFamilyCode,
        primaryFamilyCode: sourceFamilyCode,
      });
      const linkedFamilyCode =
        previousNodeType === 'linked'
          ? String(treeEntry?.canonicalFamilyCode || '').trim().toUpperCase()
          : previousNodeType === 'associated'
            ? sourceFamilyCode
            : '';

      if (linkedFamilyCode && linkedFamilyCode !== normalizedFamilyCode) {
        impactedFamilies.add(linkedFamilyCode);
      }
      if (previousNodeType === 'linked') {
        await this.deactivateTreeLinksForNode({
          nodeUid: treeEntry?.nodeUid,
          transaction: params.transaction,
        });
      }

      await treeEntry.update(
        {
          userId: dummyCarrier.id,
          isStructuralDummy: true,
          nodeType: 'structural_dummy',
          dummyReason: 'member_deleted',
          dummyCreatedAt: new Date(),
          dummyCreatedBy: params.actingUserId,
          isExternalLinked: false,
          canonicalFamilyCode: null,
          canonicalNodeUid: null,
        } as any,
        { transaction: params.transaction },
      );
    }

    const revokedFamilies: string[] = [];
    for (const impactedFamilyCode of impactedFamilies) {
      const revoked = await this.revokeFamilyConnectionIfUnbridged({
        familyA: normalizedFamilyCode,
        familyB: impactedFamilyCode,
        transaction: params.transaction,
      });
      if (revoked) {
        revokedFamilies.push(impactedFamilyCode);
      }
    }

    return {
      updatedNodes: treeEntries.length,
      dummyUserId: Number(dummyCarrier.id),
      revokedFamilies,
    };
  }

  private async convertTreeEntryToStructuralDummy(params: {
    actingUserId: number;
    familyCode: string;
    treeEntry: any;
    transaction: any;
  }) {
    const normalizedFamilyCode = String(params?.familyCode || '').trim().toUpperCase();
    const treeEntry = params?.treeEntry;
    if (!treeEntry) {
      return { dummyUserId: null, revokedFamilies: [] as string[], originalUserId: null, originalNodeType: 'birth' };
    }

    const originalUserId = Number((treeEntry as any)?.userId || 0) || null;
    const sourceProfile = originalUserId
      ? await this.userProfileModel.findOne({
          where: { userId: originalUserId } as any,
          attributes: ['familyCode'],
          transaction: params.transaction,
        })
      : null;
    const sourceFamilyCode = String((sourceProfile as any)?.familyCode || '').trim().toUpperCase();
    const originalNodeType = this.treeProjectionService.resolveNodeType({
      entry: treeEntry,
      treeFamilyCode: normalizedFamilyCode,
      primaryFamilyCode: sourceFamilyCode,
    });
    const impactedFamilyCode =
      originalNodeType === 'linked'
        ? String((treeEntry as any)?.canonicalFamilyCode || '').trim().toUpperCase()
        : originalNodeType === 'associated'
          ? sourceFamilyCode
          : '';

    const dummyCarrier = originalUserId
      ? await this.createStructuralDummyCarrier({
          sourceUserId: originalUserId,
          actingUserId: params.actingUserId,
          transaction: params.transaction,
        })
      : null;

    if (originalNodeType === 'linked') {
      await this.deactivateTreeLinksForNode({
        nodeUid: (treeEntry as any)?.nodeUid,
        transaction: params.transaction,
      });
    }

    await (treeEntry as any).update(
      {
        userId: dummyCarrier ? dummyCarrier.id : (treeEntry as any).userId,
        isStructuralDummy: true,
        nodeType: 'structural_dummy',
        dummyReason: 'member_deleted',
        dummyCreatedAt: new Date(),
        dummyCreatedBy: params.actingUserId,
        isExternalLinked: false,
        canonicalFamilyCode: null,
        canonicalNodeUid: null,
      } as any,
      { transaction: params.transaction },
    );

    const revokedFamilies: string[] = [];
    if (impactedFamilyCode && impactedFamilyCode !== normalizedFamilyCode) {
      const revoked = await this.revokeFamilyConnectionIfUnbridged({
        familyA: normalizedFamilyCode,
        familyB: impactedFamilyCode,
        transaction: params.transaction,
      });
      if (revoked) {
        revokedFamilies.push(impactedFamilyCode);
      }
    }

    return {
      dummyUserId: dummyCarrier ? Number(dummyCarrier.id) : null,
      revokedFamilies,
      originalUserId,
      originalNodeType,
    };
  }

  async deleteTreePerson(params: {
    actingUserId: number;
    familyCode: string;
    personId: number;
  }) {
    const { actingUserId, familyCode, personId } = params;
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();

    if (!actingUserId || !normalizedFamilyCode || !personId) {
      throw new BadRequestException('Missing required parameters');
    }

    const transaction = await this.sequelize.transaction();
    try {
      const familyRecord = await this.familyModel.findOne({
        where: { familyCode: normalizedFamilyCode } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });

      const treeEntry = await this.familyTreeModel.findOne({
        where: {
          familyCode: normalizedFamilyCode,
          personId,
        } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });

      if (!treeEntry) {
        await transaction.rollback();
        throw new NotFoundException('Person not found in family tree');
      }

      const entryData = treeEntry as any;
      const userId = Number(entryData.userId || 0) || null;
      const actorUser = await this.userModel.findOne({
        where: { id: actingUserId },
        include: [
          {
            model: this.userProfileModel,
            as: 'userProfile',
            attributes: ['familyCode'],
          },
        ],
        transaction,
      });

      if (!actorUser) {
        throw new ForbiddenException('Unauthorized');
      }

      const actorRole = Number((actorUser as any).role);
      const actorIsAdmin = actorRole === 2 || actorRole === 3;
      const actorFamilyCode = String((actorUser as any)?.userProfile?.familyCode || '')
        .trim()
        .toUpperCase();
      const actorMembership = await this.familyMemberModel.findOne({
        where: {
          memberId: actingUserId,
          familyCode: normalizedFamilyCode,
          approveStatus: 'approved',
        } as any,
        transaction,
      });
      const isAdminOfThisFamily =
        actorIsAdmin && (actorFamilyCode === normalizedFamilyCode || !!actorMembership);
      const isSelfDeletion = userId && Number(userId) === Number(actingUserId);
      const targetSourceFamilyCode = String(
        entryData.sourceFamilyCode || entryData.primaryFamilyCode || entryData.familyCode || '',
      )
        .trim()
        .toUpperCase();
      const targetIsFamilyOwner =
        Number(userId || 0) > 0 &&
        Number(userId) === Number((familyRecord as any)?.createdBy || 0) &&
        targetSourceFamilyCode === normalizedFamilyCode;
      const targetIsCurrentFamilyAdmin =
        targetSourceFamilyCode === normalizedFamilyCode &&
        (Number(entryData.role || 0) >= 2 || targetIsFamilyOwner);

      if (targetIsCurrentFamilyAdmin) {
        await transaction.rollback();
        throw new BadRequestException('Family owner/admin cannot be removed from the tree');
      }

      if (!isSelfDeletion && !isAdminOfThisFamily) {
        await transaction.rollback();
        throw new ForbiddenException('Not authorized to delete this person');
      }

      if (entryData.isStructuralDummy) {
        await transaction.commit();
        const aggregate = await this.treeProjectionService.getFamilyAggregate(normalizedFamilyCode, {
          requestingUserId: actingUserId,
        });
        return {
          success: true,
          message: 'Person is already a structural dummy',
          treeVersion: aggregate.treeVersion,
          deletedNode: {
            personId,
            userId,
            nodeUid: entryData.nodeUid,
            nodeType: 'structural_dummy',
          },
          projection: aggregate.projection,
          revokedFamilies: [],
          prunedPrivacyFamilies: [],
        };
      }

      const converted = await this.convertTreeEntryToStructuralDummy({
        actingUserId,
        familyCode: normalizedFamilyCode,
        treeEntry,
        transaction,
      });

      if (converted.originalUserId) {
        await this.contentVisibilityService.hideContentForRemovedFamily(
          Number(converted.originalUserId),
          normalizedFamilyCode,
          'member_removed',
          transaction,
        );
      }

      await repairFamilyTreeIntegrity({
        familyCode: normalizedFamilyCode,
        transaction,
        lock: true,
        fixExternalGenerations: true,
      });

      if (familyRecord) {
        await familyRecord.increment('treeVersion', { by: 1, transaction });
      }

      await transaction.commit();

      const aggregate = await this.treeProjectionService.getFamilyAggregate(normalizedFamilyCode, {
        requestingUserId: actingUserId,
      });

      this.notificationService.emitFamilyEvent(normalizedFamilyCode, {
        type: 'TREE_CHANGED',
        treeVersion: aggregate.treeVersion,
        deletedPersonId: personId,
        deletedUserId: converted.originalUserId,
        deletedBy: actingUserId,
        deletedNodeType: converted.originalNodeType,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: 'Person converted to structural dummy successfully',
        treeVersion: aggregate.treeVersion,
        deletedNode: {
          personId,
          userId: converted.originalUserId,
          nodeUid: entryData.nodeUid,
          nodeType: 'structural_dummy',
        },
        projection: aggregate.projection,
        revokedFamilies: converted.revokedFamilies,
        prunedPrivacyFamilies: converted.revokedFamilies,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async replaceStructuralDummy(params: {
    actingUserId: number;
    familyCode: string;
    personId: number;
    replacementUserId: number;
  }) {
    const { actingUserId, familyCode, personId, replacementUserId } = params;
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    const normalizedReplacementUserId = Number(replacementUserId || 0);

    if (!actingUserId || !normalizedFamilyCode || !personId || !normalizedReplacementUserId) {
      throw new BadRequestException('Missing required parameters');
    }

    const transaction = await this.sequelize.transaction();
    try {
      const familyRecord = await this.familyModel.findOne({
        where: { familyCode: normalizedFamilyCode } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });

      const treeEntry = await this.familyTreeModel.findOne({
        where: { familyCode: normalizedFamilyCode, personId } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });

      if (!treeEntry) {
        throw new NotFoundException('Person not found in tree');
      }

      const entryData: any = treeEntry.get({ plain: true });
      if (
        !Boolean(entryData?.isStructuralDummy) &&
        String(entryData?.nodeType || '').trim() !== 'structural_dummy'
      ) {
        throw new BadRequestException('Only removed-member slots can be replaced.');
      }

      const actorUser = await this.userModel.findOne({
        where: { id: actingUserId },
        include: [
          {
            model: this.userProfileModel,
            as: 'userProfile',
            attributes: ['familyCode'],
          },
        ],
        transaction,
      });
      if (!actorUser) {
        throw new ForbiddenException('Unauthorized');
      }

      const actorRole = Number((actorUser as any).role);
      const actorIsAdmin = actorRole === 2 || actorRole === 3;
      const actorFamilyCode = String((actorUser as any)?.userProfile?.familyCode || '')
        .trim()
        .toUpperCase();
      const actorMembership = await this.familyMemberModel.findOne({
        where: {
          memberId: actingUserId,
          familyCode: normalizedFamilyCode,
          approveStatus: 'approved',
        } as any,
        transaction,
      });
      const isAdminOfThisFamily =
        actorIsAdmin && (actorFamilyCode === normalizedFamilyCode || !!actorMembership);
      if (!isAdminOfThisFamily) {
        throw new ForbiddenException('Not authorized to replace this placeholder');
      }

      const replacementMembership = await this.familyMemberModel.findOne({
        where: {
          memberId: normalizedReplacementUserId,
          familyCode: normalizedFamilyCode,
          approveStatus: 'approved',
        } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });
      if (!replacementMembership) {
        throw new BadRequestException('Replacement member is not active in this family');
      }

      const replacementUser = await this.userModel.findByPk(normalizedReplacementUserId, {
        include: [
          {
            model: this.userProfileModel,
            as: 'userProfile',
            attributes: ['familyCode'],
          },
        ],
        transaction,
      });
      if (!replacementUser) {
        throw new BadRequestException('Replacement user not found');
      }

      const existingTargetRows = await this.familyTreeModel.count({
        where: {
          familyCode: normalizedFamilyCode,
          userId: normalizedReplacementUserId,
          isStructuralDummy: false,
          personId: { [Op.ne]: personId },
        } as any,
        transaction,
      });
      if (existingTargetRows > 0) {
        throw new BadRequestException('Replacement member already exists in this family tree');
      }

      const replacementPrimaryFamilyCode = String(
        (replacementUser as any)?.userProfile?.familyCode || '',
      )
        .trim()
        .toUpperCase();
      const resolvedNodeType = replacementPrimaryFamilyCode &&
        replacementPrimaryFamilyCode !== normalizedFamilyCode
        ? 'associated'
        : 'birth';

      const previousDummyUserId = Number(entryData?.userId || 0) || null;

      await (treeEntry as any).update(
        {
          userId: normalizedReplacementUserId,
          isStructuralDummy: false,
          nodeType: resolvedNodeType,
          dummyReason: null,
          dummyCreatedAt: null,
          dummyCreatedBy: null,
          isExternalLinked: false,
          canonicalFamilyCode: null,
          canonicalNodeUid: null,
        } as any,
        { transaction },
      );

      await repairFamilyTreeIntegrity({
        familyCode: normalizedFamilyCode,
        transaction,
        lock: true,
        fixExternalGenerations: true,
      });

      if (familyRecord) {
        await familyRecord.increment('treeVersion', { by: 1, transaction });
      }

      await this.deactivateSyntheticDummyCarrierIfUnused(previousDummyUserId, transaction);
      await transaction.commit();

      const aggregate = await this.treeProjectionService.getFamilyAggregate(normalizedFamilyCode, {
        requestingUserId: actingUserId,
      });

      this.notificationService.emitFamilyEvent(normalizedFamilyCode, {
        type: 'TREE_CHANGED',
        treeVersion: aggregate.treeVersion,
        replacedPersonId: personId,
        replacementUserId: normalizedReplacementUserId,
        replacedBy: actingUserId,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: 'Removed-member slot filled successfully',
        treeVersion: aggregate.treeVersion,
        replacedNode: {
          personId,
          userId: normalizedReplacementUserId,
          nodeUid: entryData.nodeUid,
          nodeType: resolvedNodeType,
        },
        projection: aggregate.projection,
      };
    } catch (error) {
      if (!(transaction as any)?.finished) {
        await transaction.rollback();
      }
      throw error;
    }
  }

  async permanentlyDeleteStructuralDummy(params: {
    actingUserId: number;
    familyCode: string;
    personId: number;
  }) {
    const { actingUserId, familyCode, personId } = params;
    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();

    if (!actingUserId || !normalizedFamilyCode || !personId) {
      throw new BadRequestException('Missing required parameters');
    }

    const transaction = await this.sequelize.transaction();
    try {
      const familyRecord = await this.familyModel.findOne({
        where: { familyCode: normalizedFamilyCode } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });

      const treeEntry = await this.familyTreeModel.findOne({
        where: { familyCode: normalizedFamilyCode, personId } as any,
        transaction,
        lock: (transaction as any).LOCK.UPDATE,
      });

      if (!treeEntry) {
        throw new NotFoundException('Person not found in tree');
      }

      const entryData: any = treeEntry.get({ plain: true });
      if (
        !Boolean(entryData?.isStructuralDummy) &&
        String(entryData?.nodeType || '').trim() !== 'structural_dummy'
      ) {
        throw new BadRequestException('Only removed-member slots can be cleared.');
      }

      const actorUser = await this.userModel.findOne({
        where: { id: actingUserId },
        include: [
          {
            model: this.userProfileModel,
            as: 'userProfile',
            attributes: ['familyCode'],
          },
        ],
        transaction,
      });
      if (!actorUser) {
        throw new ForbiddenException('Unauthorized');
      }

      const actorRole = Number((actorUser as any).role);
      const actorIsAdmin = actorRole === 2 || actorRole === 3;
      const actorFamilyCode = String((actorUser as any)?.userProfile?.familyCode || '')
        .trim()
        .toUpperCase();
      const actorMembership = await this.familyMemberModel.findOne({
        where: {
          memberId: actingUserId,
          familyCode: normalizedFamilyCode,
          approveStatus: 'approved',
        } as any,
        transaction,
      });
      const isAdminOfThisFamily =
        actorIsAdmin && (actorFamilyCode === normalizedFamilyCode || !!actorMembership);
      if (!isAdminOfThisFamily) {
        throw new ForbiddenException('Not authorized to delete this placeholder');
      }

      const totalNodes = await this.familyTreeModel.count({
        where: { familyCode: normalizedFamilyCode } as any,
        transaction,
      });
      this.assertStructuralDummyCanBeDeletedPermanently({
        treeEntry: entryData,
        totalNodes,
      });

      const dummyUserId = Number(entryData?.userId || 0) || null;
      const nodeUid = String(entryData?.nodeUid || '').trim();
      if (nodeUid) {
        await this.deactivateTreeLinksForNode({
          nodeUid,
          transaction,
        });
      }

      await (treeEntry as any).destroy({ transaction });
      await this.cleanupOrphanedRelationshipReferencesInTransaction(
        normalizedFamilyCode,
        transaction,
      );
      await repairFamilyTreeIntegrity({
        familyCode: normalizedFamilyCode,
        transaction,
        lock: true,
        fixExternalGenerations: true,
      });

      if (familyRecord) {
        await familyRecord.increment('treeVersion', { by: 1, transaction });
      }

      await this.deactivateSyntheticDummyCarrierIfUnused(dummyUserId, transaction);
      await transaction.commit();

      const aggregate = await this.treeProjectionService.getFamilyAggregate(normalizedFamilyCode, {
        requestingUserId: actingUserId,
      });

      this.notificationService.emitFamilyEvent(normalizedFamilyCode, {
        type: 'TREE_CHANGED',
        treeVersion: aggregate.treeVersion,
        deletedPersonId: personId,
        deletedBy: actingUserId,
        deletedNodeType: 'structural_dummy',
        permanent: true,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: 'Empty slot cleared successfully',
        treeVersion: aggregate.treeVersion,
        deletedNode: {
          personId,
          userId: dummyUserId,
          nodeUid,
          nodeType: 'structural_dummy',
        },
        projection: aggregate.projection,
      };
    } catch (error) {
      if (!(transaction as any)?.finished) {
        await transaction.rollback();
      }
      throw error;
    }
  }

  private async cleanupOrphanedRelationshipReferencesInTransaction(
    familyCode: string,
    transaction: any,
  ) {
    const remainingEntries = await this.familyTreeModel.findAll({
      where: { familyCode } as any,
      transaction,
    });

    const remainingPersonIdSet = new Set<number>(
      remainingEntries
        .map((e: any) => Number(e.personId))
        .filter((id) => Number.isFinite(id)),
    );

    const cleanArray = (arr: any) => {
      if (!arr || !Array.isArray(arr)) return [];
      return arr
        .map((id) => (typeof id === 'string' ? Number.parseInt(id, 10) : id))
        .filter((id) => !Number.isNaN(id) && remainingPersonIdSet.has(id));
    };

    for (const entry of remainingEntries as any[]) {
      const cleanedParents = cleanArray(entry.parents);
      const cleanedChildren = cleanArray(entry.children);
      const cleanedSpouses = cleanArray(entry.spouses);
      const cleanedSiblings = cleanArray(entry.siblings);

      const parentsChanged = JSON.stringify(cleanedParents) !== JSON.stringify(entry.parents);
      const childrenChanged = JSON.stringify(cleanedChildren) !== JSON.stringify(entry.children);
      const spousesChanged = JSON.stringify(cleanedSpouses) !== JSON.stringify(entry.spouses);
      const siblingsChanged = JSON.stringify(cleanedSiblings) !== JSON.stringify(entry.siblings);

      if (parentsChanged || childrenChanged || spousesChanged || siblingsChanged) {
        await entry.update(
          {
            parents: cleanedParents,
            children: cleanedChildren,
            spouses: cleanedSpouses,
            siblings: cleanedSiblings,
          },
          { transaction },
        );
      }
    }
  }
}

































