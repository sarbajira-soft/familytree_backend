import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
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
      console.log(`Getting user name for userId: ${userId}`);

      // First try to get name from UserProfile directly
      const userProfile = await this.userProfileModel.findOne({
        where: { userId },
        attributes: ['firstName', 'lastName', 'userId'],
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
        include: [
          {
            model: UserProfile,
            as: 'userProfile',
            attributes: ['firstName', 'lastName'],
          },
        ],
      });

      console.log('User with profile found:', user?.toJSON());

      if (user?.userProfile) {
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

  async getLinkedFamiliesForCurrentUser(userId: number) {
    if (!userId) {
      throw new ForbiddenException('Unauthorized');
    }

    const userProfile = await this.userProfileModel.findOne({ where: { userId } });
    const viewerMembership = await this.familyMemberModel.findOne({
      where: {
        memberId: userId,
        approveStatus: 'approved',
      },
      order: [['id', 'DESC']],
    });

    const viewerFamilyCode = userProfile?.familyCode || viewerMembership?.familyCode;
    if (!viewerFamilyCode) {
      return [];
    }

    const links = await this.sequelize.query(
      `
      SELECT "familyCodeLow", "familyCodeHigh"
      FROM public.ft_family_link
      WHERE ("familyCodeLow" = :code OR "familyCodeHigh" = :code)
        AND status = 'active'
        AND source = 'tree'
      ORDER BY id DESC
    `,
      {
        replacements: { code: String(viewerFamilyCode).trim().toUpperCase() },
        type: QueryTypes.SELECT,
      },
    );

    const linkedCodes = Array.from(
      new Set(
        (links as any[])
          .map((r: any) => {
            const low = String(r?.familyCodeLow || '').trim().toUpperCase();
            const high = String(r?.familyCodeHigh || '').trim().toUpperCase();
            return low === String(viewerFamilyCode).trim().toUpperCase() ? high : low;
          })
          .filter((c) => c && c !== String(viewerFamilyCode).trim().toUpperCase()),
      ),
    );

    if (linkedCodes.length === 0) {
      return [];
    }

    const families = await this.familyModel.findAll({
      where: { familyCode: { [Op.in]: linkedCodes } } as any,
      attributes: ['familyCode', 'familyName', 'familyPhoto'],
    });

    const byCode = new Map(
      (families as any[]).map((f: any) => [String(f?.familyCode).trim().toUpperCase(), f]),
    );

    return linkedCodes.map((code) => {
      const f = byCode.get(String(code).trim().toUpperCase());
      return {
        familyCode: code,
        familyName: f ? f.familyName : null,
        familyPhoto: f ? f.familyPhoto : null,
      };
    });
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
    private readonly notificationService: NotificationService,
    private readonly relationshipEdgeService: RelationshipEdgeService,
    private readonly relationshipPathService: RelationshipPathService,
    private readonly uploadService: UploadService,
  ) { }

  async unlinkTreeLinkExternalCard(params: {
    actingUserId: number;
    familyCode: string;
    nodeUid: string;
  }) {
    const { familyCode, nodeUid } = await this.requireAdminActorForFamilyAction(params);

    const externalCard = await this.familyTreeModel.findOne({
      where: {
        familyCode,
        nodeUid,
        isExternalLinked: true,
      } as any,
    });
    if (!externalCard) {
      throw new NotFoundException('Linked card not found');
    }

    const canonicalFamilyCode = String((externalCard as any).canonicalFamilyCode || '')
      .trim()
      .toUpperCase();
    const canonicalNodeUid = String((externalCard as any).canonicalNodeUid || '').trim();

    const cardsToDelete = await this.familyTreeModel.findAll({
      where: {
        familyCode,
        isExternalLinked: true,
        ...(canonicalFamilyCode && canonicalNodeUid
          ? {
            canonicalFamilyCode,
            canonicalNodeUid,
          }
          : { nodeUid }),
      } as any,
    });

    const deletedPersonIds = cardsToDelete
      .map((c: any) => Number(c.personId))
      .filter((id) => Number.isFinite(id));

    // Delete the external-linked cards
    await this.familyTreeModel.destroy({
      where: {
        familyCode,
        isExternalLinked: true,
        ...(canonicalFamilyCode && canonicalNodeUid
          ? {
            canonicalFamilyCode,
            canonicalNodeUid,
          }
          : { nodeUid }),
      } as any,
    });

    // Clean up orphaned relationship references inside this family
    await this.cleanupOrphanedRelationshipReferences(familyCode);

    // Deactivate tree links if we can map to canonical
    let deactivatedTreeLinks = 0;
    let deactivatedFamilyLink = false;

    if (canonicalFamilyCode && canonicalNodeUid) {
      const { low, high } = this.normalizeFamilyPair(familyCode, canonicalFamilyCode);

      const where: any = {
        familyCodeLow: low,
        familyCodeHigh: high,
        status: 'active',
      };
      if (canonicalFamilyCode === low) {
        where.nodeUidLow = canonicalNodeUid;
      } else {
        where.nodeUidHigh = canonicalNodeUid;
      }

      const [updatedCount] = await this.treeLinkModel.update(
        { status: 'inactive' } as any,
        { where },
      );
      deactivatedTreeLinks = Number(updatedCount || 0);

      const remainingActive = await this.treeLinkModel.findOne({
        where: {
          familyCodeLow: low,
          familyCodeHigh: high,
          status: 'active',
        } as any,
      });

      if (!remainingActive) {
        // Bug 66: If both sides removed their external cards (no remaining external-linked cards between these families),
        // then family-to-family visibility should be revoked (events/posts/etc).
        const remainingExternalCard = await this.familyTreeModel.findOne({
          where: {
            isExternalLinked: true,
            [Op.or]: [
              {
                familyCode,
                canonicalFamilyCode,
              } as any,
              {
                familyCode: canonicalFamilyCode,
                canonicalFamilyCode: familyCode,
              } as any,
            ],
          } as any,
        });

        if (!remainingExternalCard) {
          const [famUpdated] = await this.familyLinkModel.update(
            { status: 'inactive' } as any,
            {
              where: {
                familyCodeLow: low,
                familyCodeHigh: high,
                status: 'active',
                source: { [Op.in]: ['tree', 'spouse'] } as any,
              } as any,
            },
          );
          deactivatedFamilyLink = Number(famUpdated || 0) > 0;
        }
      }
    }

    await this.repairFamilyTreeAfterMutation({ familyCode });

    return {
      success: true,
      message: 'Unlinked successfully',
      removedExternalCards: cardsToDelete.length,
      removedPersonIds: deletedPersonIds,
      deactivatedTreeLinks,
      deactivatedFamilyLink,
    };
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

    const [familyLinkUpdated] = await this.familyLinkModel.update(
      { status: 'inactive' } as any,
      {
        where: {
          familyCodeLow: low,
          familyCodeHigh: high,
          source: 'tree',
          status: 'active',
        } as any,
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
      },
    );

    // Remove external linked cards in the actor's family that came from the other family
    const cardsToDelete = await this.familyTreeModel.findAll({
      where: {
        familyCode: actorFamilyCode,
        isExternalLinked: true,
        canonicalFamilyCode: otherFamilyCode,
      } as any,
    });

    const deletedPersonIds = cardsToDelete
      .map((c: any) => Number(c.personId))
      .filter((id) => Number.isFinite(id));

    const removedExternalCards = await this.familyTreeModel.destroy({
      where: {
        familyCode: actorFamilyCode,
        isExternalLinked: true,
        canonicalFamilyCode: otherFamilyCode,
      } as any,
    });

    if (removedExternalCards > 0) {
      await this.cleanupOrphanedRelationshipReferences(actorFamilyCode);
    }

    await this.repairFamilyTreeAfterMutation({ familyCode: actorFamilyCode });

    return {
      success: true,
      message: 'Linked family connection removed',
      familyLinkUpdated: Number(familyLinkUpdated || 0),
      treeLinksUpdated: Number(treeLinksUpdated || 0),
      removedExternalCards: Number(removedExternalCards || 0),
      removedPersonIds: deletedPersonIds,
    };
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
    allowAdminPreview: boolean = false,
  ): Promise<void> {
    if (!userId || !familyCode) {
      throw new ForbiddenException(
        'Access denied: invalid user or family context',
      );
    }

    const userProfile = await this.userProfileModel.findOne({ where: { userId } });

    const membership = await this.familyMemberModel.findOne({
      where: {
        memberId: userId,
        familyCode,
      },
    });

    // BLOCK OVERRIDE: Legacy family-level block gate removed.

    if (this.isCrossFamilyTreeViewEnabled()) {
      return;
    }

    // If user is an approved member of this family, allow
    if (membership && (membership as any).approveStatus === 'approved') {
      return;
    }

    // Allow if the user already has a visible card in this family's tree (cross-family spouse cards).
    // This is a strong signal that the user should be able to view this family even without membership.
    const viewerTreeEntry = await this.familyTreeModel.findOne({
      where: {
        familyCode,
        userId,
      } as any,
    });

    if (viewerTreeEntry) {
      return;
    }

    if (await this.hasTreeLinkFamilyVisibility(userId, familyCode, userProfile)) {
      return;
    }

    // Allow associated-family access (e.g., spouse-connected families)
    // Users may have access via associatedFamilyCodes without being a direct member.
    const associated = Array.isArray((userProfile as any)?.associatedFamilyCodes)
      ? ((userProfile as any)?.associatedFamilyCodes as any[])
      : [];

    const hasAssociatedFamilyAccess = this.hasAssociatedFamilyAccess(
      associated,
      familyCode,
    );
    if (hasAssociatedFamilyAccess) {
      return;
    }

    // Family-level visibility (members): if the viewer belongs to a family,
    // allow viewing other families that are connected to ANY approved member in their family.
    // This is required so regular members (not only admins) can view spouse/associated family trees.
    if (await this.hasFamilyLevelVisibilityViaMembers(userId, familyCode, userProfile)) {
      return;
    }

    // Acting admin visibility: if the viewer is an admin of their own family,
    // allow viewing other families that are connected to ANY approved member in their family.
    // This is required when an admin sends a spouse/association request on behalf of a non-app member
    // (the admin may not be the direct relationship participant).
    if (await this.hasActingAdminVisibility(userId, familyCode, userProfile)) {
      return;
    }

    // Allow spouse-linked access even if associatedFamilyCodes wasn't populated (common for non-app users).
    // If the viewer has a spouse relationship edge with any user that belongs to this family,
    // allow viewing this family's tree.
    if (await this.hasSpouseLinkedAccess(userId, familyCode)) {
      return;
    }

    // No approved membership
    if (!allowAdminPreview) {
      // eslint-disable-next-line no-console
      console.log('🔒 Tree access denied', {
        userId,
        familyCode,
        hasApprovedMembership: Boolean(
          membership && (membership as any).approveStatus === 'approved',
        ),
        hasViewerTreeEntry: Boolean(viewerTreeEntry),
        associatedCount: associated.length,
        associatedCodes: associated,
        hasAssociatedFamilyAccess,
      });
      throw new ForbiddenException(
        'Access denied: you are not a member of this family',
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
      message: 'Family tree created successfully',
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

  private async deleteStaleFamilyTreeEntriesAndCleanup(params: {
    familyCode: string;
    members: FamilyTreeMemberDto[];
  }) {
    const { familyCode, members } = params;
    const personIdsInPayload = members.map((m) => m.id);
    console.log('📋 PersonIds in payload:', personIdsInPayload);

    const isFullTreeReset = Array.isArray(members) && members.length === 1;
    const deletedEntries = await this.familyTreeModel.destroy({
      where: {
        familyCode,
        personId: { [Op.notIn]: personIdsInPayload },
        ...(isFullTreeReset
          ? {}
          : {
            isExternalLinked: { [Op.ne]: true },
          }),
      },
    });
    console.log(
      `🗑️ Deleted ${deletedEntries} family_tree entries not in payload`,
    );

    if (deletedEntries > 0) {
      await this.cleanupOrphanedRelationshipReferences(familyCode);
      console.log(`🧹 Cleaned up orphaned relationships in remaining entries`);
    }
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

    if (memberIdsInTree.length > 0) {
      const membershipsToDelete = await this.familyMemberModel.findAll({
        where: {
          familyCode,
          memberId: { [Op.notIn]: memberIdsInTree },
        },
        include: [
          {
            model: this.userModel,
            as: 'user',
            required: false,
          },
        ],
      });

      const memberIdsToDelete = membershipsToDelete
        .filter((m: any) => !m.user || (m.user.role !== 2 && m.user.role !== 3))
        .map((m: any) => m.memberId);

      const deletedMembers = memberIdsToDelete.length
        ? await this.familyMemberModel.destroy({
          where: {
            familyCode,
            memberId: { [Op.in]: memberIdsToDelete },
          },
        })
        : 0;

      if (memberIdsToDelete.length > 0) {
        await this.cleanupRemovedMemberProfilesForTreeSave({
          familyCode,
          removedMemberIds: memberIdsToDelete,
        });
      }

      console.log(
        `✅ Removed ${deletedMembers} non-admin family members not in new tree`,
      );
      return;
    }

    const familyCreator = await this.familyModel.findOne({
      where: { familyCode },
      attributes: ['createdBy'],
    });

    if (!familyCreator) {
      return;
    }

    const membershipsToDelete = await this.familyMemberModel.findAll({
      where: {
        familyCode,
        memberId: { [Op.ne]: familyCreator.createdBy },
      },
      include: [
        {
          model: this.userModel,
          as: 'user',
          required: false,
        },
      ],
    });

    const memberIdsToDelete = membershipsToDelete
      .filter((m: any) => !m.user || (m.user.role !== 2 && m.user.role !== 3))
      .map((m: any) => m.memberId);

    const deletedMembers = memberIdsToDelete.length
      ? await this.familyMemberModel.destroy({
        where: {
          familyCode,
          memberId: { [Op.in]: memberIdsToDelete },
        },
      })
      : 0;

    if (memberIdsToDelete.length > 0) {
      await this.cleanupRemovedMemberProfilesForTreeSave({
        familyCode,
        removedMemberIds: memberIdsToDelete,
      });
    }

    console.log(
      `✅ Removed ${deletedMembers} non-admin members from family_member table (keeping creator and admins)`,
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

      const isExternalLinked =
        Boolean(member.isExternalLinked) || Boolean(existingEntry?.isExternalLinked);

      if (Boolean(existingEntry?.isExternalLinked) && !member.isExternalLinked) {
        member.isExternalLinked = true;
      }

      if (userId && member.memberId && !isExternalLinked) {
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

      if (userId && bulkContext.newUserIndexMap.has(memberIndex) && !isExternalLinked) {
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

  async getFamilyTree(
    familyCode: string,
    userId?: number,
    allowAdminPreview: boolean = false,
  ) {
    // If user context is provided, ensure they are allowed to view this family's tree
    if (userId) {
      await this.assertUserCanViewFamilyTree(
        userId,
        familyCode,
        allowAdminPreview,
      );
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
          attributes: ['id', 'email', 'mobile', 'countryCode', 'role', 'status', 'isAppUser', 'medusaCustomerId'],
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
            },
          ],
        },
      ],
    });

    // If family tree doesn't exist yet, do NOT auto-create cards from approved family members.
    // Admin will place members in the tree and save the structure.
    if (!familyTree.length) {
      return {
        message: 'Family tree not created yet',
        people: [],
      };
    }

    // Transform family tree data to the required format
    // FIXED: Remove duplicate entries from database result
    const uniqueFamilyTree = familyTree.reduce((unique, entry) => {
      const existingIndex = unique.findIndex(
        (u) => u.personId === entry.personId && u.userId === entry.userId,
      );
      if (existingIndex === -1) {
        unique.push(entry);
      } else {
        // Merge relationship data from duplicates
        const existing = unique[existingIndex];
        existing.parents = [
          ...new Set([...(existing.parents || []), ...(entry.parents || [])]),
        ];
        existing.children = [
          ...new Set([...(existing.children || []), ...(entry.children || [])]),
        ];
        existing.spouses = [
          ...new Set([...(existing.spouses || []), ...(entry.spouses || [])]),
        ];
        existing.siblings = [
          ...new Set([...(existing.siblings || []), ...(entry.siblings || [])]),
        ];
      }
      return unique;
    }, []);

    // Derive a stable "primary" (birth/home) family code.
    // For app users this is stored on userProfile.familyCode.
    // For non-app users (userProfile.familyCode is null), we infer it from the earliest
    // FamilyTree card ever created for that userId across all families. This works because
    // association creates new cards later in other families.
    const userIdsNeedingPrimaryFamily = Array.from(
      new Set(
        uniqueFamilyTree
          .filter((e) => {
            const profileFamilyCode = e?.user?.userProfile?.familyCode;
            return Boolean(e.userId) && !profileFamilyCode;
          })
          .map((e) => e.userId),
      ),
    );

    const inferredPrimaryFamilyCodeByUserId = new Map<number, string>();

    if (userIdsNeedingPrimaryFamily.length > 0) {
      const normalizedUserIds = userIdsNeedingPrimaryFamily
        .map(Number)
        .filter((id) => Number.isFinite(id));

      if (normalizedUserIds.length > 0) {
        try {
          const memberships = await this.sequelize.query<
            { userId: number; familyCode: string }[]
          >(
            `
            SELECT
              "memberId" as "userId",
              "familyCode" as "familyCode"
            FROM ft_family_members
            WHERE "memberId" IN (:userIds)
              AND "approveStatus" IN ('approved','associated')
            ORDER BY
              CASE WHEN "membershipType" = 'primary' THEN 0 ELSE 1 END,
              id ASC
          `,
            {
              replacements: { userIds: normalizedUserIds },
              type: QueryTypes.SELECT,
            },
          );

          memberships.forEach((row: any) => {
            const uid = Number(row?.userId);
            const fc = row?.familyCode ? String(row.familyCode) : '';
            if (!Number.isFinite(uid) || !fc) return;
            if (!inferredPrimaryFamilyCodeByUserId.has(uid)) {
              inferredPrimaryFamilyCodeByUserId.set(uid, fc);
            }
          });
        } catch (error_) {
          console.error('Error inferring primary family codes (preferred order); falling back:', error_);
          const memberships = await this.sequelize.query<
            { userId: number; familyCode: string }[]
          >(
            `
            SELECT
              "memberId" as "userId",
              "familyCode" as "familyCode"
            FROM ft_family_members
            WHERE "memberId" IN (:userIds)
              AND "approveStatus" IN ('approved','associated')
            ORDER BY id ASC
          `,
            {
              replacements: { userIds: normalizedUserIds },
              type: QueryTypes.SELECT,
            },
          );

          memberships.forEach((row: any) => {
            const uid = Number(row?.userId);
            const fc = row?.familyCode ? String(row.familyCode) : '';
            if (!Number.isFinite(uid) || !fc) return;
            if (!inferredPrimaryFamilyCodeByUserId.has(uid)) {
              inferredPrimaryFamilyCodeByUserId.set(uid, fc);
            }
          });
        }

        const remainingUserIds = normalizedUserIds.filter(
          (uid) => !inferredPrimaryFamilyCodeByUserId.has(uid),
        );

        if (remainingUserIds.length > 0) {
          const earliestCards = await this.familyTreeModel.findAll({
            where: {
              userId: { [Op.in]: remainingUserIds },
            },
            order: [['id', 'ASC']],
          });

          earliestCards.forEach((card) => {
            const uid = Number((card as any)?.userId);
            const fc = (card as any)?.familyCode ? String((card as any).familyCode) : '';
            if (!Number.isFinite(uid) || !fc) return;
            if (!inferredPrimaryFamilyCodeByUserId.has(uid)) {
              inferredPrimaryFamilyCodeByUserId.set(uid, fc);
            }
          });
        }
      }
    }

    const people = await Promise.all(
      uniqueFamilyTree.map(async (entry) => {
        // If userId is undefined/null, skip this person or handle gracefully
        if (!entry.userId) {
          return {
            id: entry.personId,
            nodeUid: entry.nodeUid,
            isExternalLinked: Boolean(entry.isExternalLinked),
            canonicalFamilyCode: entry.canonicalFamilyCode || null,
            canonicalNodeUid: entry.canonicalNodeUid || null,
            memberId: null,
            name: 'Unknown',
            gender: 'unknown',
            age: null,
            contactNumber: null,
            mobile: null,
            countryCode: null,
            generation: entry.generation,
            parents: entry.parents || [],
            children: entry.children || [],
            spouses: entry.spouses || [],
            siblings: entry.siblings || [],
            img: null,
            familyCode: entry.familyCode || familyCode, // Add familyCode field
            treeFamilyCode: entry.familyCode || familyCode,
            primaryFamilyCode: null,
            isAppUser: false,
          };
        }
        const userProfile = entry.user?.userProfile;
        // Get profile image full S3 URL
        let img = null;
        if (userProfile?.profile) {
          img = this.uploadService.getFileUrl(userProfile.profile, 'profile');
        }
        const mobile = entry.user?.mobile || null;
        const countryCode = entry.user?.countryCode || null;
        const contactNumber =
          userProfile?.contactNumber ||
          (countryCode && mobile ? `${countryCode}${mobile}` : mobile) ||
          null;
        return {
          id: entry.personId, // Use personId as id
          nodeUid: entry.nodeUid,
          isExternalLinked: Boolean(entry.isExternalLinked),
          canonicalFamilyCode: entry.canonicalFamilyCode || null,
          canonicalNodeUid: entry.canonicalNodeUid || null,
          memberId: entry.userId, // Include userId as memberId
          name: userProfile
            ? [userProfile.firstName, userProfile.lastName]
              .filter(Boolean)
              .join(' ') || 'Unknown'
            : 'Unknown',
          gender: this.normalizeGender(userProfile?.gender),
          age: userProfile?.age || null,
          contactNumber,
          mobile,
          countryCode,
          generation: entry.generation,
          lifeStatus: entry.lifeStatus || 'living',
          parents: entry.parents || [],
          children: entry.children || [],
          spouses: entry.spouses || [],
          siblings: entry.siblings || [],
          img: img,
          familyCode: userProfile?.familyCode || entry.familyCode || familyCode, // Add familyCode field
          treeFamilyCode: entry.familyCode || familyCode,
          primaryFamilyCode:
            userProfile?.familyCode ||
            inferredPrimaryFamilyCodeByUserId.get(Number(entry.userId)) ||
            null,
          associatedFamilyCodes: userProfile?.associatedFamilyCodes || [],
          isAppUser: entry.user ? !!entry.user.isAppUser : false,
        };
      }),
    );

    // Get all valid personIds for cleanup
    const validPersonIds = new Set<number>(people.map((p) => p.id));

    // Fix ID reference issues first (convert memberIds to person ids in relationships)
    const memberIdToPersonIdMap = new Map();
    people.forEach((person) => {
      if (person.memberId) {
        memberIdToPersonIdMap.set(person.memberId, person.id);
      }
    });

    // Fix relationship arrays to use person ids instead of member ids
    // AND remove references to non-existent persons
    const processedSpousePairs = new Set<string>();

    people.forEach((person) => {
      const cleanArray = (arr: any[]) => {
        if (!arr || !Array.isArray(arr)) return [];
        // Convert to numbers and filter out invalid IDs, remove duplicates
        const cleanedIds = arr
          .map((ref) => {
            // IMPORTANT: Relationship arrays in ft_family_tree are expected to store personIds.
            // Some historical data stored memberIds (userIds) instead. We only map memberId -> personId
            // when the reference is NOT already a valid personId in this tree.
            const raw = typeof ref === 'string' ? Number.parseInt(ref, 10) : ref;
            if (!Number.isFinite(raw)) return Number.NaN;
            if (validPersonIds.has(raw)) return raw;
            const mapped = memberIdToPersonIdMap.get(raw);
            return mapped ?? raw;
          })
          .filter((id) => !Number.isNaN(id) && validPersonIds.has(id));

        // FIXED: Remove duplicates using Set
        return [...new Set(cleanedIds)];
      };

      const selfId = person.id;

      // Remove any self-references from relationship arrays to avoid
      // corrupt parent/child cycles (e.g. a person listed as their own child)
      person.parents = cleanArray(person.parents).filter((id) => id !== selfId);
      person.children = cleanArray(person.children).filter((id) => id !== selfId);
      person.spouses = cleanArray(person.spouses).filter((id) => id !== selfId);
      person.siblings = cleanArray(person.siblings).filter((id) => id !== selfId);
      // FIXED: Ensure bidirectional parent-child relationships
      person.parents.forEach((parentId) => {
        const parent = people.find((p) => p.id === parentId);
        if (parent && !parent.children.includes(person.id)) {
          parent.children.push(person.id);
        }
      });

      person.children.forEach((childId) => {
        const child = people.find((p) => p.id === childId);
        if (child && !child.parents.includes(person.id)) {
          child.parents.push(person.id);
        }
      });

      // Ensure bidirectional spouse relationships
      person.spouses.forEach((spouseId) => {
        const spouse = people.find((p) => p.id === spouseId);
        if (spouse && !spouse.spouses.includes(person.id)) {
          spouse.spouses.push(person.id);
        }
      });

      // FIXED: Ensure shared children between spouses - PREVENT DUPLICATE PROCESSING
      person.spouses.forEach((spouseId) => {
        const spouse = people.find((p) => p.id === spouseId);
        if (spouse) {
          // Create unique pair key to prevent duplicate processing
          const pairKey = [person.id, spouseId].sort((a, b) => a - b).join('-');

          if (!processedSpousePairs.has(pairKey)) {
            processedSpousePairs.add(pairKey);

            // Collect all unique children from both parents
            const personChildrenSet = new Set(
              person.children.map(Number),
            );
            const spouseChildrenSet = new Set(
              spouse.children.map(Number),
            );
            const allChildrenSet = new Set([
              ...personChildrenSet,
              ...spouseChildrenSet,
            ]);

            // Prevent self-references from being treated as children
            allChildrenSet.delete(person.id);
            allChildrenSet.delete(spouseId);

            // Update both parents with clean arrays
            person.children = Array.from(allChildrenSet);
            spouse.children = Array.from(allChildrenSet);

            // Ensure each child has both parents
            allChildrenSet.forEach((childId) => {
              const child = people.find((p) => p.id === childId);
              if (child) {
                const childParentsSet = new Set(
                  child.parents.map(Number),
                );
                childParentsSet.add(Number(person.id));
                childParentsSet.add(Number(spouseId));
                child.parents = Array.from(childParentsSet);
              }
            });
          }
        }
      });

      // CLEANUP: Prevent impossible relationships where a person is both
      // a spouse and a parent/child of the same person. This can happen
      // when corrupted data is saved and would otherwise create invalid
      // edges in the tree.
      if (person.spouses && person.spouses.length > 0) {
        const parentsSet = new Set(person.parents || []);
        const childrenSet = new Set(person.children || []);

        person.spouses = person.spouses.filter((spouseId) => {
          const isInvalid =
            parentsSet.has(spouseId) || childrenSet.has(spouseId);

          if (isInvalid) {
            const spouse = people.find((p) => p.id === spouseId);
            if (spouse && Array.isArray(spouse.spouses)) {
              spouse.spouses = spouse.spouses.filter(
                (id) => id !== person.id,
              );
            }
          }

          return !isInvalid;
        });
      }
    });

    // Ensure no person ends up with more than two parents. When there are
    // more than two, prefer parents whose generations are closest to one
    // level above the child.
    people.forEach((person) => {
      if (!Array.isArray(person.parents) || person.parents.length <= 2) {
        return;
      }

      const childGeneration =
        typeof person.generation === 'number' ? person.generation : null;

      const parentInfos = person.parents
        .map((parentId) => {
          const parent = people.find((p) => p.id === parentId);
          return parent
            ? { id: parentId, generation: parent.generation as number | null }
            : null;
        })
        .filter((p) => p !== null) as { id: number; generation: number | null }[];

      if (parentInfos.length <= 2) {
        return;
      }

      const score = (parentGen: number | null): number => {
        if (childGeneration === null || parentGen === null) {
          return 1000;
        }

        const diff = childGeneration - parentGen;

        if (diff < 0) {
          // Parent appears younger than child, heavily penalize
          return 500 + Math.abs(diff);
        }

        // Ideal is one generation above the child (diff === 1)
        return Math.abs(diff - 1);
      };

      parentInfos.sort((a, b) => score(a.generation) - score(b.generation));

      const keepIds = new Set(parentInfos.slice(0, 2).map((p) => p.id));
      const removeIds = parentInfos.slice(2).map((p) => p.id);

      person.parents = person.parents.filter((id) => keepIds.has(id));

      // Remove the child from dropped parents' children arrays so that the
      // second pass does not re-introduce the relationship.
      removeIds.forEach((parentId) => {
        const parent = people.find((p) => p.id === parentId);
        if (parent && Array.isArray(parent.children)) {
          parent.children = parent.children.filter(
            (childId) => childId !== person.id,
          );
        }
      });
    });

    // Second pass to ensure all bidirectional relationships
    people.forEach((person) => {
      // Fix spouse relationships in second pass
      person.spouses.forEach((spouseId) => {
        const spouse = people.find((p) => p.id === spouseId);
        if (spouse && !spouse.spouses.includes(person.id)) {
          spouse.spouses.push(person.id);
        }
      });

      // Fix parent-child relationships in second pass
      person.children.forEach((childId) => {
        const child = people.find((p) => p.id === childId);
        if (child && !child.parents.includes(person.id)) {
          child.parents.push(person.id);
        }
      });
    });

    // Convert to Map format for relationship cleanup and final deduplication
    // IMPORTANT: We intentionally do NOT call fixGenerationConsistency here.
    // The frontend is the source of truth for generation values when saving
    // the tree (via createFamilyTree), so we preserve the stored generations
    // as-is to keep the visual layout stable across reloads.
    const allPeople = new Map();
    people.forEach((person) => {
      allPeople.set(person.id, {
        ...person,
        parents: new Set(person.parents || []),
        children: new Set(person.children || []),
        spouses: new Set(person.spouses || []),
        siblings: new Set(person.siblings || []),
      });
    });

    // Convert back to array format with cleaned relationship sets but
    // original generation values from the database
    const correctedPeople = Array.from(allPeople.values()).map((person) => ({
      ...person,
      parents: [...new Set(Array.from(person.parents))],
      children: [...new Set(Array.from(person.children))],
      spouses: [...new Set(Array.from(person.spouses))],
      siblings: [...new Set(Array.from(person.siblings))],
    }));

    // FINAL DEDUPLICATION: Remove duplicate people by ID while preserving generation
    const finalPeople = correctedPeople.reduce((unique, person) => {
      const existingIndex = unique.findIndex((u) => u.id === person.id);
      if (existingIndex === -1) {
        unique.push(person);
      } else {
        // Merge relationships from duplicates
        const existing = unique[existingIndex];
        existing.parents = [
          ...new Set([...existing.parents, ...person.parents]),
        ];
        existing.children = [
          ...new Set([...existing.children, ...person.children]),
        ];
        existing.spouses = [
          ...new Set([...existing.spouses, ...person.spouses]),
        ];
        existing.siblings = [
          ...new Set([...existing.siblings, ...person.siblings]),
        ];
      }
      return unique;
    }, []);

    // PERFORMANCE: Remove backend calculation - let frontend handle it
    // Frontend RelationshipCalculator is faster and more efficient
    // Backend only ensures data integrity

    return {
      message: 'Family tree retrieved successfully',
      people: finalPeople,
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
}
