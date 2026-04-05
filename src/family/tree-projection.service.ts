import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, Sequelize } from 'sequelize';
import { UploadService } from '../uploads/upload.service';
import { canViewScopedField } from '../user/privacy.util';
import { Family } from './model/family.model';
import { FamilyMember } from './model/family-member.model';
import { FamilyTree } from './model/family-tree.model';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';

export type TreeNodeType =
  | 'birth'
  | 'associated'
  | 'linked'
  | 'structural_dummy';

export type TreeProjectionFamily = {
  familyCode: string;
  familyName: string;
  memberCount: number;
  nodeType: 'associated' | 'linked';
};

export type TreeProjectionNode = {
  id: number;
  personId: number | null;
  nodeUid: string | null;
  userId: number | null;
  memberId: number | null;
  name: string;
  gender: string;
  age: number | null;
  contactNumber: string | null;
  mobile: string | null;
  countryCode: string | null;
  generation: number | null;
  lifeStatus: string;
  parents: number[];
  children: number[];
  spouses: number[];
  siblings: number[];
  img: string | null;
  familyCode: string | null;
  treeFamilyCode: string | null;
  primaryFamilyCode: string | null;
  sourceFamilyCode: string | null;
  associatedFamilyCodes: string[];
  isAppUser: boolean;
  isExternalLinked: boolean;
  isStructuralDummy: boolean;
  nodeType: TreeNodeType;
  canonicalFamilyCode: string | null;
  canonicalNodeUid: string | null;
  role: number | null;
  status: number | null;
  email: string | null;
  userProfile: Record<string, any> | null;
};

export type TreeProjectionResult = {
  associatedInTree: TreeProjectionNode[];
  linkedInTree: TreeProjectionNode[];
  associatedFamilies: TreeProjectionFamily[];
  linkedFamilies: TreeProjectionFamily[];
  privacyAudienceFamilies: TreeProjectionFamily[];
  directoryMembers: TreeProjectionNode[];
  nonTreeAdminQueue: any[];
};

export type TreeAggregate = {
  familyCode: string;
  treeVersion: number;
  people: TreeProjectionNode[];
  nodes: TreeProjectionNode[];
  projection: TreeProjectionResult;
};

@Injectable()
export class TreeProjectionService {
  constructor(
    @InjectConnection()
    private readonly sequelize: Sequelize,
    @InjectModel(Family)
    private readonly familyModel: typeof Family,
    @InjectModel(FamilyTree)
    private readonly familyTreeModel: typeof FamilyTree,
    @InjectModel(FamilyMember)
    private readonly familyMemberModel: typeof FamilyMember,
    @InjectModel(User)
    private readonly userModel: typeof User,
    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,
    private readonly uploadService: UploadService,
  ) {}

  normalizeFamilyCode(value: unknown): string {
    return String(value || '').trim().toUpperCase();
  }

  private normalizeGender(value: unknown): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'male' || normalized === 'female') {
      return normalized;
    }
    return 'unknown';
  }

  private normalizeNodeType(value: unknown): TreeNodeType | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (
      normalized === 'birth' ||
      normalized === 'associated' ||
      normalized === 'linked' ||
      normalized === 'structural_dummy'
    ) {
      return normalized as TreeNodeType;
    }
    return null;
  }

  resolveNodeType(params: {
    entry: any;
    treeFamilyCode: string;
    primaryFamilyCode?: string | null;
  }): TreeNodeType {
    const treeFamilyCode = this.normalizeFamilyCode(params.treeFamilyCode);
    const entry = params.entry || {};
    const explicitNodeType = this.normalizeNodeType(entry.nodeType);
    if (entry.isStructuralDummy) {
      return 'structural_dummy';
    }
    if (entry.isExternalLinked) {
      return 'linked';
    }

    const primaryFamilyCode = this.normalizeFamilyCode(params.primaryFamilyCode);

    if (
      explicitNodeType &&
      explicitNodeType !== 'birth' &&
      explicitNodeType !== 'linked'
    ) {
      return explicitNodeType;
    }

    if (primaryFamilyCode && treeFamilyCode && primaryFamilyCode !== treeFamilyCode) {
      return 'associated';
    }

    return explicitNodeType || 'birth';
  }

  private async inferPrimaryFamilyCodesForUserIds(
    userIds: number[],
    transaction?: any,
  ): Promise<Map<number, string>> {
    const normalizedUserIds = Array.from(
      new Set(
        (userIds || [])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0),
      ),
    );

    const result = new Map<number, string>();
    if (!normalizedUserIds.length) {
      return result;
    }

    const memberships = await this.sequelize.query<
      { userId: number; familyCode: string }[]
    >(
      `
      SELECT
        "memberId" as "userId",
        "familyCode" as "familyCode"
      FROM public.ft_family_members
      WHERE "memberId" IN (:userIds)
        AND "approveStatus" IN ('approved','associated')
      ORDER BY id ASC
    `,
      {
        replacements: { userIds: normalizedUserIds },
        type: QueryTypes.SELECT,
        ...(transaction ? { transaction } : {}),
      },
    );

    (memberships || []).forEach((row: any) => {
      const userId = Number(row?.userId);
      const familyCode = this.normalizeFamilyCode(row?.familyCode);
      if (!userId || !familyCode || result.has(userId)) {
        return;
      }
      result.set(userId, familyCode);
    });

    const remainingUserIds = normalizedUserIds.filter((userId) => !result.has(userId));
    if (!remainingUserIds.length) {
      return result;
    }

    const earliestCards = await this.familyTreeModel.findAll({
      where: {
        userId: { [Op.in]: remainingUserIds },
      } as any,
      order: [['id', 'ASC']],
      ...(transaction ? { transaction } : {}),
    });

    (earliestCards as any[]).forEach((card: any) => {
      const userId = Number(card?.userId);
      const familyCode = this.normalizeFamilyCode(card?.familyCode);
      if (!userId || !familyCode || result.has(userId)) {
        return;
      }
      result.set(userId, familyCode);
    });

    return result;
  }

  private async loadTreeEntries(
    familyCode: string,
    transaction?: any,
  ): Promise<any[]> {
    const normalizedFamilyCode = this.normalizeFamilyCode(familyCode);
    if (!normalizedFamilyCode) {
      return [];
    }

    return this.familyTreeModel.findAll({
      where: { familyCode: normalizedFamilyCode } as any,
      include: [
        {
          model: this.userModel,
          as: 'user',
          required: false,
          attributes: [
            'id',
            'email',
            'mobile',
            'countryCode',
            'role',
            'status',
            'isAppUser',
            'medusaCustomerId',
          ],
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
            },
          ],
        },
      ],
      order: [['generation', 'ASC'], ['personId', 'ASC'], ['id', 'ASC']],
      ...(transaction ? { transaction } : {}),
    });
  }

  private buildUniqueEntries(entries: any[]): any[] {
    return (entries || []).reduce((unique: any[], entry: any) => {
      const existingIndex = unique.findIndex(
        (candidate) =>
          Number(candidate?.personId) === Number(entry?.personId) &&
          Number(candidate?.userId || 0) === Number(entry?.userId || 0),
      );
      if (existingIndex === -1) {
        unique.push(entry);
        return unique;
      }

      const existing = unique[existingIndex];
      existing.parents = Array.from(
        new Set([...(existing.parents || []), ...(entry.parents || [])]),
      );
      existing.children = Array.from(
        new Set([...(existing.children || []), ...(entry.children || [])]),
      );
      existing.spouses = Array.from(
        new Set([...(existing.spouses || []), ...(entry.spouses || [])]),
      );
      existing.siblings = Array.from(
        new Set([...(existing.siblings || []), ...(entry.siblings || [])]),
      );
      return unique;
    }, []);
  }

  async buildTreeNodes(
    familyCode: string,
    options?: {
      requestingUserId?: number;
      transaction?: any;
      entries?: any[];
    },
  ): Promise<TreeProjectionNode[]> {
    const normalizedFamilyCode = this.normalizeFamilyCode(familyCode);
    const entries = this.buildUniqueEntries(
      Array.isArray(options?.entries)
        ? options.entries
        : await this.loadTreeEntries(normalizedFamilyCode, options?.transaction),
    );

    const userIdsNeedingPrimaryFamily = Array.from(
      new Set(
        entries
          .filter((entry: any) => Boolean(entry?.userId))
          .map((entry: any) => Number(entry.userId))
          .filter((userId) => Number.isFinite(userId) && userId > 0),
      ),
    );
    const inferredPrimaryFamilyByUserId = await this.inferPrimaryFamilyCodesForUserIds(
      userIdsNeedingPrimaryFamily,
      options?.transaction,
    );

    return Promise.all(
      entries.map(async (entry: any) => {
        const userProfile = entry?.user?.userProfile || null;
        const primaryFamilyCode = this.normalizeFamilyCode(
          userProfile?.familyCode ||
            inferredPrimaryFamilyByUserId.get(Number(entry?.userId)),
        ) || null;
        const nodeType = this.resolveNodeType({
          entry,
          treeFamilyCode: normalizedFamilyCode,
          primaryFamilyCode,
        });
        const isStructuralDummy = Boolean(entry?.isStructuralDummy) || nodeType === 'structural_dummy';

        let img: string | null = null;
        if (userProfile?.profile) {
          try {
            img = this.uploadService.getFileUrl(userProfile.profile, 'profile');
          } catch (_) {
            img = userProfile.profile || null;
          }
        }

        const phoneVisible = canViewScopedField(
          userProfile?.phonePrivacy,
          Number(entry?.userId) === Number(options?.requestingUserId) ? 'self' : 'family',
        );
        const mobile = phoneVisible ? entry?.user?.mobile || null : null;
        const countryCode = phoneVisible ? entry?.user?.countryCode || null : null;
        const contactNumber = phoneVisible
          ? userProfile?.contactNumber ||
            (countryCode && mobile ? `${countryCode}${mobile}` : mobile) ||
            null
          : null;

        const canonicalFamilyCode = this.normalizeFamilyCode(entry?.canonicalFamilyCode) || null;
        const sourceFamilyCode =
          nodeType === 'linked'
            ? canonicalFamilyCode || primaryFamilyCode || normalizedFamilyCode
            : primaryFamilyCode || normalizedFamilyCode;

        return {
          id: Number(entry?.personId) || null,
          personId: Number(entry?.personId) || null,
          nodeUid: entry?.nodeUid || null,
          userId: Number(entry?.userId) || null,
          memberId: Number(entry?.userId) || null,
          name: isStructuralDummy
            ? 'Removed member'
            : userProfile
              ? [userProfile.firstName, userProfile.lastName].filter(Boolean).join(' ').trim() ||
                'Family Member'
              : 'Unknown',
          gender: this.normalizeGender(userProfile?.gender),
          age: userProfile?.age || null,
          contactNumber,
          mobile,
          countryCode,
          generation: entry?.generation ?? null,
          lifeStatus: entry?.lifeStatus || 'living',
          parents: Array.isArray(entry?.parents) ? entry.parents : [],
          children: Array.isArray(entry?.children) ? entry.children : [],
          spouses: Array.isArray(entry?.spouses) ? entry.spouses : [],
          siblings: Array.isArray(entry?.siblings) ? entry.siblings : [],
          img,
          familyCode: primaryFamilyCode || this.normalizeFamilyCode(entry?.familyCode) || normalizedFamilyCode,
          treeFamilyCode: this.normalizeFamilyCode(entry?.familyCode) || normalizedFamilyCode,
          primaryFamilyCode,
          sourceFamilyCode,
          associatedFamilyCodes: Array.isArray(userProfile?.associatedFamilyCodes)
            ? userProfile.associatedFamilyCodes
                .map((code: unknown) => this.normalizeFamilyCode(code))
                .filter(Boolean)
            : [],
          isAppUser: Boolean(entry?.user?.isAppUser),
          isExternalLinked: Boolean(entry?.isExternalLinked),
          isStructuralDummy,
          nodeType,
          canonicalFamilyCode,
          canonicalNodeUid: entry?.canonicalNodeUid || null,
          role: Number(entry?.user?.role) || null,
          status: Number(entry?.user?.status) || null,
          email: entry?.user?.email || null,
          userProfile: userProfile
            ? {
                ...(userProfile.toJSON ? userProfile.toJSON() : userProfile),
                familyCode: primaryFamilyCode,
                profileImage: img,
              }
            : null,
        };
      }),
    );
  }

  private buildFamilyList(
    nodes: TreeProjectionNode[],
    nodeType: 'associated' | 'linked',
  ): TreeProjectionFamily[] {
    const families = new Map<string, TreeProjectionFamily>();
    nodes
      .filter((node) => !node.isStructuralDummy && node.nodeType === nodeType)
      .forEach((node) => {
        const familyCode = this.normalizeFamilyCode(node.sourceFamilyCode);
        if (!familyCode) {
          return;
        }
        const current = families.get(familyCode);
        if (current) {
          current.memberCount += 1;
          return;
        }
        families.set(familyCode, {
          familyCode,
          familyName: familyCode,
          memberCount: 1,
          nodeType,
        });
      });
    return Array.from(families.values());
  }

  buildProjection(
    familyCode: string,
    nodes: TreeProjectionNode[],
    nonTreeAdminQueue: any[] = [],
  ): TreeProjectionResult {
    const normalizedFamilyCode = this.normalizeFamilyCode(familyCode);
    const activeNodes = (nodes || []).filter(
      (node) =>
        !node.isStructuralDummy &&
        (node.nodeType === 'birth' ||
          node.nodeType === 'associated' ||
          node.nodeType === 'linked'),
    );

    const directoryMembers = activeNodes.filter((node) => {
      const sourceFamilyCode = this.normalizeFamilyCode(node.sourceFamilyCode);
      if (node.nodeType === 'birth') {
        return true;
      }
      return Boolean(sourceFamilyCode && sourceFamilyCode !== normalizedFamilyCode);
    });

    const associatedInTree = activeNodes.filter((node) => node.nodeType === 'associated');
    const linkedInTree = activeNodes.filter((node) => node.nodeType === 'linked');
    const associatedFamilies = this.buildFamilyList(associatedInTree, 'associated');
    const linkedFamilies = this.buildFamilyList(linkedInTree, 'linked');

    const privacyAudienceMap = new Map<string, TreeProjectionFamily>();
    [...associatedFamilies, ...linkedFamilies].forEach((family) => {
      privacyAudienceMap.set(family.familyCode, family);
    });

    return {
      associatedInTree,
      linkedInTree,
      associatedFamilies,
      linkedFamilies,
      privacyAudienceFamilies: Array.from(privacyAudienceMap.values()),
      directoryMembers,
      nonTreeAdminQueue,
    };
  }

  async getNonTreeAdminQueue(
    familyCode: string,
    transaction?: any,
  ): Promise<any[]> {
    const normalizedFamilyCode = this.normalizeFamilyCode(familyCode);
    if (!normalizedFamilyCode) {
      return [];
    }

    const [allMembers, treeEntries] = await Promise.all([
      this.familyMemberModel.findAll({
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
                attributes: [
                  'firstName',
                  'lastName',
                  'profile',
                  'dob',
                  'gender',
                  'address',
                  'familyCode',
                  'contactNumber',
                  'emailPrivacy',
                  'addressPrivacy',
                  'phonePrivacy',
                ],
              },
            ],
          },
        ],
        ...(transaction ? { transaction } : {}),
      }),
      this.familyTreeModel.findAll({
        where: {
          familyCode: normalizedFamilyCode,
          isStructuralDummy: false,
        } as any,
        attributes: ['userId'],
        ...(transaction ? { transaction } : {}),
      }),
    ]);

    const userIdsInTree = new Set<number>(
      (treeEntries as any[])
        .map((entry: any) => Number(entry?.userId))
        .filter((userId) => Number.isFinite(userId) && userId > 0),
    );

    return (allMembers as any[])
      .filter((member: any) => {
        const userId = Number(member?.memberId);
        const isAppUser = Boolean(member?.user?.isAppUser);
        return isAppUser && !userIdsInTree.has(userId);
      })
      .map((member: any) => {
        const user = member?.user;
        return {
          id: member?.id,
          memberId: member?.memberId,
          familyCode: normalizedFamilyCode,
          approveStatus: member?.approveStatus,
          membershipType: 'member',
          sourceFamilyCode: normalizedFamilyCode,
          user: {
            id: user?.id,
            email: user?.email || null,
            mobile: user?.mobile || null,
            countryCode: user?.countryCode || null,
            isAppUser: Boolean(user?.isAppUser),
            role: user?.role || 1,
            fullName: user?.userProfile
              ? `${user.userProfile.firstName || ''} ${user.userProfile.lastName || ''}`.trim()
              : null,
            profileImage: user?.userProfile?.profile || null,
            userProfile: user?.userProfile || null,
          },
        };
      });
  }

  async getFamilyAggregate(
    familyCode: string,
    options?: {
      requestingUserId?: number;
      transaction?: any;
      includeAdminQueue?: boolean;
    },
  ): Promise<TreeAggregate> {
    const normalizedFamilyCode = this.normalizeFamilyCode(familyCode);
    const family = await this.familyModel.findOne({
      where: { familyCode: normalizedFamilyCode } as any,
      attributes: ['familyCode', 'treeVersion'],
      ...(options?.transaction ? { transaction: options.transaction } : {}),
    });

    const nodes = await this.buildTreeNodes(normalizedFamilyCode, {
      requestingUserId: options?.requestingUserId,
      transaction: options?.transaction,
    });
    const nonTreeAdminQueue = options?.includeAdminQueue
      ? await this.getNonTreeAdminQueue(normalizedFamilyCode, options?.transaction)
      : [];

    return {
      familyCode: normalizedFamilyCode,
      treeVersion: Number((family as any)?.treeVersion || 0),
      people: nodes,
      nodes,
      projection: this.buildProjection(normalizedFamilyCode, nodes, nonTreeAdminQueue),
    };
  }

  async getReachableFamilyCodesForUser(userId: number): Promise<string[]> {
    const normalizedUserId = Number(userId);
    if (!normalizedUserId) {
      return [];
    }

    const treeEntries = await this.familyTreeModel.findAll({
      where: {
        userId: normalizedUserId,
        isStructuralDummy: false,
      } as any,
      attributes: ['familyCode'],
    });

    const treeFamilyCodes = Array.from(
      new Set(
        (treeEntries as any[])
          .map((entry: any) => this.normalizeFamilyCode(entry?.familyCode))
          .filter(Boolean),
      ),
    );

    if (!treeFamilyCodes.length) {
      return [];
    }

    const reachable = new Set<string>();
    for (const familyCode of treeFamilyCodes) {
      reachable.add(familyCode);
      const aggregate = await this.getFamilyAggregate(familyCode, {
        requestingUserId: normalizedUserId,
      });
      (aggregate?.projection?.privacyAudienceFamilies || []).forEach((family) => {
        const linkedFamilyCode = this.normalizeFamilyCode(family?.familyCode);
        if (linkedFamilyCode) {
          reachable.add(linkedFamilyCode);
        }
      });
    }

    return Array.from(reachable);
  }
}

