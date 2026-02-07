// notifications.service.ts
import { Injectable, NotFoundException, Inject, forwardRef, BadRequestException, Optional, ForbiddenException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op, QueryTypes } from 'sequelize';
import { Notification } from './model/notification.model';
import { NotificationRecipient } from './model/notification-recipients.model';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { FamilyMember } from '../family/model/family-member.model';
import { FamilyLink } from '../family/model/family-link.model';
import { TreeLinkRequest } from '../family/model/tree-link-request.model';
import { TreeLink } from '../family/model/tree-link.model';
import { repairFamilyTreeIntegrity } from '../family/tree-integrity';
import { FamilyMemberService } from '../family/family-member.service';
import { NotificationGateway } from './notification.gateway';
import { BlockingService } from '../blocking/blocking.service';

// Optional services
// import { MailService } from '../mail/mail.service';
// import { UploadService } from '../upload/upload.service';

const dayjs = require('dayjs');

@Injectable()
export class NotificationService {
  async getNotificationById(id: number) {
    return this.notificationModel.findOne({
      where: { id },
      include: [
        {
          model: NotificationRecipient,
          as: 'recipients',
        },
      ],
    });
  }

  async markAsAccepted(notificationId: number) {
    console.log(`🔧 DEBUG: Marking notification ${notificationId} as accepted`);
    const result = await this.notificationModel.update(
      { status: 'accepted', updatedAt: new Date() },
      { where: { id: notificationId } },
    );
    console.log(`🔧 DEBUG: Update result for accepted:`, result);

    // Verify the update worked
    const updated = await this.notificationModel.findByPk(notificationId);
    console.log(`🔧 DEBUG: Notification after update:`, {
      id: updated?.id,
      status: updated?.status,
    });

    return result;
  }

  async markAsRejected(notificationId: number) {
    console.log(`🔧 DEBUG: Marking notification ${notificationId} as rejected`);
    const result = await this.notificationModel.update(
      { status: 'rejected', updatedAt: new Date() },
      { where: { id: notificationId } },
    );
    console.log(`🔧 DEBUG: Update result for rejected:`, result);

    // Verify the update worked
    const updated = await this.notificationModel.findByPk(notificationId);
    console.log(`🔧 DEBUG: Notification after update:`, {
      id: updated?.id,
      status: updated?.status,
    });

    return result;
  }
  constructor(
    @InjectModel(Notification)
    private notificationModel: typeof Notification,

    @InjectModel(NotificationRecipient)
    private recipientModel: typeof NotificationRecipient,

    @InjectModel(User)
    private userModel: typeof User,

    @InjectModel(UserProfile)
    private UserProfileModel: typeof UserProfile,

    @InjectModel(FamilyMember)
    private familyMemberModel: typeof FamilyMember,

    @InjectModel(FamilyLink)
    private familyLinkModel: typeof FamilyLink,

    @InjectModel(TreeLinkRequest)
    private treeLinkRequestModel: typeof TreeLinkRequest,

    @InjectModel(TreeLink)
    private treeLinkModel: typeof TreeLink,

    @InjectConnection()
    private readonly sequelize: Sequelize,

    @Inject(forwardRef(() => FamilyMemberService))
    private readonly familyMemberService: FamilyMemberService,

    @Inject(forwardRef(() => NotificationGateway))
    private readonly notificationGateway: NotificationGateway,

    @Inject(forwardRef(() => BlockingService))
    private readonly blockingService: BlockingService,

    @Optional()
    private readonly mailService?: any, // Using 'any' to avoid type errors for optional services

    @Optional()
    private readonly uploadService?: any, // Removed family service injection to avoid circular dependency
  ) {}

  private normalizeFamilyPair(a: string, b: string) {
    const low = a <= b ? a : b;
    const high = a <= b ? b : a;
    const aIsLow = low === a;
    return { low, high, aIsLow };
  }

  private invertRelationshipType(t: string): string {
    if (t === 'parent') return 'child';
    if (t === 'child') return 'parent';
    return 'sibling';
  }

  private async isFamilyAdmin(userId: number, familyCode: string): Promise<boolean> {
    if (!userId || !familyCode) {
      return false;
    }

    const user = await this.userModel.findByPk(Number(userId));
    const role = Number((user as any)?.role);
    if (![2, 3].includes(role)) {
      return false;
    }

    const membership = await this.familyMemberModel.findOne({
      where: {
        familyCode,
        memberId: Number(userId),
        approveStatus: 'approved',
      } as any,
      order: [['id', 'DESC']],
    });

    return Boolean(membership);
  }

  private async ensureFamilyLink(
    familyA: string,
    familyB: string,
    source: string,
    transaction: any,
  ) {
    const { low, high } = this.normalizeFamilyPair(familyA, familyB);
    await this.familyLinkModel.findOrCreate({
      where: { familyCodeLow: low, familyCodeHigh: high },
      defaults: {
        familyCodeLow: low,
        familyCodeHigh: high,
        source: source || 'tree',
        status: 'active',
      } as any,
      transaction,
    });
  }

  private async ensureTreeLink(
    senderFamilyCode: string,
    receiverFamilyCode: string,
    senderNodeUid: string,
    receiverNodeUid: string,
    relationshipTypeSenderToReceiver: string,
    createdBy: number,
    transaction: any,
  ) {
    const { low, high, aIsLow } = this.normalizeFamilyPair(
      senderFamilyCode,
      receiverFamilyCode,
    );

    const nodeUidLow = aIsLow ? senderNodeUid : receiverNodeUid;
    const nodeUidHigh = aIsLow ? receiverNodeUid : senderNodeUid;
    const relationshipTypeLowToHigh = aIsLow
      ? relationshipTypeSenderToReceiver
      : this.invertRelationshipType(relationshipTypeSenderToReceiver);

    await this.treeLinkModel.findOrCreate({
      where: {
        familyCodeLow: low,
        familyCodeHigh: high,
        nodeUidLow,
        nodeUidHigh,
        relationshipTypeLowToHigh,
      } as any,
      defaults: {
        familyCodeLow: low,
        familyCodeHigh: high,
        nodeUidLow,
        nodeUidHigh,
        relationshipTypeLowToHigh,
        status: 'active',
        createdBy,
      } as any,
      transaction,
    });
  }

  private getOtherGeneration(baseGen: number, rel: string): number {
    const g = Number.isFinite(baseGen as any) ? Number(baseGen) : 0;
    // In this app, generations increase downward: parents are one level ABOVE the child.
    // Example: parent=-1, child=0.
    if (rel === 'parent') return g - 1;
    if (rel === 'child') return g + 1;
    return g;
  }

  private async ensureExternalLinkedCardInFamily(params: {
    targetFamilyCode: string;
    nodeUid: string;
    canonicalFamilyCode: string;
    canonicalNodeUid: string;
    canonicalUserId: number | null;
    desiredGeneration: number;
    transaction: any;
  }) {
    const {
      targetFamilyCode,
      nodeUid,
      canonicalFamilyCode,
      canonicalNodeUid,
      canonicalUserId,
      desiredGeneration,
      transaction,
    } = params;

    const { FamilyTree } = await import('../family/model/family-tree.model');

    let resolvedCanonicalUserId: number | null =
      canonicalUserId !== null && canonicalUserId !== undefined
        ? Number(canonicalUserId)
        : null;
    if (!resolvedCanonicalUserId && canonicalFamilyCode && canonicalNodeUid) {
      const canonicalRow = await FamilyTree.findOne({
        where: {
          familyCode: canonicalFamilyCode,
          nodeUid: canonicalNodeUid,
        } as any,
        transaction,
      });
      const uid = Number((canonicalRow as any)?.userId);
      if (Number.isFinite(uid) && uid > 0) {
        resolvedCanonicalUserId = uid;
      }
    }

    const existing = await FamilyTree.findOne({
      where: { familyCode: targetFamilyCode, nodeUid },
      transaction,
    });
    if (existing) {
      // If already exists as an external-linked card, keep it consistent.
      // If it exists as a local card, do not force it to external.
      const existingUserId = Number((existing as any)?.userId);
      const canonicalUserIdNum =
        resolvedCanonicalUserId !== null && resolvedCanonicalUserId !== undefined
          ? Number(resolvedCanonicalUserId)
          : NaN;
      const matchesCanonicalUser =
        Number.isFinite(canonicalUserIdNum) &&
        canonicalUserIdNum > 0 &&
        Number.isFinite(existingUserId) &&
        existingUserId === canonicalUserIdNum;

      const hasCanonicalInfo =
        Boolean((existing as any).canonicalFamilyCode) ||
        Boolean((existing as any).canonicalNodeUid);

      // If a canonical user already has a "local" card in this family (e.g. via association),
      // but this link flow expects an external-linked card, upgrade it so unlinking and
      // canonical rendering work consistently.
      if (
        !(existing as any).isExternalLinked &&
        matchesCanonicalUser &&
        !hasCanonicalInfo &&
        canonicalFamilyCode &&
        canonicalNodeUid
      ) {
        await existing.update(
          {
            isExternalLinked: true,
            generation: desiredGeneration,
            canonicalFamilyCode,
            canonicalNodeUid,
          } as any,
          { transaction },
        );
        return existing;
      }

      if ((existing as any).isExternalLinked) {
        const needsGenUpdate =
          Number((existing as any).generation || 0) !== Number(desiredGeneration || 0);
        const needsCanonicalUpdate =
          ((existing as any).canonicalFamilyCode || null) !==
            (canonicalFamilyCode || null) ||
          String((existing as any).canonicalNodeUid || '') !==
            String(canonicalNodeUid || '');

        const needsUserIdUpdate =
          ((existing as any)?.userId === null || (existing as any)?.userId === undefined) &&
          resolvedCanonicalUserId;

        if (needsGenUpdate || needsCanonicalUpdate || needsUserIdUpdate) {
          await existing.update(
            {
              generation: desiredGeneration,
              canonicalFamilyCode,
              canonicalNodeUid,
              ...(needsUserIdUpdate ? { userId: resolvedCanonicalUserId } : {}),
            } as any,
            { transaction },
          );
        }
      }
      return existing;
    }

    const personId = await this.getNextPersonId(targetFamilyCode, transaction);
    const created = await FamilyTree.create(
      {
        familyCode: targetFamilyCode,
        userId: resolvedCanonicalUserId || null,
        personId,
        generation: desiredGeneration,
        lifeStatus: 'living',
        parents: [],
        children: [],
        spouses: [],
        siblings: [],
        nodeUid,
        isExternalLinked: true,
        canonicalFamilyCode,
        canonicalNodeUid,
      } as any,
      { transaction },
    );

    return created;
  }

  private mergeUnique(list: any, value: number): number[] {
    const arr = Array.isArray(list) ? list.map((x) => Number(x)) : [];
    if (!arr.includes(Number(value))) {
      arr.push(Number(value));
    }
    return arr;
  }

  private removeUnique(list: any, value: number): number[] {
    const arr = Array.isArray(list) ? list.map((x) => Number(x)) : [];
    return arr.filter((x) => Number.isFinite(x) && Number(x) !== Number(value));
  }

  private normalizeGenderValue(g: any): string {
    const s = String(g || '').toLowerCase().trim();
    if (s === 'male' || s === 'm' || s === 'man') return 'male';
    if (s === 'female' || s === 'f' || s === 'woman') return 'female';
    return '';
  }

  private async replaceParentByRoleInFamily(params: {
    familyCode: string;
    childPersonId: number;
    newParentPersonId: number;
    parentRole: string;
    transaction: any;
  }) {
    const { familyCode, childPersonId, newParentPersonId, parentRole, transaction } =
      params;

    const role = String(parentRole || '').toLowerCase().trim();
    if (!['father', 'mother'].includes(role)) return;

    const { FamilyTree } = await import('../family/model/family-tree.model');

    const child = await FamilyTree.findOne({
      where: { familyCode, personId: childPersonId } as any,
      transaction,
    });
    if (!child) return;

    const existingParents = Array.isArray((child as any).parents)
      ? (child as any).parents.map((x: any) => Number(x)).filter((x: any) => Number.isFinite(x))
      : [];

    const candidateParentIds = existingParents.filter(
      (pid) => Number(pid) !== Number(newParentPersonId),
    );
    if (candidateParentIds.length === 0) return;

    const parentRows = await FamilyTree.findAll({
      where: {
        familyCode,
        personId: { [Op.in]: candidateParentIds },
      } as any,
      transaction,
    });

    const roleGender = role === 'father' ? 'male' : 'female';

    const genderByPersonId = new Map<number, string>();
    await Promise.all(
      (parentRows as any[]).map(async (p: any) => {
        const pid = Number(p?.personId);
        const uid = p?.userId ? Number(p.userId) : null;
        if (!Number.isFinite(pid)) return;
        if (!uid) {
          genderByPersonId.set(pid, '');
          return;
        }
        const profile = await this.UserProfileModel.findOne({
          where: { userId: uid } as any,
          attributes: ['gender', 'userId'],
          transaction,
        });
        genderByPersonId.set(pid, this.normalizeGenderValue((profile as any)?.gender));
      }),
    );

    const matchesRole = (pid: number) => genderByPersonId.get(pid) === roleGender;

    const roleMatchedParents = candidateParentIds.filter(matchesRole);
    const parentToRemove = roleMatchedParents.length > 0 ? roleMatchedParents[0] : null;
    if (!parentToRemove) return;

    const otherParentId = candidateParentIds.find(
      (pid) => Number(pid) !== Number(parentToRemove),
    );

    const [removedParent, otherParent, newParent] = await Promise.all([
      FamilyTree.findOne({ where: { familyCode, personId: parentToRemove } as any, transaction }),
      otherParentId
        ? FamilyTree.findOne({ where: { familyCode, personId: otherParentId } as any, transaction })
        : Promise.resolve(null as any),
      FamilyTree.findOne({
        where: { familyCode, personId: newParentPersonId } as any,
        transaction,
      }),
    ]);

    await (child as any).update(
      { parents: this.removeUnique((child as any).parents, parentToRemove) } as any,
      { transaction },
    );

    if (removedParent) {
      await (removedParent as any).update(
        { children: this.removeUnique((removedParent as any).children, childPersonId) } as any,
        { transaction },
      );
    }

    if (otherParent && newParent) {
      const otherSpouses = Array.isArray((otherParent as any).spouses)
        ? (otherParent as any).spouses.map((x: any) => Number(x))
        : [];

      if (otherSpouses.includes(Number(parentToRemove))) {
        await Promise.all([
          (otherParent as any).update(
            {
              spouses: this.mergeUnique(
                this.removeUnique((otherParent as any).spouses, parentToRemove),
                newParentPersonId,
              ),
            } as any,
            { transaction },
          ),
          (newParent as any).update(
            {
              spouses: this.mergeUnique((newParent as any).spouses, Number((otherParent as any).personId)),
            } as any,
            { transaction },
          ),
          removedParent
            ? (removedParent as any).update(
                { spouses: this.removeUnique((removedParent as any).spouses, Number((otherParent as any).personId)) } as any,
                { transaction },
              )
            : Promise.resolve(),
        ]);
      }
    }
  }

  private async ensureSpouseLinkBetweenChildParentsIfSafe(params: {
    familyCode: string;
    childPersonId: number;
    transaction: any;
  }) {
    const { familyCode, childPersonId, transaction } = params;
    const { FamilyTree } = await import('../family/model/family-tree.model');

    const child = await FamilyTree.findOne({
      where: { familyCode, personId: childPersonId } as any,
      transaction,
    });
    if (!child) return;

    const parentIds = Array.isArray((child as any).parents)
      ? (child as any).parents
          .map((x: any) => Number(x))
          .filter((x: any) => Number.isFinite(x))
      : [];

    if (parentIds.length !== 2) return;
    const [p1Id, p2Id] = parentIds;
    if (!p1Id || !p2Id || p1Id === p2Id) return;

    const [p1, p2] = await Promise.all([
      FamilyTree.findOne({ where: { familyCode, personId: p1Id } as any, transaction }),
      FamilyTree.findOne({ where: { familyCode, personId: p2Id } as any, transaction }),
    ]);
    if (!p1 || !p2) return;

    const p1Spouses = Array.isArray((p1 as any).spouses)
      ? (p1 as any).spouses.map((x: any) => Number(x)).filter((x: any) => Number.isFinite(x))
      : [];
    const p2Spouses = Array.isArray((p2 as any).spouses)
      ? (p2 as any).spouses.map((x: any) => Number(x)).filter((x: any) => Number.isFinite(x))
      : [];

    const hasOtherSpouse = (spouses: number[], otherId: number) => {
      const other = Number(otherId);
      return spouses.some((sid) => Number.isFinite(sid) && sid !== other);
    };

    // Do not override/merge if either parent already has a different spouse link in this family.
    if (hasOtherSpouse(p1Spouses, p2Id) || hasOtherSpouse(p2Spouses, p1Id)) {
      return;
    }

    const updatedP1Spouses = this.mergeUnique(p1Spouses, p2Id);
    const updatedP2Spouses = this.mergeUnique(p2Spouses, p1Id);

    const p1Changed = JSON.stringify(updatedP1Spouses) !== JSON.stringify(p1Spouses);
    const p2Changed = JSON.stringify(updatedP2Spouses) !== JSON.stringify(p2Spouses);

    if (p1Changed || p2Changed) {
      await Promise.all([
        p1Changed
          ? (p1 as any).update({ spouses: updatedP1Spouses } as any, { transaction })
          : Promise.resolve(),
        p2Changed
          ? (p2 as any).update({ spouses: updatedP2Spouses } as any, { transaction })
          : Promise.resolve(),
      ]);
    }
  }

  private async getUserName(userId: number): Promise<string> {
    if (!userId) {
      return 'A user';
    }

    const userProfile = await this.UserProfileModel.findOne({
      where: { userId },
      attributes: ['firstName', 'lastName', 'userId'],
    });

    const firstName = (userProfile as any)?.firstName || '';
    const lastName = (userProfile as any)?.lastName || '';
    const fullName = `${firstName} ${lastName}`.trim();
    return fullName || 'A user';
  }

  private async updateLocalRelationship(params: {
    familyCode: string;
    aPersonId: number;
    bPersonId: number;
    relationshipTypeAtoB: string;
    transaction: any;
  }) {
    const { familyCode, aPersonId, bPersonId, relationshipTypeAtoB, transaction } =
      params;
    const { FamilyTree } = await import('../family/model/family-tree.model');

    const [a, b] = await Promise.all([
      FamilyTree.findOne({ where: { familyCode, personId: aPersonId }, transaction }),
      FamilyTree.findOne({ where: { familyCode, personId: bPersonId }, transaction }),
    ]);

    if (!a || !b) {
      return;
    }

    if (relationshipTypeAtoB === 'parent') {
      await Promise.all([
        a.update({ children: this.mergeUnique(a.children, bPersonId) } as any, { transaction }),
        b.update({ parents: this.mergeUnique(b.parents, aPersonId) } as any, { transaction }),
      ]);
      return;
    }

    if (relationshipTypeAtoB === 'child') {
      await Promise.all([
        a.update({ parents: this.mergeUnique(a.parents, bPersonId) } as any, { transaction }),
        b.update({ children: this.mergeUnique(b.children, aPersonId) } as any, { transaction }),
      ]);
      return;
    }

    // sibling
    await Promise.all([
      a.update({ siblings: this.mergeUnique(a.siblings, bPersonId) } as any, { transaction }),
      b.update({ siblings: this.mergeUnique(b.siblings, aPersonId) } as any, { transaction }),
    ]);
  }

  private async linkAsSiblingByParents(params: {
    familyCode: string;
    canonicalPersonId: number;
    externalPersonId: number;
    canonicalParents: number[];
    transaction: any;
  }) {
    const { familyCode, canonicalPersonId, externalPersonId, canonicalParents, transaction } =
      params;

    if (!Array.isArray(canonicalParents) || canonicalParents.length === 0) {
      await this.updateLocalRelationship({
        familyCode,
        aPersonId: canonicalPersonId,
        bPersonId: externalPersonId,
        relationshipTypeAtoB: 'sibling',
        transaction,
      });
      return;
    }

    const { FamilyTree } = await import('../family/model/family-tree.model');
    const [canonical, external] = await Promise.all([
      FamilyTree.findOne({ where: { familyCode, personId: canonicalPersonId }, transaction }),
      FamilyTree.findOne({ where: { familyCode, personId: externalPersonId }, transaction }),
    ]);
    if (!canonical || !external) {
      return;
    }

    await Promise.all([
      canonical.update(
        { siblings: this.mergeUnique((canonical as any).siblings, externalPersonId) } as any,
        { transaction },
      ),
      external.update(
        {
          siblings: this.mergeUnique((external as any).siblings, canonicalPersonId),
          parents: canonicalParents.reduce(
            (acc: number[], pid: any) => this.mergeUnique(acc, Number(pid)),
            Array.isArray((external as any).parents) ? (external as any).parents.map((x: any) => Number(x)) : [],
          ),
        } as any,
        { transaction },
      ),
    ]);

    await Promise.all(
      canonicalParents.map(async (pid) => {
        const parentPersonId = Number(pid);
        if (!Number.isFinite(parentPersonId)) return;
        const parent = await FamilyTree.findOne({
          where: { familyCode, personId: parentPersonId },
          transaction,
        });
        if (!parent) return;
        await parent.update(
          { children: this.mergeUnique((parent as any).children, externalPersonId) } as any,
          { transaction },
        );
      }),
    );
  }

  private async propagateChildToCanonicalSpouses(params: {
    familyCode: string;
    canonicalParentPersonId: number;
    childPersonId: number;
    transaction: any;
  }) {
    const { familyCode, canonicalParentPersonId, childPersonId, transaction } = params;
    const { FamilyTree } = await import('../family/model/family-tree.model');

    const canonicalParent = await FamilyTree.findOne({
      where: { familyCode, personId: canonicalParentPersonId },
      transaction,
    });
    if (!canonicalParent) {
      return;
    }

    const spouseIds = Array.isArray((canonicalParent as any).spouses)
      ? (canonicalParent as any).spouses.map((x: any) => Number(x))
      : [];

    const uniqueSpouses = Array.from(new Set(spouseIds)).filter((x) => Number.isFinite(x));
    if (uniqueSpouses.length === 0) {
      return;
    }

    await Promise.all(
      uniqueSpouses.map((spousePersonId) =>
        this.updateLocalRelationship({
          familyCode,
          aPersonId: Number(spousePersonId),
          bPersonId: childPersonId,
          relationshipTypeAtoB: 'parent',
          transaction,
        }),
      ),
    );
  }

  async createTreeLinkRequestNotification(params: {
    requesterUserId: number;
    senderNodeUid: string;
    receiverFamilyCode: string;
    receiverNodeUid: string;
    relationshipType: 'parent' | 'child' | 'sibling';
    parentRole?: 'father' | 'mother';
  }) {
    const {
      requesterUserId,
      senderNodeUid,
      receiverFamilyCode,
      receiverNodeUid,
      relationshipType,
      parentRole,
    } = params;

    if (!requesterUserId) {
      throw new BadRequestException('Missing requesterUserId');
    }
    if (!senderNodeUid || !receiverFamilyCode || !receiverNodeUid || !relationshipType) {
      throw new BadRequestException('Missing required fields');
    }
    if (String(receiverFamilyCode).trim().length > 30) {
      throw new BadRequestException('Invalid family code');
    }
    if (String(senderNodeUid).length > 64 || String(receiverNodeUid).length > 64) {
      throw new BadRequestException('Invalid node reference');
    }
    if (!['parent', 'child', 'sibling'].includes(String(relationshipType))) {
      throw new BadRequestException('Invalid relationshipType');
    }

    const normalizedParentRole = parentRole ? String(parentRole).toLowerCase().trim() : '';
    if (normalizedParentRole && !['father', 'mother'].includes(normalizedParentRole)) {
      throw new BadRequestException('Invalid parentRole (must be father or mother)');
    }
    if (normalizedParentRole && String(relationshipType) === 'sibling') {
      throw new BadRequestException('parentRole is only applicable for parent/child links');
    }

    const requesterProfile = await this.UserProfileModel.findOne({
      where: { userId: requesterUserId },
    });
    const senderFamilyCode = requesterProfile?.familyCode;
    if (!senderFamilyCode) {
      throw new BadRequestException('Requester must belong to a family');
    }

    // Validation: requester account must be active and allowed to act.
    const requesterUser = await this.userModel.findByPk(Number(requesterUserId), {
      attributes: ['id', 'status'],
    });
    if (!requesterUser || Number((requesterUser as any).status) !== 1) {
      throw new ForbiddenException('Your account is not active');
    }

    // Only admins can initiate a tree link request.
    const requesterIsAdmin = await this.isFamilyAdmin(requesterUserId, String(senderFamilyCode));
    if (!requesterIsAdmin) {
      throw new ForbiddenException('Only admins can send link requests');
    }

    // If requester is blocked by admin in their own family, they can’t send link requests to any cards.
    const requesterMembership = await this.familyMemberModel.findOne({
      where: {
        familyCode: String(senderFamilyCode),
        memberId: Number(requesterUserId),
      } as any,
      attributes: ['isBlocked'],
      order: [['id', 'DESC']],
    });
    if (requesterMembership && Boolean((requesterMembership as any).isBlocked)) {
      throw new ForbiddenException('Your access is restricted. You can’t send link requests');
    }

    if (String(senderFamilyCode) === String(receiverFamilyCode)) {
      throw new BadRequestException('Cannot create a cross-family link within the same family');
    }

    // Block creation if there is already a pending request between the same two families (either direction).
    const pendingBetweenFamilies = await this.treeLinkRequestModel.findOne({
      where: {
        status: 'pending',
        [Op.or]: [
          { senderFamilyCode: String(senderFamilyCode), receiverFamilyCode: String(receiverFamilyCode) },
          { senderFamilyCode: String(receiverFamilyCode), receiverFamilyCode: String(senderFamilyCode) },
        ],
      } as any,
      order: [['id', 'DESC']],
    });
    if (pendingBetweenFamilies) {
      return {
        message: 'Link request already pending.',
        requestId: Number((pendingBetweenFamilies as any).id),
        notification: null,
      };
    }

    // Prevent requesting a link that already exists as active.
    try {
      const { low, high, aIsLow } = this.normalizeFamilyPair(
        String(senderFamilyCode),
        String(receiverFamilyCode),
      );
      const nodeUidLow = aIsLow ? senderNodeUid : receiverNodeUid;
      const nodeUidHigh = aIsLow ? receiverNodeUid : senderNodeUid;
      const relationshipTypeLowToHigh = aIsLow
        ? String(relationshipType)
        : this.invertRelationshipType(String(relationshipType));

      const existingActive = await this.treeLinkModel.findOne({
        where: {
          familyCodeLow: low,
          familyCodeHigh: high,
          nodeUidLow,
          nodeUidHigh,
          relationshipTypeLowToHigh,
          status: 'active',
        } as any,
        order: [['id', 'DESC']],
      });
      if (existingActive) {
        return {
          message: 'Tree link already active',
          requestId: null,
          notification: null,
        };
      }
    } catch (_) {
      // no-op
    }

    const { FamilyTree } = await import('../family/model/family-tree.model');

    const [senderNode, receiverNode] = await Promise.all([
      FamilyTree.findOne({ where: { familyCode: senderFamilyCode, nodeUid: senderNodeUid } as any }),
      FamilyTree.findOne({ where: { familyCode: receiverFamilyCode, nodeUid: receiverNodeUid } as any }),
    ]);

    if (!senderNode) {
      throw new BadRequestException('Sender nodeUid not found in your family tree');
    }
    if (!receiverNode) {
      throw new BadRequestException('Receiver nodeUid not found in target family tree');
    }

    if ((senderNode as any).isExternalLinked) {
      throw new BadRequestException('Sender node must be a local (non-external) card');
    }
    if ((receiverNode as any).isExternalLinked) {
      throw new BadRequestException('Receiver node must be a local (non-external) card');
    }

    // Extra validation rules based on card ownership.
    const senderNodeUserId = (senderNode as any).userId ? Number((senderNode as any).userId) : null;
    const receiverNodeUserId = (receiverNode as any).userId ? Number((receiverNode as any).userId) : null;

    // Receiving end must be an app user to allow linking.
    if (!receiverNodeUserId) {
      throw new BadRequestException(
        'This person does not have an app account yet. Ask them to join the app first.',
      );
    }

    // Cannot link to your own app user (even across families).
    if (senderNodeUserId && receiverNodeUserId && Number(senderNodeUserId) === Number(receiverNodeUserId)) {
      throw new BadRequestException('You can’t link to your own account');
    }

    // Target user must be active (when the receiver card is tied to an app user).
    if (receiverNodeUserId) {
      const receiverUser = await this.userModel.findByPk(Number(receiverNodeUserId), {
        attributes: ['id', 'status'],
      });
      if (!receiverUser || Number((receiverUser as any).status) !== 1) {
        throw new BadRequestException('Target user account is not active');
      }

      // If the target member is blocked by their family admin, they are not eligible for linking.
      const receiverMembership = await this.familyMemberModel.findOne({
        where: {
          familyCode: String(receiverFamilyCode),
          memberId: Number(receiverNodeUserId),
        } as any,
        attributes: ['isBlocked'],
        order: [['id', 'DESC']],
      });
      if (receiverMembership && Boolean((receiverMembership as any).isBlocked)) {
        throw new BadRequestException('Target member is not available');
      }

      // Prevent linking to members already in the sender's tree (local or external-linked).
      const alreadyInSenderTree = await FamilyTree.findOne({
        where: { familyCode: senderFamilyCode, userId: Number(receiverNodeUserId) } as any,
      });
      if (alreadyInSenderTree) {
        throw new BadRequestException('This member is already in your family tree');
      }
    }

    // Prevent linking to non-app members that are already present in the sender's tree via external links.
    const receiverCanonicalInSenderTree = await FamilyTree.findOne({
      where: {
        familyCode: senderFamilyCode,
        canonicalFamilyCode: receiverFamilyCode,
        canonicalNodeUid: receiverNodeUid,
      } as any,
      order: [['id', 'DESC']],
    });
    if (receiverCanonicalInSenderTree) {
      throw new BadRequestException('This member is already in your family tree');
    }

    // Prevent linking if the sender card’s user already exists in the receiver's tree.
    if (senderNodeUserId) {
      const alreadyInReceiverTree = await FamilyTree.findOne({
        where: { familyCode: receiverFamilyCode, userId: Number(senderNodeUserId) } as any,
      });
      if (alreadyInReceiverTree) {
        throw new BadRequestException('This link can’t be created because the member already exists in the target tree');
      }
    }

    // Prevent linking if the sender card is already present in the receiver's tree via external links.
    const senderCanonicalInReceiverTree = await FamilyTree.findOne({
      where: {
        familyCode: receiverFamilyCode,
        canonicalFamilyCode: senderFamilyCode,
        canonicalNodeUid: senderNodeUid,
      } as any,
      order: [['id', 'DESC']],
    });
    if (senderCanonicalInReceiverTree) {
      throw new BadRequestException('This link can’t be created because the member already exists in the target tree');
    }

    // Hard rule: if the two underlying users are blocked either way, do not allow a link request.
    // This prevents admins from connecting blocked pairs via tree-link workflows.
    if (senderNodeUserId && receiverNodeUserId) {
      const blockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
        senderNodeUserId,
        receiverNodeUserId,
      );
      if (blockedEitherWay) {
        throw new ForbiddenException('This link can’t be created because one of the members is blocked');
      }
    }

    const normalizeGender = (g: any): string => {
      const s = String(g || '').toLowerCase().trim();
      if (s === 'male' || s === 'm' || s === 'man') return 'male';
      if (s === 'female' || s === 'f' || s === 'woman') return 'female';
      return '';
    };

    const assertParentRoleMatchesGender = (role: string, gender: string) => {
      if (!role) return;
      if (!gender) {
        throw new BadRequestException(
          'Cannot validate parentRole because the linked parent has no gender set',
        );
      }
      if (role === 'father' && gender !== 'male') {
        throw new BadRequestException('Selected parentRole=father but linked parent is not male');
      }
      if (role === 'mother' && gender !== 'female') {
        throw new BadRequestException('Selected parentRole=mother but linked parent is not female');
      }
    };

    const getGenderForTreeNode = async (node: any): Promise<string> => {
      const uid = node?.userId ? Number(node.userId) : null;
      if (!uid) return '';

      const profile = await this.UserProfileModel.findOne({
        where: { userId: uid },
        attributes: ['gender', 'userId'],
      });
      return normalizeGender((profile as any)?.gender);
    };

    const needsParentRole =
      String(relationshipType) === 'parent' || String(relationshipType) === 'child';
    let finalParentRole = normalizedParentRole;

    if (needsParentRole && !finalParentRole) {
      const parentNode = String(relationshipType) === 'parent' ? senderNode : receiverNode;
      const parentGender = await getGenderForTreeNode(parentNode);
      if (!parentGender) {
        throw new BadRequestException(
          'Please set gender for the parent card to continue.',
        );
      }
      finalParentRole = parentGender === 'male' ? 'father' : 'mother';
    }

    if (!needsParentRole) {
      finalParentRole = null;
    }

    if (finalParentRole) {
      if (!['father', 'mother'].includes(finalParentRole)) {
        throw new BadRequestException('Invalid parentRole (must be father or mother)');
      }
      if (String(relationshipType) === 'sibling') {
        throw new BadRequestException('parentRole is only applicable for parent/child links');
      }
      const parentNode = String(relationshipType) === 'parent' ? senderNode : receiverNode;
      const parentGender = await getGenderForTreeNode(parentNode);
      assertParentRoleMatchesGender(finalParentRole, parentGender);
    }

    // Authorization: requester must own this card OR be an admin of the sender family.
    if (senderNodeUserId && senderNodeUserId !== Number(requesterUserId)) {
      const isAdmin = await this.isFamilyAdmin(requesterUserId, senderFamilyCode);
      if (!isAdmin) {
        throw new BadRequestException('Not authorized to request a link for this card');
      }
    }

    // De-dup pending request both directions
    const inverseType = this.invertRelationshipType(String(relationshipType));
    const existingPending = await this.treeLinkRequestModel.findOne({
      where: {
        status: 'pending',
        [Op.or]: [
          {
            senderFamilyCode,
            receiverFamilyCode,
            senderNodeUid,
            receiverNodeUid,
            relationshipType,
          },
          {
            senderFamilyCode: receiverFamilyCode,
            receiverFamilyCode: senderFamilyCode,
            senderNodeUid: receiverNodeUid,
            receiverNodeUid: senderNodeUid,
            relationshipType: inverseType,
          },
        ],
      } as any,
      order: [['id', 'DESC']],
    });
    if (existingPending) {
      const pendingSenderFamilyCode = String((existingPending as any).senderFamilyCode || '');
      const pendingReceiverFamilyCode = String((existingPending as any).receiverFamilyCode || '');
      const pendingSenderNodeUid = String((existingPending as any).senderNodeUid || '');
      const pendingReceiverNodeUid = String((existingPending as any).receiverNodeUid || '');
      const pendingRelationshipType = String((existingPending as any).relationshipType || '');
      const pendingParentRole = (existingPending as any).parentRole
        ? String((existingPending as any).parentRole).toLowerCase().trim()
        : null;

      // Self-heal: ensure the opposite family has a pending notification + recipients.
      try {
        const { FamilyTree } = await import('../family/model/family-tree.model');
        const receiverNodeForPending = await FamilyTree.findOne({
          where: { familyCode: pendingReceiverFamilyCode, nodeUid: pendingReceiverNodeUid } as any,
        });

        const directTargetUserId = receiverNodeForPending?.userId
          ? Number((receiverNodeForPending as any).userId)
          : null;
        const receiverAdmins = Array.from(
          new Set(await this.getAdminsForFamily(pendingReceiverFamilyCode)),
        ).map((x) => Number(x));
        let ownerRecipients: number[] = [];
        if (directTargetUserId) {
          const receiverUser = await this.userModel.findByPk(directTargetUserId);
          if ((receiverUser as any)?.isAppUser) {
            ownerRecipients = [directTargetUserId];
          }
        }
        const recipientCandidates = Array.from(
          new Set([...ownerRecipients, ...receiverAdmins]),
        ).filter((x) => Number.isFinite(x));

        const eligibleRecipients = await this.filterRecipientsForBlocks(
          requesterUserId ?? null,
          pendingReceiverFamilyCode,
          recipientCandidates,
        );

        // If nobody is eligible (blocked, etc.) we do not recreate a notification.
        if (eligibleRecipients.length > 0) {
          const existingNotification = await this.notificationModel.findOne({
            where: {
              type: 'TREE_LINK_REQUEST',
              status: 'pending',
              familyCode: pendingReceiverFamilyCode,
              data: { treeLinkRequestId: Number((existingPending as any).id) },
            } as any,
            order: [['id', 'DESC']],
          });

          if (existingNotification) {
            const currentRecipients = await this.recipientModel.findAll({
              where: { notificationId: existingNotification.id } as any,
              attributes: ['userId'],
            });
            const currentRecipientSet = new Set<number>(
              (currentRecipients as any[]).map((r: any) => Number(r.userId)).filter(Boolean),
            );
            const toCreate = eligibleRecipients
              .map((x) => Number(x))
              .filter((uid) => Number.isFinite(uid) && !currentRecipientSet.has(uid))
              .map((uid) => ({ notificationId: existingNotification.id, userId: uid }));

            if (toCreate.length > 0) {
              await this.recipientModel.bulkCreate(toCreate as any);
            }

            return {
              message: 'Link request already pending.',
              requestId: (existingPending as any).id,
              notification: { notificationId: existingNotification.id },
            };
          }

          const requesterName = (await this.getUserName(requesterUserId)) || 'A user';
          const title = 'Tree Link Request';
          const msg = `${requesterName} requested a ${pendingRelationshipType} link between families.`;

          const notification = await this.createNotification(
            {
              type: 'TREE_LINK_REQUEST',
              title,
              message: msg,
              familyCode: pendingReceiverFamilyCode,
              referenceId: requesterUserId,
              data: {
                requestType: 'tree_link',
                treeLinkRequestId: (existingPending as any).id,
                senderFamilyCode: pendingSenderFamilyCode,
                receiverFamilyCode: pendingReceiverFamilyCode,
                senderNodeUid: pendingSenderNodeUid,
                receiverNodeUid: pendingReceiverNodeUid,
                relationshipType: pendingRelationshipType,
                parentRole: pendingParentRole,
              },
              userIds: eligibleRecipients,
            } as any,
            requesterUserId,
          );

          return {
            message: 'Link request already pending.',
            requestId: (existingPending as any).id,
            notification,
          };
        }
      } catch (_) {
        // no-op: fall through to legacy response
      }

      return {
        message: 'Link request already pending.',
        requestId: (existingPending as any).id,
        notification: null,
      };
    }

    // Link-domain rule: notify node owner first; if node has no owner, notify family admins.
    const directTargetUserId = receiverNode.userId ? Number(receiverNode.userId) : null;
    const receiverAdmins = Array.from(new Set(await this.getAdminsForFamily(receiverFamilyCode))).map(
      (x) => Number(x),
    );
    let ownerRecipients: number[] = [];
    if (directTargetUserId) {
      const receiverUser = await this.userModel.findByPk(directTargetUserId);
      if ((receiverUser as any)?.isAppUser) {
        ownerRecipients = [directTargetUserId];
      }
    }
    const recipientIds = Array.from(new Set([...ownerRecipients, ...receiverAdmins])).filter((x) =>
      Number.isFinite(x),
    );

    const eligibleRecipientIds = await this.filterRecipientsForBlocks(
      requesterUserId ?? null,
      receiverFamilyCode,
      recipientIds,
    );

    if (eligibleRecipientIds.length === 0) {
      throw new BadRequestException('No recipients found for target family');
    }

    let requestRow: any;
    try {
      requestRow = await this.treeLinkRequestModel.create({
        senderFamilyCode,
        receiverFamilyCode,
        senderNodeUid,
        receiverNodeUid,
        relationshipType,
        parentRole: finalParentRole || null,
        status: 'pending',
        createdBy: requesterUserId,
      } as any);
    } catch (e: any) {
      // Likely the partial unique index on pending requests.
      const existing = await this.treeLinkRequestModel.findOne({
        where: {
          status: 'pending',
          senderFamilyCode,
          receiverFamilyCode,
          senderNodeUid,
          receiverNodeUid,
          relationshipType,
        } as any,
        order: [['id', 'DESC']],
      });
      if (existing) {
        return {
          message: 'Link request already pending.',
          requestId: (existing as any).id,
          notification: null,
        };
      }
      throw new BadRequestException(e?.message || 'Failed to create tree link request');
    }

    const requesterName = (await this.getUserName(requesterUserId)) || 'A user';
    const title = 'Tree Link Request';
    const message = `${requesterName} requested a ${relationshipType} link between families.`;

    const notification = await this.createNotification(
      {
        type: 'TREE_LINK_REQUEST',
        title,
        message,
        familyCode: receiverFamilyCode,
        referenceId: requesterUserId,
        data: {
          requestType: 'tree_link',
          treeLinkRequestId: requestRow.id,
          senderFamilyCode,
          receiverFamilyCode,
          senderNodeUid,
          receiverNodeUid,
          relationshipType,
          parentRole: finalParentRole || null,
        },
        userIds: eligibleRecipientIds,
      } as any,
      requesterUserId,
    );

    return {
      message: 'Tree link request sent',
      requestId: requestRow.id,
      notification,
    };
  }

  async revokeTreeLinkRequest(treeLinkRequestId: number, actingUserId: number) {
    const id = Number(treeLinkRequestId);
    if (!id || Number.isNaN(id) || id <= 0) {
      throw new BadRequestException('treeLinkRequestId must be a positive number');
    }
    if (!actingUserId) {
      throw new ForbiddenException('Unauthorized');
    }

    const requestRow = await this.treeLinkRequestModel.findByPk(id);
    if (!requestRow) {
      throw new NotFoundException('Link request not found');
    }

    const status = String((requestRow as any).status || 'pending');
    if (status !== 'pending') {
      return { success: true, message: 'Request already processed' };
    }

    const senderFamilyCode = String((requestRow as any).senderFamilyCode || '').trim();
    const createdBy = Number((requestRow as any).createdBy || 0);

    // Only the initiator or sender-family admins can revoke.
    const canRevoke =
      (createdBy && Number(createdBy) === Number(actingUserId)) ||
      (senderFamilyCode && (await this.isFamilyAdmin(actingUserId, senderFamilyCode)));

    if (!canRevoke) {
      throw new ForbiddenException('You don’t have permission to revoke this request');
    }

    const transaction = await this.sequelize.transaction();
    try {
      await this.treeLinkRequestModel.update(
        { status: 'revoked', respondedBy: actingUserId, updatedAt: new Date() } as any,
        { where: { id } as any, transaction },
      );

      // Mark any pending TREE_LINK_REQUEST notifications tied to this request as revoked too.
      const notifications = await this.notificationModel.findAll({
        where: {
          type: 'TREE_LINK_REQUEST',
          status: 'pending',
          data: { treeLinkRequestId: id },
        } as any,
        attributes: ['id'],
        transaction,
      });

      const notifIds = (notifications as any[])
        .map((n: any) => Number(n.id))
        .filter((x) => Number.isFinite(x) && x > 0);

      if (notifIds.length > 0) {
        await this.notificationModel.update(
          { status: 'revoked', updatedAt: new Date() } as any,
          { where: { id: { [Op.in]: notifIds } } as any, transaction },
        );
        await this.recipientModel.update(
          { isRead: true, readAt: new Date() } as any,
          { where: { notificationId: { [Op.in]: notifIds } } as any, transaction },
        );
      }

      await transaction.commit();
      return { success: true, message: 'Link request revoked' };
    } catch (e) {
      await transaction.rollback();
      throw e;
    }
  }

  async getPendingTreeLinkRequestsForUser(actingUserId: number) {
    if (!actingUserId) {
      throw new ForbiddenException('Unauthorized');
    }

    const rows = await this.treeLinkRequestModel.findAll({
      where: {
        createdBy: Number(actingUserId),
        status: 'pending',
      } as any,
      order: [['createdAt', 'DESC']],
    });

    if (!rows || rows.length === 0) {
      return { message: 'No pending link requests', data: [] };
    }

    const { FamilyTree } = await import('../family/model/family-tree.model');
    const results: any[] = [];

    for (const row of rows as any[]) {
      const senderFamilyCode = String(row.senderFamilyCode || '').trim();
      const receiverFamilyCode = String(row.receiverFamilyCode || '').trim();
      const senderNodeUid = String(row.senderNodeUid || '').trim();
      const receiverNodeUid = String(row.receiverNodeUid || '').trim();

      const [senderNode, receiverNode] = await Promise.all([
        FamilyTree.findOne({
          where: { familyCode: senderFamilyCode, nodeUid: senderNodeUid } as any,
          attributes: ['name', 'personId', 'nodeUid', 'userId'],
        }),
        FamilyTree.findOne({
          where: { familyCode: receiverFamilyCode, nodeUid: receiverNodeUid } as any,
          attributes: ['name', 'personId', 'nodeUid', 'userId'],
        }),
      ]);

      if (!senderNode || !receiverNode) {
        // Auto-cancel if the target card was removed.
        await this.treeLinkRequestModel.update(
          { status: 'cancelled', updatedAt: new Date() } as any,
          { where: { id: row.id } as any },
        );

        const notifications = await this.notificationModel.findAll({
          where: {
            type: 'TREE_LINK_REQUEST',
            status: 'pending',
            data: { treeLinkRequestId: Number(row.id) },
          } as any,
          attributes: ['id'],
        });

        const notifIds = (notifications as any[])
          .map((n: any) => Number(n.id))
          .filter((x) => Number.isFinite(x) && x > 0);

        if (notifIds.length > 0) {
          await this.notificationModel.update(
            { status: 'cancelled', updatedAt: new Date() } as any,
            { where: { id: { [Op.in]: notifIds } } as any },
          );
          await this.recipientModel.update(
            { isRead: true, readAt: new Date() } as any,
            { where: { notificationId: { [Op.in]: notifIds } } as any },
          );
        }

        continue;
      }

      results.push({
        id: Number(row.id),
        status: 'pending',
        createdAt: row.createdAt,
        relationshipType: row.relationshipType,
        parentRole: row.parentRole,
        senderFamilyCode,
        receiverFamilyCode,
        senderNodeUid,
        receiverNodeUid,
        senderPerson: {
          name: (senderNode as any)?.name || null,
          personId: (senderNode as any)?.personId || null,
          nodeUid: (senderNode as any)?.nodeUid || null,
          userId: (senderNode as any)?.userId || null,
        },
        receiverPerson: {
          name: (receiverNode as any)?.name || null,
          personId: (receiverNode as any)?.personId || null,
          nodeUid: (receiverNode as any)?.nodeUid || null,
          userId: (receiverNode as any)?.userId || null,
        },
      });
    }

    return {
      message: `${results.length} pending link request(s) found`,
      data: results,
    };
  }

  private async filterRecipientsForBlocks(
    triggeredBy: number | null,
    familyCode: string | null | undefined,
    recipientIds: number[],
  ): Promise<number[]> {
    if (!recipientIds || recipientIds.length === 0) {
      return [];
    }

    let ids = Array.from(new Set(recipientIds.map((x) => Number(x)).filter(Boolean)));

    // Admin family-block: blocked members receive no family notifications
    if (familyCode) {
      const memberships = await this.familyMemberModel.findAll({
        where: {
          familyCode,
          memberId: ids,
        } as any,
        attributes: ['memberId', 'isBlocked'],
      });

      const blocked = new Set<number>(
        memberships
          .filter((m: any) => !!(m as any).isBlocked)
          .map((m: any) => Number((m as any).memberId)),
      );

      ids = ids.filter((id) => !blocked.has(id));
    }

    // User-to-user blocking: no notifications between blocked pairs
    if (triggeredBy) {
      const blockedUserIds = await this.blockingService.getBlockedUserIdsForUser(
        Number(triggeredBy),
      );
      const blocked = new Set<number>(
        (blockedUserIds || []).map((x) => Number(x)).filter(Boolean),
      );
      ids = ids.filter((id) => !blocked.has(Number(id)));
    }

    return ids;
  }

  async createNotification(dto: CreateNotificationDto, triggeredBy: number) {
    const filteredUserIds = await this.filterRecipientsForBlocks(
      triggeredBy ?? null,
      dto.familyCode,
      dto.userIds || [],
    );

    if (filteredUserIds.length === 0) {
      return {
        message: 'Notification suppressed (no eligible recipients)',
        notificationId: null,
        requestId: null,
      };
    }

    const data = (dto as any).data || {};
    const senderIdFromData = data?.senderId ?? (dto as any).senderId ?? null;
    const targetUserIdFromData =
      data?.targetUserId ?? data?.targetId ?? (dto as any).targetUserId ?? null;

    const notification = await this.notificationModel.create({
      type: dto.type,
      title: dto.title,
      message: dto.message,
      familyCode: dto.familyCode,
      referenceId: dto.referenceId,
      triggeredBy,
      senderId: senderIdFromData,
      targetUserId: targetUserIdFromData,
      data,
    });

    const recipientRecords = filteredUserIds.map((userId) => ({
      notificationId: notification.id,
      userId,
    }));

    await this.recipientModel.bulkCreate(recipientRecords);

    // Send real-time notification via WebSocket to all recipients
    const notificationData = {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      createdAt: notification.createdAt,
      isRead: false,
      status: notification.status || 'pending',
    };

    // Send to each recipient via WebSocket
    filteredUserIds.forEach((userId) => {
      this.notificationGateway.sendNotificationToUser(
        userId.toString(),
        notificationData,
      );

      // Also update their unread count
      this.updateUnreadCountForUser(userId);
    });

    console.log(
      `✅ Notification ${notification.id} sent to ${filteredUserIds.length} users via WebSocket`,
    );

    // Return both notification ID and request ID (referenceId) in the response
    return {
      message: 'Notification created and sent to recipients',
      notificationId: notification.id,
      requestId: notification.referenceId || notification.id, // Fallback to notification.id if referenceId is not set
    };
  }

  /**
   * Prevent duplicate FAMILY_ASSOCIATION_REQUEST spam.
   * Returns the most recent pending request between the two users (in either direction), or null.
   */
  async findPendingAssociationRequestBetweenUsers(params: {
    userA: number;
    userB: number;
    familyA: string;
    familyB: string;
  }): Promise<{ id: number; referenceId: number | null } | null> {
    const userA = Number(params.userA);
    const userB = Number(params.userB);
    const familyA = String(params.familyA || '').trim();
    const familyB = String(params.familyB || '').trim();

    if (!userA || !userB || !familyA || !familyB) return null;

    const rows: any[] = await this.sequelize.query(
      `
      SELECT id, "referenceId"
      FROM ft_notifications
      WHERE type = 'FAMILY_ASSOCIATION_REQUEST'
        AND status = 'pending'
        AND (
          (
            ("senderId" = :userA AND "targetUserId" = :userB AND "familyCode" = :familyB)
            OR
            ("senderId" = :userB AND "targetUserId" = :userA AND "familyCode" = :familyA)
          )
          OR
          (
            (data->>'senderId')::int = :userA
            AND (data->>'targetUserId')::int = :userB
            AND "familyCode" IN (:familyA, :familyB)
          )
          OR
          (
            (data->>'senderId')::int = :userB
            AND (data->>'targetUserId')::int = :userA
            AND "familyCode" IN (:familyA, :familyB)
          )
        )
      ORDER BY id DESC
      LIMIT 1
      `,
      {
        replacements: { userA, userB, familyA, familyB },
        type: QueryTypes.SELECT,
      },
    );

    if (!rows || rows.length === 0) return null;
    return { id: Number(rows[0].id), referenceId: rows[0].referenceId ?? null };
  }

  async notifyPostLike(
    postId: number,
    likedByUserId: number,
    likedByName: string,
    postOwnerId: number,
  ) {
    // Construct notification payload
    return this.createNotification(
      {
        type: 'post_like',
        title: 'New Like on Your Post',
        message: `${likedByName} liked your post`,
        userIds: [postOwnerId],
        data: { postId, likedByUserId, likedByName },
        referenceId: postId,
        familyCode: null, // or if relevant
      },
      likedByUserId,
    );
  }

  

  async notifyComment(
    postId: number,
    userId: number,
    userName: string,
    postOwnerId: number,
    comment: string,
  ) {
    return this.createNotification(
      {
        type: 'post_comment',
        title: 'New Comment',
        message: `${userName} commented: "${comment}"`,
        userIds: [postOwnerId], // whom to notify
        data: {
          postId,
          comment,
          userName,
        },
        referenceId: postId,
        familyCode: null, // or set if relevant
      },
      userId, // triggeredBy
    );
  }

  // Helper method to update unread count for a user
  private async updateUnreadCountForUser(userId: number) {
    const count = await this.recipientModel.count({
      where: {
        userId,
        isRead: false,
      },
    });

    this.notificationGateway.updateUnreadCount(userId.toString(), count);
  }

  async getAdminsForFamily(familyCode: string): Promise<number[]> {
    const admins = await this.userModel.findAll({
      include: [
        {
          model: FamilyMember,
          as: 'familyMemberships',
          where: {
            familyCode,
            approveStatus: 'approved',
          },
        },
        {
          model: UserProfile,
          as: 'userProfile',
          attributes: ['familyCode'],
        },
      ],
      where: { role: [2, 3] },
    });

    const normalizedFamilyCode = String(familyCode || '').trim().toUpperCase();
    return admins
      .filter((u: any) => {
        const profileFamilyCode = String(
          u?.userProfile?.familyCode || '',
        )
          .trim()
          .toUpperCase();
        return profileFamilyCode && profileFamilyCode === normalizedFamilyCode;
      })
      .map((u) => u.id);
  }

  async getaAllFamilyMember(familyCode: string): Promise<number[]> {
    const admins = await this.userModel.findAll({
      include: [
        {
          model: FamilyMember,
          as: 'familyMemberships',
          where: {
            familyCode,
            approveStatus: 'approved',
          },
        },
      ],
    });

    return admins.map((u) => u.id);
  }

  async updateUserFamilyAssociations(
    userId: number,
    familyCodeToAdd: string | null | undefined,
    currentUserFamilyCode: string,
  ): Promise<boolean> {
    if (!familyCodeToAdd) {
      console.log(`❌ No familyCodeToAdd provided for userId: ${userId}`);
      return false;
    }

    const userProfile = await this.UserProfileModel.findOne({
      where: { userId },
      include: [
        {
          model: this.userModel,
          as: 'user',
          include: [{ model: UserProfile, as: 'userProfile' }],
        },
      ],
    });

    if (!userProfile) {
      console.log(`❌ No user profile found for userId: ${userId}`);
      return false;
    }

    // Skip if this is the user's own family
    if (
      userProfile.familyCode === familyCodeToAdd ||
      familyCodeToAdd === currentUserFamilyCode
    ) {
      console.log(`⚠️ Skipping self-family association for userId: ${userId}`);
      return false;
    }

    const currentAssoc: string[] = Array.isArray(
      userProfile.associatedFamilyCodes,
    )
      ? userProfile.associatedFamilyCodes.filter(Boolean) // Remove any empty/null values
      : [];

    if (!currentAssoc.includes(familyCodeToAdd)) {
      userProfile.associatedFamilyCodes = [...currentAssoc, familyCodeToAdd];
      await userProfile.save();
      console.log(
        `✅ Added familyCode ${familyCodeToAdd} to userId ${userId}'s associated codes`,
      );
      return true;
    }

    console.log(
      `⚠️ FamilyCode ${familyCodeToAdd} already exists in userId ${userId}'s associated codes`,
    );
    return false;
  }

  async respondToNotification(
    notificationId: number,
    action: 'accept' | 'reject',
    userId: number,
  ) {
    // Find the notification with the recipient
    const notification = await this.notificationModel.findByPk(notificationId, {
      include: [
        {
          model: NotificationRecipient,
          where: { userId },
          required: true,
        },
      ],
    });

    if (!notification) {
      throw new NotFoundException('Notification not found or access denied');
    }

    // Idempotency: if already handled, don’t re-run side effects (spouse cards, links, etc).
    if (notification.status && notification.status !== 'pending') {
      await this.recipientModel.update(
        { isRead: true, readAt: new Date() } as any,
        { where: { notificationId, userId } as any },
      );
      return {
        success: true,
        message: `Request already ${notification.status}`,
      };
    }

    // For family association requests, we need to use the referenceId
    if (
      notification.type === 'FAMILY_ASSOCIATION_REQUEST' &&
      !notification.referenceId
    ) {
      throw new BadRequestException(
        'Invalid notification: Missing reference ID',
      );
    }

    // Handle different notification types
    switch (notification.type) {
      case 'FAMILY_ASSOCIATION_REQUEST':
        const notificationData = notification.data || {};
        const senderId = notificationData.senderId; // The user who sent the request
        const initiatorUserId = notificationData.initiatorUserId; // The logged-in actor who initiated (may differ from senderId)
        const initiatorFamilyCode = notificationData.initiatorFamilyCode;
        // Prefer the intended target from notification payload; fallback to the accepting actor (admin/user)
        const targetUserId =
          notificationData.targetUserId || notificationData.targetId || userId;
        const senderFamilyCode = notificationData.senderFamilyCode;
        const targetFamilyCode = notification.familyCode;

        if (
          !senderId ||
          !targetUserId ||
          !senderFamilyCode ||
          !targetFamilyCode
        ) {
          throw new BadRequestException(
            'Invalid notification data: Missing required fields',
          );
        }

        // Hard rule: if either user has blocked the other, the request cannot be accepted/re-opened.
        // This prevents admins (or either party) from bypassing blocks via association workflows.
        const blockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
          Number(senderId),
          Number(targetUserId),
        );
        if (blockedEitherWay) {
          await this.notificationModel.update(
            { status: 'rejected', updatedAt: new Date() } as any,
            { where: { id: notificationId } as any },
          );
          await this.recipientModel.update(
            { isRead: true, readAt: new Date() } as any,
            { where: { notificationId } as any },
          );
          throw new ForbiddenException('Not allowed');
        }

        // Get both users' profiles with their associated user data
        const [senderProfile, targetProfile] = await Promise.all([
          this.UserProfileModel.findOne({
            where: { userId: senderId },
            include: [
              {
                model: this.userModel,
                as: 'user',
                include: [{ model: UserProfile, as: 'userProfile' }],
              },
            ],
          }),
          this.UserProfileModel.findOne({
            where: { userId: targetUserId },
            include: [
              {
                model: this.userModel,
                as: 'user',
                include: [{ model: UserProfile, as: 'userProfile' }],
              },
            ],
          }),
        ]);

        // Ensure we have valid user data
        if (!senderProfile || !targetProfile) {
          throw new NotFoundException('User data not found');
        }

        if (action === 'accept') {
          // Start a transaction to ensure both updates succeed or fail together
          const transaction = await this.sequelize.transaction();

          try {
            console.log(`🔄 Processing family association acceptance:`);
            console.log(`   Sender: ${senderId} (${senderFamilyCode})`);
            console.log(`   Target: ${targetUserId} (${targetFamilyCode})`);

            // Track if cards were created successfully
            let cardsCreated = false;
            let cardsError = null;

            try {
              console.log(
                `🔧 DEBUG: Starting card creation for ${senderId} ↔ ${targetUserId}`,
              );
              console.log(
                `🔧 DEBUG: Family codes: ${senderFamilyCode} ↔ ${targetFamilyCode}`,
              );
              console.log(
                `🔧 DEBUG: Sender profile:`,
                JSON.stringify(senderProfile?.user?.userProfile, null, 2),
              );
              console.log(
                `🔧 DEBUG: Target profile:`,
                JSON.stringify(targetProfile?.user?.userProfile, null, 2),
              );

              // Create dynamic family cards with proper relationship detection
              await this.createDynamicFamilyCards(
                senderId,
                targetUserId,
                senderFamilyCode,
                targetFamilyCode,
                senderProfile,
                targetProfile,
                transaction,
              );

              cardsCreated = true;
              console.log(`✅ DEBUG: Card creation completed successfully`);

              // Verify cards were actually created by querying the database
              const { FamilyTree } = await import(
                '../family/model/family-tree.model'
              );
              const createdCards = await FamilyTree.findAll({
                where: {
                  [require('sequelize').Op.or]: [
                    { familyCode: senderFamilyCode, userId: targetUserId },
                    { familyCode: targetFamilyCode, userId: senderId },
                    { familyCode: senderFamilyCode, userId: senderId },
                    { familyCode: targetFamilyCode, userId: targetUserId },
                  ],
                },
                transaction,
              });

              console.log(
                `🔧 DEBUG: Found ${createdCards.length} cards after creation:`,
              );
              createdCards.forEach((card) => {
                console.log(
                  `🔧 DEBUG: Card - familyCode: ${card.familyCode}, userId: ${
                    card.userId
                  }, personId: ${card.personId}, spouses: ${JSON.stringify(
                    card.spouses,
                  )}`,
                );
              });
            } catch (error) {
              console.error('❌ ERROR: Card creation failed:', error);
              console.error('❌ ERROR: Stack trace:', error.stack);
              cardsError = error.message;
              // Continue with the rest of the process even if card creation fails
            }

            // Update associated family codes bidirectionally using family service
            console.log(
              `🔧 DEBUG: Updating family associations bidirectionally`,
            );
            console.log(
              `🔧 DEBUG: Sender ${senderId} (${senderFamilyCode}) <-> Target ${targetUserId} (${targetFamilyCode})`,
            );

            const [updatedSender, updatedTarget] = await Promise.all([
              this.updateUserFamilyAssociations(
                senderId,
                targetFamilyCode,
                senderFamilyCode,
              ),
              this.updateUserFamilyAssociations(
                targetUserId,
                senderFamilyCode,
                targetFamilyCode,
              ),
            ]);

            // Ensure one-hop content visibility link between families
            await this.ensureFamilyLink(
              senderFamilyCode,
              targetFamilyCode,
              'spouse',
              transaction,
            );

            // If the request was initiated by someone other than senderId (e.g. admin acting on behalf of a non-app member),
            // also grant the initiator association access so they can view the connected family's tree.
            try {
              if (
                initiatorUserId &&
                Number(initiatorUserId) !== Number(senderId) &&
                Number(initiatorUserId) !== Number(targetUserId)
              ) {
                await this.updateUserFamilyAssociations(
                  Number(initiatorUserId),
                  targetFamilyCode,
                  initiatorFamilyCode || senderFamilyCode,
                );
              }
            } catch (_) {
              // no-op
            }

            // Note: Family service association update will be handled separately
            console.log(
              `✅ Association update completed via notification service`,
            );

            console.log(
              `📊 Association results after card creation: sender=${updatedSender}, target=${updatedTarget}`,
            );

            if (cardsCreated) {
              console.log(
                `✅ Family association completed with dynamic cards created`,
              );
            } else {
              console.warn(
                `⚠️ Family association completed but card creation had issues: ${
                  cardsError || 'Unknown error'
                }`,
              );
            }

            // Update the original notification status to 'accepted' within the transaction
            console.log(
              `🔧 DEBUG: Updating notification ${notificationId} status to 'accepted' within transaction`,
            );
            await this.notificationModel.update(
              { status: 'accepted', updatedAt: new Date() },
              { where: { id: notificationId }, transaction },
            );

            // Mark the notification as read for ALL recipients since it's been processed
            await this.recipientModel.update(
              { isRead: true, readAt: new Date() },
              { where: { notificationId }, transaction },
            );
            console.log(
              `🔧 DEBUG: Marked notification ${notificationId} as read for all recipients`,
            );

            await transaction.commit();
            console.log(`✅ Family association completed successfully`);

            // Get the target user's name for the notification
            const targetName = targetProfile.user?.userProfile
              ? `${targetProfile.user.userProfile.firstName || ''} ${
                  targetProfile.user.userProfile.lastName || ''
                }`.trim()
              : 'A user';

            // Get family admins for both families
            const [senderFamilyAdmins, targetFamilyAdmins] = await Promise.all([
              this.getAdminsForFamily(senderFamilyCode),
              this.getAdminsForFamily(targetFamilyCode),
            ]);

            console.log(
              `👥 Sender family (${senderFamilyCode}) admins:`,
              senderFamilyAdmins,
            );
            console.log(
              `👥 Target family (${targetFamilyCode}) admins:`,
              targetFamilyAdmins,
            );

            // Combine sender + sender family admins (remove duplicates)
            const senderNotificationRecipients = Array.from(
              new Set([senderId, ...senderFamilyAdmins]),
            );

            // Combine target family admins (excluding the acceptor who already knows)
            const targetNotificationRecipients = targetFamilyAdmins.filter(
              (adminId) => adminId !== targetUserId,
            );

            console.log(
              `📧 Sender notification recipients:`,
              senderNotificationRecipients,
            );
            console.log(
              `📧 Target notification recipients:`,
              targetNotificationRecipients,
            );

            // Create notification for the sender and sender family admins
            console.log(
              `🔔 Creating acceptance notification for sender and admins`,
            );
            const senderAcceptanceNotification = await this.createNotification(
              {
                type: 'FAMILY_ASSOCIATION_ACCEPTED',
                title: 'Association Request Accepted',
                message: `${targetName} from ${targetFamilyCode} has accepted the family association request.`,
                familyCode: senderFamilyCode,
                referenceId: targetUserId,
                data: {
                  senderId: targetUserId,
                  senderName: targetName,
                  senderFamilyCode: targetFamilyCode,
                  targetUserId: senderId,
                  targetFamilyCode: senderFamilyCode,
                  requestType: 'family_association_accepted',
                  cardsCreated: cardsCreated,
                },
                userIds: senderNotificationRecipients,
              },
              targetUserId,
            );
            console.log(
              `✅ Sender acceptance notification created:`,
              senderAcceptanceNotification,
            );

            // Create notification for target family admins (if any)
            if (targetNotificationRecipients.length > 0) {
              console.log(
                `🔔 Creating acceptance notification for target family admins`,
              );
              const targetAcceptanceNotification =
                await this.createNotification(
                  {
                    type: 'FAMILY_ASSOCIATION_ACCEPTED',
                    title: 'Family Association Established',
                    message: `${targetName} has accepted an association request from ${senderFamilyCode}. The families are now connected.`,
                    familyCode: targetFamilyCode,
                    referenceId: senderId,
                    data: {
                      senderId: senderId,
                      senderName: senderProfile.user?.userProfile
                        ? `${senderProfile.user.userProfile.firstName || ''} ${
                            senderProfile.user.userProfile.lastName || ''
                          }`.trim()
                        : 'A user',
                      senderFamilyCode: senderFamilyCode,
                      targetUserId: targetUserId,
                      targetFamilyCode: targetFamilyCode,
                      requestType: 'family_association_accepted',
                      cardsCreated: cardsCreated,
                    },
                    userIds: targetNotificationRecipients,
                  },
                  targetUserId,
                );
              console.log(
                `✅ Target family acceptance notification created:`,
                targetAcceptanceNotification,
              );
            }

            return {
              success: true,
              message: cardsCreated
                ? 'Family association created successfully with dynamic cards'
                : `Family association created but there were issues with card creation: ${
                    cardsError || 'Unknown error'
                  }`,
              data: {
                originalRequesterId: senderId, // The user who originally sent the request
                acceptingUserId: targetUserId, // The user who accepted the request
                requesterFamilyCode: senderFamilyCode,
                accepterFamilyCode: targetFamilyCode,
                bidirectionalCardsCreated: cardsCreated,
                cardsError: cardsError,
              },
            };
          } catch (error) {
            await transaction.rollback();
            throw new BadRequestException(
              'Failed to create family association: ' + error.message,
            );
          }
        } else {
          // Handle rejection (actor is the target user/admin who rejected)
          const actorName = targetProfile.user?.userProfile
            ? `${targetProfile.user.userProfile.firstName || ''} ${
                targetProfile.user.userProfile.lastName || ''
              }`.trim()
            : 'A user';

          // Update the original notification status to 'rejected'
          console.log(
            `🔧 DEBUG: Updating notification ${notificationId} status to 'rejected'`,
          );
          await this.notificationModel.update(
            { status: 'rejected', updatedAt: new Date() },
            { where: { id: notificationId } },
          );

          // Mark the notification as read for ALL recipients since it's been processed
          await this.recipientModel.update(
            { isRead: true, readAt: new Date() },
            { where: { notificationId } },
          );
          console.log(
            `🔧 DEBUG: Marked notification ${notificationId} as read for all recipients after rejection`,
          );

          // Get family admins for both families
          const [senderFamilyAdmins, targetFamilyAdmins] = await Promise.all([
            this.getAdminsForFamily(senderFamilyCode),
            this.getAdminsForFamily(targetFamilyCode),
          ]);

          console.log(
            `👥 Sender family (${senderFamilyCode}) admins:`,
            senderFamilyAdmins,
          );
          console.log(
            `👥 Target family (${targetFamilyCode}) admins:`,
            targetFamilyAdmins,
          );

          // Combine sender + sender family admins (remove duplicates)
          const senderNotificationRecipients = Array.from(
            new Set([senderId, ...senderFamilyAdmins]),
          );

          // Target family admins (excluding the rejector who already knows)
          const targetNotificationRecipients = targetFamilyAdmins.filter(
            (adminId) => adminId !== targetUserId,
          );

          console.log(
            `📧 Sender rejection notification recipients:`,
            senderNotificationRecipients,
          );
          console.log(
            `📧 Target rejection notification recipients:`,
            targetNotificationRecipients,
          );

          console.log(
            `🔔 Creating rejection notification for sender and admins`,
          );
          const senderRejectionNotification = await this.createNotification(
            {
              type: 'FAMILY_ASSOCIATION_REJECTED',
              title: 'Association Request Declined',
              message: `Your family association request has been declined by ${actorName} from ${targetFamilyCode}.`,
              familyCode: senderFamilyCode,
              referenceId: targetUserId,
              data: {
                senderId: targetUserId,
                senderName: actorName,
                senderFamilyCode: targetFamilyCode,
                targetUserId: senderId,
                targetName: actorName,
                targetFamilyCode: senderFamilyCode,
                requestType: 'family_association_rejected',
              },
              userIds: senderNotificationRecipients,
            },
            targetUserId,
          );
          console.log(
            `✅ Sender rejection notification created:`,
            senderRejectionNotification,
          );

          // Create notification for target family admins (if any)
          if (targetNotificationRecipients.length > 0) {
            console.log(
              `🔔 Creating rejection notification for target family admins`,
            );
            const targetRejectionNotification = await this.createNotification(
              {
                type: 'FAMILY_ASSOCIATION_REJECTED',
                title: 'Family Association Request Declined',
                message: `${actorName} has declined an association request from ${senderFamilyCode}.`,
                familyCode: targetFamilyCode,
                referenceId: senderId,
                data: {
                  senderId: senderId,
                  senderName: senderProfile.user?.userProfile
                    ? `${senderProfile.user.userProfile.firstName || ''} ${
                        senderProfile.user.userProfile.lastName || ''
                      }`.trim()
                    : 'A user',
                  senderFamilyCode: senderFamilyCode,
                  targetUserId: targetUserId,
                  targetFamilyCode: targetFamilyCode,
                  requestType: 'family_association_rejected',
                },
                userIds: targetNotificationRecipients,
              },
              targetUserId,
            );
            console.log(
              `✅ Target family rejection notification created:`,
              targetRejectionNotification,
            );
          }

          return {
            success: true,
            message: 'Family association request declined',
            data: {
              senderId,
              targetUserId,
              senderFamilyCode,
              targetFamilyCode,
            },
          };
        }
        break;

      case 'TREE_LINK_REQUEST': {
        const data = (notification as any).data || {};
        const treeLinkRequestId = Number(data.treeLinkRequestId);
        const senderFamilyCode = String(data.senderFamilyCode || '');
        const receiverFamilyCode = String(
          data.receiverFamilyCode || notification.familyCode || '',
        );
        const senderNodeUid = String(data.senderNodeUid || '');
        const receiverNodeUid = String(data.receiverNodeUid || '');
        const relationshipType = String(data.relationshipType || '');
        const parentRole = data.parentRole ? String(data.parentRole).toLowerCase().trim() : '';

        if (
          !treeLinkRequestId ||
          !senderFamilyCode ||
          !receiverFamilyCode ||
          !senderNodeUid ||
          !receiverNodeUid
        ) {
          throw new BadRequestException('Invalid TREE_LINK_REQUEST payload');
        }
        if (!['parent', 'child', 'sibling'].includes(relationshipType)) {
          throw new BadRequestException('Invalid relationshipType');
        }

        const requestRow = await this.treeLinkRequestModel.findByPk(
          treeLinkRequestId,
        );
        if (!requestRow) {
          throw new NotFoundException('Tree link request not found');
        }
        const currentStatus = String((requestRow as any).status || 'pending');
        if (currentStatus !== 'pending') {
          return {
            success: true,
            message:
              currentStatus === 'accepted'
                ? 'Tree link request already accepted'
                : 'Tree link request already processed',
          };
        }

        if (action === 'reject') {
          await this.treeLinkRequestModel.update(
            { status: 'rejected', respondedBy: userId, updatedAt: new Date() } as any,
            { where: { id: treeLinkRequestId } as any },
          );

          await this.notificationModel.update(
            { status: 'rejected', updatedAt: new Date() } as any,
            { where: { id: notificationId } as any },
          );
          await this.recipientModel.update(
            { isRead: true, readAt: new Date() } as any,
            { where: { notificationId } as any },
          );

          return { success: true, message: 'Tree link request rejected' };
        }

        const transaction = await this.sequelize.transaction();
        try {
          // Concurrency: lock the request row so only one accept can win.
          const locked = await this.treeLinkRequestModel.findByPk(
            treeLinkRequestId,
            {
              transaction,
              lock: (transaction as any).LOCK.UPDATE,
            } as any,
          );
          if (!locked) {
            throw new NotFoundException('Tree link request not found');
          }
          if (String((locked as any).status || 'pending') !== 'pending') {
            await transaction.rollback();
            return {
              success: true,
              message: 'Tree link request already processed',
            };
          }

          // Link-domain rule: Accept must NOT mutate family trees or create external cards.
          // We only mark the request accepted. Linked-family navigation will be handled by dedicated UI/API.
          const lockedSenderFamilyCode = String(
            (locked as any).senderFamilyCode || senderFamilyCode,
          );
          const lockedReceiverFamilyCode = String(
            (locked as any).receiverFamilyCode || receiverFamilyCode,
          );
          const lockedSenderNodeUid = String(
            (locked as any).senderNodeUid || senderNodeUid,
          );
          const lockedReceiverNodeUid = String(
            (locked as any).receiverNodeUid || receiverNodeUid,
          );
          const lockedRelationshipType = String(
            (locked as any).relationshipType || relationshipType,
          );
          const lockedParentRole = String((locked as any).parentRole || parentRole || '').toLowerCase().trim();
          const linkCreatedBy =
            Number((locked as any).createdBy || 0) || Number(userId);

          // Persist the link relationship (no ft_family_tree mutations).
          await this.ensureFamilyLink(
            lockedSenderFamilyCode,
            lockedReceiverFamilyCode,
            'tree',
            transaction,
          );
          await this.ensureTreeLink(
            lockedSenderFamilyCode,
            lockedReceiverFamilyCode,
            lockedSenderNodeUid,
            lockedReceiverNodeUid,
            lockedRelationshipType,
            linkCreatedBy,
            transaction,
          );

          const { FamilyTree } = await import('../family/model/family-tree.model');
          const [senderCanonical, receiverCanonical] = await Promise.all([
            FamilyTree.findOne({
              where: { familyCode: lockedSenderFamilyCode, nodeUid: lockedSenderNodeUid } as any,
              transaction,
            }),
            FamilyTree.findOne({
              where: { familyCode: lockedReceiverFamilyCode, nodeUid: lockedReceiverNodeUid } as any,
              transaction,
            }),
          ]);

          if (!senderCanonical || !receiverCanonical) {
            // If a user/card was removed before approval, cancel the request instead of erroring out.
            await this.treeLinkRequestModel.update(
              { status: 'cancelled', respondedBy: userId, updatedAt: new Date() } as any,
              { where: { id: treeLinkRequestId } as any, transaction },
            );
            await this.notificationModel.update(
              { status: 'cancelled', updatedAt: new Date() } as any,
              { where: { id: notificationId } as any, transaction },
            );
            await this.recipientModel.update(
              { isRead: true, readAt: new Date() } as any,
              { where: { notificationId } as any, transaction },
            );
            await transaction.commit();
            return {
              success: true,
              message:
                'Link request was cancelled because the target card is no longer available.',
            };
          }

          const senderPersonId = Number((senderCanonical as any).personId);
          const receiverPersonId = Number((receiverCanonical as any).personId);
          const senderUserId = (senderCanonical as any).userId
            ? Number((senderCanonical as any).userId)
            : null;
          const receiverUserId = (receiverCanonical as any).userId
            ? Number((receiverCanonical as any).userId)
            : null;

          // Hard rule: do not allow tree links between blocked users (no admin bypass).
          if (senderUserId && receiverUserId) {
            const blockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
              senderUserId,
              receiverUserId,
            );
            if (blockedEitherWay) {
              await this.treeLinkRequestModel.update(
                { status: 'rejected', respondedBy: userId, updatedAt: new Date() } as any,
                { where: { id: treeLinkRequestId } as any, transaction },
              );
              await this.notificationModel.update(
                { status: 'rejected', updatedAt: new Date() } as any,
                { where: { id: notificationId } as any, transaction },
              );
              await this.recipientModel.update(
                { isRead: true, readAt: new Date() } as any,
                { where: { notificationId } as any, transaction },
              );
              await transaction.commit();
              throw new ForbiddenException(
                'This link can’t be created because one of the members is blocked',
              );
            }
          }

          const normalizeGender = (g: any): string => {
            const s = String(g || '').toLowerCase().trim();
            if (s === 'male' || s === 'm' || s === 'man') return 'male';
            if (s === 'female' || s === 'f' || s === 'woman') return 'female';
            return '';
          };
          const assertParentRoleMatchesGender = (role: string, gender: string) => {
            if (!role) return;
            if (!gender) {
              throw new BadRequestException(
                'Cannot validate parentRole because the linked parent has no gender set',
              );
            }
            if (role === 'father' && gender !== 'male') {
              throw new BadRequestException(
                'Selected parentRole=father but linked parent is not male',
              );
            }
            if (role === 'mother' && gender !== 'female') {
              throw new BadRequestException(
                'Selected parentRole=mother but linked parent is not female',
              );
            }
          };

          const getGenderForCanonicalNode = async (node: any): Promise<string> => {
            const uid = node?.userId ? Number(node.userId) : null;
            if (!uid) return '';

            const profile = await this.UserProfileModel.findOne({
              where: { userId: uid },
              attributes: ['gender', 'userId'],
            });
            return normalizeGender((profile as any)?.gender);
          };

          if (lockedParentRole) {
            if (!['father', 'mother'].includes(lockedParentRole)) {
              throw new BadRequestException('Invalid parentRole (must be father or mother)');
            }
            if (String(lockedRelationshipType) === 'sibling') {
              throw new BadRequestException('parentRole is only applicable for parent/child links');
            }
            const parentCanonical =
              String(lockedRelationshipType) === 'parent' ? senderCanonical : receiverCanonical;
            const parentGender = await getGenderForCanonicalNode(parentCanonical);
            assertParentRoleMatchesGender(lockedParentRole, parentGender);
          }
          const senderGen = Number((senderCanonical as any).generation || 0);
          const receiverGen = Number((receiverCanonical as any).generation || 0);

          const type = String(lockedRelationshipType);
          const inverseType = this.invertRelationshipType(type);

          const senderSideExternalGen = this.getOtherGeneration(senderGen, inverseType);
          const receiverSideExternalGen = this.getOtherGeneration(receiverGen, type);

          const [receiverInSenderFamily, senderInReceiverFamily] = await Promise.all([
            this.ensureExternalLinkedCardInFamily({
              targetFamilyCode: lockedSenderFamilyCode,
              nodeUid: lockedReceiverNodeUid,
              canonicalFamilyCode: lockedReceiverFamilyCode,
              canonicalNodeUid: lockedReceiverNodeUid,
              canonicalUserId: receiverUserId,
              desiredGeneration: senderSideExternalGen,
              transaction,
            }),
            this.ensureExternalLinkedCardInFamily({
              targetFamilyCode: lockedReceiverFamilyCode,
              nodeUid: lockedSenderNodeUid,
              canonicalFamilyCode: lockedSenderFamilyCode,
              canonicalNodeUid: lockedSenderNodeUid,
              canonicalUserId: senderUserId,
              desiredGeneration: receiverSideExternalGen,
              transaction,
            }),
          ]);

          const receiverExternalPersonId = Number((receiverInSenderFamily as any).personId);
          const senderExternalPersonId = Number((senderInReceiverFamily as any).personId);

          if (type === 'sibling') {
            const senderParents = Array.isArray((senderCanonical as any).parents)
              ? (senderCanonical as any).parents.map((x: any) => Number(x))
              : [];
            const receiverParents = Array.isArray((receiverCanonical as any).parents)
              ? (receiverCanonical as any).parents.map((x: any) => Number(x))
              : [];

            await Promise.all([
              this.linkAsSiblingByParents({
                familyCode: lockedSenderFamilyCode,
                canonicalPersonId: senderPersonId,
                externalPersonId: receiverExternalPersonId,
                canonicalParents: senderParents,
                transaction,
              }),
              this.linkAsSiblingByParents({
                familyCode: lockedReceiverFamilyCode,
                canonicalPersonId: receiverPersonId,
                externalPersonId: senderExternalPersonId,
                canonicalParents: receiverParents,
                transaction,
              }),
            ]);
          } else {
            if (lockedParentRole) {
              if (type === 'child') {
                await this.replaceParentByRoleInFamily({
                  familyCode: lockedSenderFamilyCode,
                  childPersonId: senderPersonId,
                  newParentPersonId: receiverExternalPersonId,
                  parentRole: lockedParentRole,
                  transaction,
                });
              }
              if (type === 'parent') {
                await this.replaceParentByRoleInFamily({
                  familyCode: lockedReceiverFamilyCode,
                  childPersonId: receiverPersonId,
                  newParentPersonId: senderExternalPersonId,
                  parentRole: lockedParentRole,
                  transaction,
                });
              }
            }
            await Promise.all([
              this.updateLocalRelationship({
                familyCode: lockedSenderFamilyCode,
                aPersonId: senderPersonId,
                bPersonId: receiverExternalPersonId,
                relationshipTypeAtoB: type,
                transaction,
              }),
              this.updateLocalRelationship({
                familyCode: lockedReceiverFamilyCode,
                aPersonId: receiverPersonId,
                bPersonId: senderExternalPersonId,
                relationshipTypeAtoB: inverseType,
                transaction,
              }),
            ]);

            // UI alignment helper: if the child has exactly 2 parents in this family,
            // and both parents have no conflicting spouse link, connect the two parents
            // as spouses so they render as a couple.
            if (lockedParentRole) {
              if (type === 'child') {
                await this.ensureSpouseLinkBetweenChildParentsIfSafe({
                  familyCode: lockedSenderFamilyCode,
                  childPersonId: senderPersonId,
                  transaction,
                });
              }
              if (type === 'parent') {
                await this.ensureSpouseLinkBetweenChildParentsIfSafe({
                  familyCode: lockedReceiverFamilyCode,
                  childPersonId: receiverPersonId,
                  transaction,
                });
              }
            }

            if (type === 'parent') {
              if (!lockedParentRole) {
                await this.propagateChildToCanonicalSpouses({
                  familyCode: lockedSenderFamilyCode,
                  canonicalParentPersonId: senderPersonId,
                  childPersonId: receiverExternalPersonId,
                  transaction,
                });
              }
            }
            if (inverseType === 'parent') {
              if (!lockedParentRole) {
                await this.propagateChildToCanonicalSpouses({
                  familyCode: lockedReceiverFamilyCode,
                  canonicalParentPersonId: receiverPersonId,
                  childPersonId: senderExternalPersonId,
                  transaction,
                });
              }
            }
          }

          await this.treeLinkRequestModel.update(
            { status: 'accepted', respondedBy: userId, updatedAt: new Date() } as any,
            { where: { id: treeLinkRequestId } as any, transaction },
          );

          await this.notificationModel.update(
            { status: 'accepted', updatedAt: new Date() } as any,
            { where: { id: notificationId } as any, transaction },
          );
          await this.recipientModel.update(
            { isRead: true, readAt: new Date() } as any,
            { where: { notificationId } as any, transaction },
          );
          await Promise.all([
            repairFamilyTreeIntegrity({
              familyCode: lockedSenderFamilyCode,
              transaction,
              lock: true,
              fixExternalGenerations: true,
            }),
            repairFamilyTreeIntegrity({
              familyCode: lockedReceiverFamilyCode,
              transaction,
              lock: true,
              fixExternalGenerations: true,
            }),
          ]);

          await transaction.commit();
          return { success: true, message: 'Tree link request accepted' };
        } catch (e: any) {
          await transaction.rollback();
          throw new BadRequestException(
            'Failed to accept tree link request: ' + (e?.message || e),
          );
        }
      }

      // Add other notification types here

      default:
        throw new BadRequestException(
          `Action not supported for notification type: ${notification.type}`,
        );
    }

    // Mark the notification as read
    await this.recipientModel.update(
      { isRead: true },
      { where: { notificationId, userId } },
    );

    return { success: true, message: `Request ${action}ed successfully` };
  }

  async getNotificationsForUser(
    userId: number,
    showAll = false,
    type?: string,
  ) {
    const blockedUserIds = await this.blockingService.getBlockedUserIdsForUser(
      userId,
    );
    const blockedUserIdSet = new Set<number>(blockedUserIds);

    const blockedFamilyCodes = new Set<string>();
    const memberships = await this.familyMemberModel.findAll({
      where: { memberId: userId } as any,
      attributes: ['familyCode', 'isBlocked'],
    });
    for (const m of memberships as any[]) {
      if ((m as any).isBlocked && (m as any).familyCode) {
        blockedFamilyCodes.add(String((m as any).familyCode));
      }
    }
    // Calculate date 15 days ago for filtering association requests
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

    // Build notification where clause
    let notificationWhere: any;

    if (type) {
      // If specific type requested, filter by that type only
      if (type === 'FAMILY_ASSOCIATION_REQUEST') {
        // For association requests: only last 15 days AND not expired
        notificationWhere = {
          type: 'FAMILY_ASSOCIATION_REQUEST',
          createdAt: { [Op.gte]: fifteenDaysAgo },
          status: { [Op.ne]: 'expired' },
        };
      } else {
        // For other specific types: show all
        notificationWhere = { type };
      }
    } else {
      // No type filter: apply 15-day rule for association requests
      notificationWhere = {
        [Op.or]: [
          // For FAMILY_ASSOCIATION_REQUEST: only show last 15 days AND not expired
          {
            type: 'FAMILY_ASSOCIATION_REQUEST',
            createdAt: { [Op.gte]: fifteenDaysAgo },
            status: { [Op.ne]: 'expired' },
          },
          // For all other notification types: show all
          {
            type: { [Op.ne]: 'FAMILY_ASSOCIATION_REQUEST' },
          },
        ],
      };
    }

    const options: any = {
      where: { userId },
      include: [
        {
          model: Notification,
          required: true,
          where: notificationWhere,
        },
      ],
      order: [['createdAt', 'DESC']],
    };

    if (!showAll) {
      options.limit = 5; // Only 5 recent if not all
    }

    const notifications = await this.recipientModel.findAll(options);

    const triggeredByIds = Array.from(
      new Set(
        notifications
          .map((nr: any) => Number(nr?.notification?.triggeredBy))
          .filter(Boolean),
      ),
    );

    const triggeredByProfiles = triggeredByIds.length
      ? await this.UserProfileModel.findAll({
          where: { userId: triggeredByIds } as any,
          attributes: ['userId', 'firstName', 'lastName', 'profile'],
        })
      : [];
    const profileByUserId = new Map<number, any>(
      (triggeredByProfiles as any[]).map((p: any) => [Number(p.userId), p]),
    );

    const baseUrl = process.env.S3_BUCKET_URL || process.env.BASE_URL || 'http://localhost:3000';

    const result = notifications
      .filter((notifRecipient: any) => {
        const fc = notifRecipient?.notification?.familyCode;
        if (!fc) return true;
        return !blockedFamilyCodes.has(String(fc));
      })
      .map((notifRecipient) => {
      const mapped = {
        id: notifRecipient.notificationId,
        title: notifRecipient.notification.title,
        message: notifRecipient.notification.message,
        type: notifRecipient.notification.type,
        familyCode: notifRecipient.notification.familyCode,
        data: notifRecipient.notification.data,
        isRead: notifRecipient.isRead,
        status: notifRecipient.notification.status, // Include notification status
        createdAt: notifRecipient.notification.createdAt,
        triggeredBy: notifRecipient.notification.triggeredBy,
        referenceId: notifRecipient.notification.referenceId,
        readAt: notifRecipient.readAt,
      };

      const triggeredBy = Number(notifRecipient?.notification?.triggeredBy);
      if (triggeredBy && triggeredBy !== userId && !blockedUserIdSet.has(triggeredBy)) {
        const p = profileByUserId.get(triggeredBy);
        const name = p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : null;
        const profile = p?.profile ? `${baseUrl}/profile/${p.profile}` : null;
        (mapped as any).triggeredByUser = {
          userId: triggeredBy,
          name: name || null,
          profile,
        };
      } else {
        (mapped as any).triggeredByUser = null;
      }

      // Debug log to see what status we're returning
      if (notifRecipient.notification.type === 'FAMILY_ASSOCIATION_REQUEST') {
        console.log(
          `🔧 DEBUG: Returning notification ${mapped.id} with status: ${mapped.status}`,
        );
      }

      return mapped;
    });

    return result;
  }

  async markNotificationAsRead(
    notificationId: number,
    userId: number,
    status?: 'accepted' | 'rejected',
  ) {
    const notifRecipient = await this.recipientModel.findOne({
      where: {
        notificationId,
        userId,
      },
    });

    if (!notifRecipient) {
      throw new NotFoundException('Notification not found for this user');
    }

    // Mark notification as read
    if (!notifRecipient.isRead) {
      notifRecipient.isRead = true;
      notifRecipient.readAt = new Date();
      await notifRecipient.save();
    }

    // Update notification status if provided
    if (status) {
      await this.notificationModel.update(
        { status },
        { where: { id: notificationId } },
      );
    }

    const statusMessage = status ? ` and status updated to ${status}` : '';
    return { message: `Notification marked as read${statusMessage}` };
  }

  async getUnreadCount(userId: number): Promise<{ unreadCount: number }> {
    const unreadCount = await this.recipientModel.count({
      where: {
        userId,
        isRead: false,
      },
    });

    return { unreadCount };
  }

  /**
   * Auto-expire family association requests older than 15 days
   * This runs as a scheduled job to keep notifications clean
   */
  async expireOldAssociationRequests() {
    try {
      // Calculate date 15 days ago
      const fifteenDaysAgo = new Date();
      fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

      // Find all pending family association requests older than 15 days
      const expiredCount = await this.notificationModel.update(
        { status: 'expired' },
        {
          where: {
            type: 'FAMILY_ASSOCIATION_REQUEST',
            status: 'pending',
            createdAt: { [Op.lt]: fifteenDaysAgo },
          },
        },
      );

      console.log(
        `✅ Auto-expired ${expiredCount[0]} old family association requests`,
      );
      return {
        success: true,
        expiredCount: expiredCount[0],
        message: `Expired ${expiredCount[0]} old association requests`,
      };
    } catch (error) {
      console.error('❌ Error expiring old association requests:', error);
      return { success: false, error: error.message };
    }
  }

  async sendBirthdayAndAnniversaryNotifications() {
    const today = dayjs().format('MM-DD');

    // Step 1: Get users whose dob or marriageDate matches today's date (from UserProfile)
    const users = await this.userModel.findAll({
      include: [
        {
          model: this.UserProfileModel,
          required: true,
          where: {
            [Op.or]: [
              {
                dob: {
                  [Op.ne]: null,
                  [Op.like]: `%-${today}`,
                },
              },
              {
                marriageDate: {
                  [Op.ne]: null,
                  [Op.like]: `%-${today}`,
                },
              },
            ],
          },
        },
        {
          model: FamilyMember,
          as: 'familyMemberships',
          where: {
            approveStatus: 'approved',
          },
        },
      ],
    });

    for (const user of users) {
      const userId = user.id;
      const fullName = `${user.userProfile?.firstName ?? ''} ${
        user.userProfile?.lastName ?? ''
      }`;
      const dob = user.userProfile?.dob;
      const marriageDate = user.userProfile?.marriageDate;

      for (const membership of user.familyMemberships || []) {
        const familyCode = membership.familyCode;

        const familyMemberIds = await this.getaAllFamilyMember(familyCode);
        const recipientIds = familyMemberIds.filter((id) => id !== userId);

        if (dob && dayjs(dob).format('MM-DD') === today) {
          await this.createNotification(
            {
              type: 'BIRTHDAY',
              title: `🎉 Birthday Alert`,
              message: `Today is ${fullName}'s birthday! 🎂`,
              familyCode,
              referenceId: userId,
              userIds: recipientIds,
            },
            userId,
          );
        }

        if (marriageDate && dayjs(marriageDate).format('MM-DD') === today) {
          await this.createNotification(
            {
              type: 'ANNIVERSARY',
              title: `💍 Anniversary Alert`,
              message: `Today is ${fullName}'s wedding anniversary! 🎉`,
              familyCode,
              referenceId: userId,
              userIds: recipientIds,
            },
            userId,
          );
        }
      }
    }

    return { message: 'Birthday and anniversary notifications sent.' };
  }

  async markAllAsRead(userId: number): Promise<{ message: string }> {
    await this.recipientModel.update(
      { isRead: true },
      {
        where: {
          userId,
          isRead: false, // only update unread
        },
      },
    );

    return { message: 'All notifications marked as read' };
  }

  /**
   * Get the next available personId for a family tree
   */
  async getNextPersonId(familyCode: string, transaction: any): Promise<number> {
    try {
      const { FamilyTree } = await import('../family/model/family-tree.model');

      const maxPersonId = await FamilyTree.max('personId', {
        where: { familyCode },
        transaction,
      });

      return (Number(maxPersonId) || 0) + 1;
    } catch (error) {
      console.error('Error getting next personId:', error);
      return 1; // Fallback to 1 if error
    }
  }

  async getFamilyJoinRequestNotifications(familyCode: string) {
    return this.notificationModel.findAll({
      where: {
        familyCode,
        type: 'FAMILY_JOIN_REQUEST',
        status: 'pending',
      },
      order: [['createdAt', 'DESC']],
    });
  }

  async canRecipientViewJoinRequesterProfile(
    familyCode: string,
    requesterUserId: number,
    recipientUserId: number,
  ): Promise<boolean> {
    const notification = await this.notificationModel.findOne({
      where: {
        familyCode,
        type: 'FAMILY_JOIN_REQUEST',
        status: 'pending',
        triggeredBy: Number(requesterUserId),
      } as any,
      order: [['createdAt', 'DESC']],
    });

    if (!notification) return false;

    const recipient = await this.recipientModel.findOne({
      where: {
        notificationId: notification.id,
        userId: Number(recipientUserId),
      } as any,
    });

    return Boolean(recipient);
  }

  async hasPendingFamilyJoinRequest(
    familyCode: string,
    requesterUserId: number,
  ): Promise<boolean> {
    const notification = await this.notificationModel.findOne({
      where: {
        familyCode,
        type: 'FAMILY_JOIN_REQUEST',
        status: 'pending',
        triggeredBy: Number(requesterUserId),
      } as any,
      order: [['createdAt', 'DESC']],
    });

    return Boolean(notification);
  }

  /**
   * Create dynamic family cards when association requests are accepted
   */
  async createDynamicFamilyCards(
    senderId: number,
    targetUserId: number,
    senderFamilyCode: string,
    targetFamilyCode: string,
    senderProfile: any,
    targetProfile: any,
    transaction: any,
  ): Promise<void> {
    try {
      const { FamilyTree } = await import('../family/model/family-tree.model');

      console.log(
        `🔄 Creating dynamic family cards between families ${senderFamilyCode} and ${targetFamilyCode}`,
      );
      console.log(
        `🔧 DEBUG: Input parameters - senderId: ${senderId}, targetUserId: ${targetUserId}`,
      );

      // Get user profile details for relationship detection
      const senderUserProfile =
        senderProfile?.user?.userProfile || senderProfile;
      const targetUserProfile =
        targetProfile?.user?.userProfile || targetProfile;

      console.log(`🔧 DEBUG: Extracted profiles:`);
      console.log(
        `🔧 DEBUG: Sender - gender: ${senderUserProfile?.gender}, age: ${senderUserProfile?.age}`,
      );
      console.log(
        `🔧 DEBUG: Target - gender: ${targetUserProfile?.gender}, age: ${targetUserProfile?.age}`,
      );

      if (!senderUserProfile || !targetUserProfile) {
        console.log('❌ Missing user profile data for relationship detection');
        console.log(
          `❌ DEBUG: senderUserProfile exists: ${!!senderUserProfile}`,
        );
        console.log(
          `❌ DEBUG: targetUserProfile exists: ${!!targetUserProfile}`,
        );

        // Fallback: create spouse cards anyway with default relationship
        console.log('⚠️ Falling back to spouse relationship creation');
        await this.createSpouseCards(
          senderId,
          targetUserId,
          senderFamilyCode,
          targetFamilyCode,
          1,
          1, // Default personIds, will be updated
          { gender: 'unknown', age: 0 },
          { gender: 'unknown', age: 0 },
          transaction,
        );

        await Promise.all([
          repairFamilyTreeIntegrity({
            familyCode: senderFamilyCode,
            transaction,
            lock: true,
            fixExternalGenerations: true,
          }),
          repairFamilyTreeIntegrity({
            familyCode: targetFamilyCode,
            transaction,
            lock: true,
            fixExternalGenerations: true,
          }),
        ]);
        return;
      }

      // Simplified logic: Always create spouse relationship for association requests
      console.log(`🔍 Creating spouse relationship for association request`);

      // Get next available personIds for both family trees
      const [senderNextPersonId, targetNextPersonId] = await Promise.all([
        this.getNextPersonId(senderFamilyCode, transaction),
        this.getNextPersonId(targetFamilyCode, transaction),
      ]);

      // Always create spouse cards for association requests
      console.log(
        `🔧 DEBUG: Creating spouse cards with personIds - sender: ${senderNextPersonId}, target: ${targetNextPersonId}`,
      );
      await this.createSpouseCards(
        senderId,
        targetUserId,
        senderFamilyCode,
        targetFamilyCode,
        senderNextPersonId,
        targetNextPersonId,
        senderUserProfile,
        targetUserProfile,
        transaction,
      );

      await Promise.all([
        repairFamilyTreeIntegrity({
          familyCode: senderFamilyCode,
          transaction,
          lock: true,
          fixExternalGenerations: true,
        }),
        repairFamilyTreeIntegrity({
          familyCode: targetFamilyCode,
          transaction,
          lock: true,
          fixExternalGenerations: true,
        }),
      ]);

      console.log(`✅ Dynamic family cards created successfully`);
    } catch (error) {
      console.error('❌ Error creating dynamic family cards:', error);
      throw error;
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
   * Simplified relationship detection - always returns spouse for association requests
   * This ensures all association requests create spouse relationships for easy cross-family navigation
   */
  private detectRelationshipType(user1Profile: any, user2Profile: any): string {
    console.log(
      `🔍 Simplified relationship detection - forcing spouse relationship`,
    );
    console.log(`   User 1: ${user1Profile?.gender || 'unknown'}`);
    console.log(`   User 2: ${user2Profile?.gender || 'unknown'}`);
    console.log(
      `🔍 All association requests will create spouse relationships for easy navigation`,
    );

    // Always return spouse for association requests
    // This simplifies the logic and ensures cross-family navigation works consistently
    return 'spouse';
  }

  /**
   * Calculate the appropriate generation for any relationship type in a family tree
   * Considers both users' existing generations and relationship type
   */
  private async calculateGeneration(
    familyCode: string,
    userId: number,
    partnerUserId: number,
    relationshipType: string,
    transaction: any,
  ): Promise<number> {
    const { FamilyTree } = await import('../family/model/family-tree.model');

    // Check if the user already has a card in this family
    const existingCard = await FamilyTree.findOne({
      where: { familyCode, userId },
      transaction,
    });

    if (existingCard) {
      console.log(
        `🔧 User ${userId} already exists in family ${familyCode} with generation ${existingCard.generation}`,
      );
      return existingCard.generation;
    }

    // Check if the partner already has a card in this family
    const partnerCard = await FamilyTree.findOne({
      where: { familyCode, userId: partnerUserId },
      transaction,
    });

    if (partnerCard) {
      const partnerGeneration = partnerCard.generation || 0;
      let calculatedGeneration;

      switch (relationshipType) {
        case 'spouse':
        case 'sibling':
          // Same generation as partner
          calculatedGeneration = partnerGeneration;
          console.log(
            `🔧 ${relationshipType} relationship: using partner's generation ${calculatedGeneration}`,
          );
          break;
        case 'parent-child':
          // Determine who is parent/child based on age or existing family structure
          calculatedGeneration = partnerGeneration - 1; // Default: user is parent (older generation)
          console.log(
            `🔧 Parent-child relationship: using generation ${calculatedGeneration} (parent of partner)`,
          );
          break;
        default:
          calculatedGeneration = partnerGeneration;
          console.log(
            `🔧 General relationship: using partner's generation ${calculatedGeneration}`,
          );
      }

      return calculatedGeneration;
    }

    // Find all existing family members to determine the appropriate generation
    const familyMembers = await FamilyTree.findAll({
      where: { familyCode },
      transaction,
    });

    if (familyMembers.length === 0) {
      console.log(
        `🔧 No existing members in family ${familyCode}, using generation 0`,
      );
      return 0;
    }

    // Calculate generation based on relationship type and existing family structure
    const generationCounts = {};
    familyMembers.forEach((member) => {
      const gen = member.generation || 0;
      generationCounts[gen] = (generationCounts[gen] || 0) + 1;
    });

    // Find the most common generation (mode) among existing members
    const mostCommonGeneration = Object.keys(generationCounts).reduce((a, b) =>
      generationCounts[a] > generationCounts[b] ? a : b,
    );

    let calculatedGeneration = parseInt(mostCommonGeneration);

    // Adjust generation based on relationship type
    switch (relationshipType) {
      case 'parent-child':
        // If adding as parent, use older generation (lower number)
        calculatedGeneration = calculatedGeneration - 1;
        console.log(
          `🔧 Parent-child: calculated generation ${calculatedGeneration} (parent level)`,
        );
        break;
      case 'spouse':
      case 'sibling':
        // Same generation as most common
        console.log(
          `🔧 ${relationshipType}: using most common generation ${calculatedGeneration}`,
        );
        break;
      default:
        console.log(
          `🔧 General relationship: using most common generation ${calculatedGeneration}`,
        );
    }

    return calculatedGeneration;
  }

  /**
   * Create spouse relationship cards with proper personId cross-references
   */
  private async createSpouseCards(
    senderId: number,
    targetUserId: number,
    senderFamilyCode: string,
    targetFamilyCode: string,
    senderPersonId: number,
    targetPersonId: number,
    senderProfile: any,
    targetProfile: any,
    transaction: any,
  ): Promise<void> {
    const { FamilyTree } = await import('../family/model/family-tree.model');

    console.log(`🔧 Creating spouse cards with proper cross-references`);
    console.log(
      `🔧 Sender ${senderId} (personId: ${senderPersonId} in ${senderFamilyCode}) -> Target family ${targetFamilyCode} (personId: ${targetPersonId})`,
    );
    console.log(
      `🔧 Target ${targetUserId} (personId: ${targetPersonId} in ${targetFamilyCode}) -> Sender family ${senderFamilyCode} (personId: ${senderPersonId})`,
    );

    // Calculate proper generations for both families, considering both users and relationship type
    const [senderGeneration, targetGeneration] = await Promise.all([
      this.calculateGeneration(
        senderFamilyCode,
        senderId,
        targetUserId,
        'spouse',
        transaction,
      ),
      this.calculateGeneration(
        targetFamilyCode,
        targetUserId,
        senderId,
        'spouse',
        transaction,
      ),
    ]);

    console.log(
      `🔧 Calculated generations - Sender: ${senderGeneration}, Target: ${targetGeneration}`,
    );

    // Ensure both spouses are in the same generation level by using the same generation
    // Use the higher generation number to maintain family hierarchy
    const finalGeneration = Math.max(senderGeneration, targetGeneration);
    console.log(
      `🔧 Using final generation ${finalGeneration} for both spouse cards`,
    );

    // Step 1: Create sender's card in target's family tree
    // Idempotency: re-use existing cross-family card if it already exists.
    let senderCardInTargetFamily = await FamilyTree.findOne({
      where: { familyCode: targetFamilyCode, userId: senderId },
      order: [['id', 'DESC']],
      transaction,
    });

    if (!senderCardInTargetFamily) {
      senderCardInTargetFamily = await FamilyTree.create(
        {
          familyCode: targetFamilyCode,
          userId: senderId,
          personId: targetPersonId,
          generation: finalGeneration, // Use final matched generation
          parents: [],
          children: [],
          spouses: [], // Will be updated after target card is created
          siblings: [],
        },
        { transaction },
      );
      console.log(`✅ Created sender card in target family`);
    } else {
      console.log(`⚠️ Sender card already exists in target family (reusing)`);
    }

    // Step 2: Create target's card in sender's family tree
    // Idempotency: re-use existing cross-family card if it already exists.
    let targetCardInSenderFamily = await FamilyTree.findOne({
      where: { familyCode: senderFamilyCode, userId: targetUserId },
      order: [['id', 'DESC']],
      transaction,
    });

    if (!targetCardInSenderFamily) {
      targetCardInSenderFamily = await FamilyTree.create(
        {
          familyCode: senderFamilyCode,
          userId: targetUserId,
          personId: senderPersonId,
          generation: finalGeneration, // Use final matched generation
          parents: [],
          children: [],
          spouses: [], // Will be updated after sender card is created
          siblings: [],
        },
        { transaction },
      );
      console.log(`✅ Created target card in sender family`);
    } else {
      console.log(`⚠️ Target card already exists in sender family (reusing)`);
    }

    // Step 3: Find or create the target's original card in their own family
    let targetOriginalCard = await FamilyTree.findOne({
      where: { familyCode: targetFamilyCode, userId: targetUserId },
      transaction,
    });

    if (!targetOriginalCard) {
      // Create original card if it doesn't exist
      const targetOriginalPersonId = await this.getNextPersonId(
        targetFamilyCode,
        transaction,
      );
      targetOriginalCard = await FamilyTree.create(
        {
          familyCode: targetFamilyCode,
          userId: targetUserId,
          personId: targetOriginalPersonId,
          generation: 1,
          parents: [],
          children: [],
          spouses: [],
          siblings: [],
        },
        { transaction },
      );
      console.log(`✅ Created target's original card in their own family`);
    }

    // Step 4: Find or create the sender's original card in their own family
    let senderOriginalCard = await FamilyTree.findOne({
      where: { familyCode: senderFamilyCode, userId: senderId },
      transaction,
    });

    if (!senderOriginalCard) {
      // Create original card if it doesn't exist
      const senderOriginalPersonId = await this.getNextPersonId(
        senderFamilyCode,
        transaction,
      );
      senderOriginalCard = await FamilyTree.create(
        {
          familyCode: senderFamilyCode,
          userId: senderId,
          personId: senderOriginalPersonId,
          generation: 1,
          parents: [],
          children: [],
          spouses: [],
          siblings: [],
        },
        { transaction },
      );
      console.log(`✅ Created sender's original card in their own family`);
    }

    // Step 5: Update spouse relationships with correct personId references
    // Sender's card in target family should reference target's original personId
    if (targetOriginalCard) {
      const currentSpouses = senderCardInTargetFamily.spouses || [];
      if (!currentSpouses.includes(targetOriginalCard.personId)) {
        await senderCardInTargetFamily.update(
          {
            spouses: [...currentSpouses, targetOriginalCard.personId],
          },
          { transaction },
        );
        console.log(
          `✅ Updated sender card spouse reference to target's original personId: ${targetOriginalCard.personId}`,
        );
      }
    }

    // Target's card in sender family should reference sender's original personId
    if (senderOriginalCard) {
      const currentSpouses = targetCardInSenderFamily.spouses || [];
      if (!currentSpouses.includes(senderOriginalCard.personId)) {
        await targetCardInSenderFamily.update(
          {
            spouses: [...currentSpouses, senderOriginalCard.personId],
          },
          { transaction },
        );
        console.log(
          `✅ Updated target card spouse reference to sender's original personId: ${senderOriginalCard.personId}`,
        );
      }
    }

    // Step 6: Update original cards to include cross-family spouse references
    if (senderOriginalCard && targetCardInSenderFamily) {
      const currentSpouses = Array.isArray(senderOriginalCard.spouses)
        ? senderOriginalCard.spouses
        : [];
      if (!currentSpouses.includes(targetCardInSenderFamily.personId)) {
        await senderOriginalCard.update(
          {
            spouses: [...currentSpouses, targetCardInSenderFamily.personId],
          },
          { transaction },
        );
        console.log(
          `✅ Updated sender's original card (personId: ${senderOriginalCard.personId}) with cross-family spouse reference: ${targetCardInSenderFamily.personId}`,
        );
      }
    }

    if (targetOriginalCard && senderCardInTargetFamily) {
      const currentSpouses = Array.isArray(targetOriginalCard.spouses)
        ? targetOriginalCard.spouses
        : [];
      if (!currentSpouses.includes(senderCardInTargetFamily.personId)) {
        await targetOriginalCard.update(
          {
            spouses: [...currentSpouses, senderCardInTargetFamily.personId],
          },
          { transaction },
        );
        console.log(
          `✅ Updated target's original card (personId: ${targetOriginalCard.personId}) with cross-family spouse reference: ${senderCardInTargetFamily.personId}`,
        );
      }
    }

    // Step 7: Reload and verify the updates
    await senderOriginalCard.reload({ transaction });
    await targetOriginalCard.reload({ transaction });
    await senderCardInTargetFamily.reload({ transaction });
    await targetCardInSenderFamily.reload({ transaction });

    console.log(`🔧 DEBUG: Final spouse arrays after reload:`);
    console.log(
      `🔧 DEBUG: Sender original card (${senderFamilyCode}) spouses: ${JSON.stringify(
        senderOriginalCard.spouses,
      )}`,
    );
    console.log(
      `🔧 DEBUG: Target original card (${targetFamilyCode}) spouses: ${JSON.stringify(
        targetOriginalCard.spouses,
      )}`,
    );
    console.log(
      `🔧 DEBUG: Sender card in target family spouses: ${JSON.stringify(
        senderCardInTargetFamily.spouses,
      )}`,
    );
    console.log(
      `🔧 DEBUG: Target card in sender family spouses: ${JSON.stringify(
        targetCardInSenderFamily.spouses,
      )}`,
    );

    console.log(
      `✅ Spouse cards created successfully with proper cross-references`,
    );
  }

  /**
   * Create association cards - completely new clean implementation
   */
  private async createAssociationCards(
    senderId: number,
    targetUserId: number,
    senderFamilyCode: string,
    targetFamilyCode: string,
    transaction: any,
  ): Promise<void> {
    const { FamilyTree } = await import('../family/model/family-tree.model');

    console.log(`🔧 Creating association cards: ${senderId} ↔ ${targetUserId}`);
    console.log(`🔧 Families: ${senderFamilyCode} ↔ ${targetFamilyCode}`);

    // Step 1: Check if cards already exist
    const [senderInTargetFamily, targetInSenderFamily] = await Promise.all([
      FamilyTree.findOne({
        where: { familyCode: targetFamilyCode, userId: senderId },
        transaction,
      }),
      FamilyTree.findOne({
        where: { familyCode: senderFamilyCode, userId: targetUserId },
        transaction,
      }),
    ]);

    // Step 2: Get next available personIds
    const [senderPersonId, targetPersonId] = await Promise.all([
      this.getNextPersonId(senderFamilyCode, transaction),
      this.getNextPersonId(targetFamilyCode, transaction),
    ]);

    console.log(
      `🔧 PersonIds: sender=${senderPersonId}, target=${targetPersonId}`,
    );

    // Step 3: Create sender's card in target's family (if not exists)
    if (!senderInTargetFamily) {
      const senderCard = await FamilyTree.create(
        {
          familyCode: targetFamilyCode,
          userId: senderId,
          personId: targetPersonId,
          generation: 1,
          parents: [],
          children: [],
          spouses: [], // Will be updated with proper cross-family personId references
          siblings: [],
        },
        { transaction },
      );

      console.log(
        `✅ Created sender card in target family: ${senderId} → ${targetFamilyCode}`,
      );
    } else {
      console.log(`⚠️ Sender already exists in target family`);
    }

    // Step 4: Create target's card in sender's family (if not exists)
    if (!targetInSenderFamily) {
      const targetCard = await FamilyTree.create(
        {
          familyCode: senderFamilyCode,
          userId: targetUserId,
          personId: senderPersonId,
          generation: 1,
          parents: [],
          children: [],
          spouses: [], // Will be updated with proper cross-family personId references
          siblings: [],
        },
        { transaction },
      );

      console.log(
        `✅ Created target card in sender family: ${targetUserId} → ${senderFamilyCode}`,
      );
    } else {
      console.log(`⚠️ Target already exists in sender family`);
    }

    console.log(`✅ Association cards creation completed`);
  }

  /**
   * Create simple bidirectional spouse cards - clean implementation
   */
  private async createSimpleSpouseCards(
    senderId: number,
    targetUserId: number,
    senderFamilyCode: string,
    targetFamilyCode: string,
    transaction: any,
  ): Promise<void> {
    try {
      const { FamilyTree } = await import('../family/model/family-tree.model');

      console.log(
        `🔧 Creating simple spouse cards: ${senderId} ↔ ${targetUserId}`,
      );
      console.log(`🔧 Family codes: ${senderFamilyCode} ↔ ${targetFamilyCode}`);

      // Check if cards already exist to prevent duplicates
      console.log(`🔧 Checking for existing cards...`);
      const [existingSenderCard, existingTargetCard] = await Promise.all([
        FamilyTree.findOne({
          where: { familyCode: targetFamilyCode, userId: senderId },
          transaction,
        }),
        FamilyTree.findOne({
          where: { familyCode: senderFamilyCode, userId: targetUserId },
          transaction,
        }),
      ]);

      console.log(
        `🔧 Existing cards - Sender: ${!!existingSenderCard}, Target: ${!!existingTargetCard}`,
      );

      // Get next available personIds
      console.log(`🔧 Getting next person IDs...`);
      const [senderPersonId, targetPersonId] = await Promise.all([
        this.getNextPersonId(senderFamilyCode, transaction),
        this.getNextPersonId(targetFamilyCode, transaction),
      ]);

      console.log(
        `🔧 Person IDs - Sender: ${senderPersonId}, Target: ${targetPersonId}`,
      );

      // Create sender's card in target's family tree (if doesn't exist)
      if (!existingSenderCard) {
        console.log(`🔧 Creating sender card in target family...`);
        const senderCard = await FamilyTree.create(
          {
            familyCode: targetFamilyCode,
            userId: senderId,
            personId: targetPersonId,
            generation: 1,
            parents: [],
            children: [],
            spouses: [], // Will be updated with proper cross-family personId references
            siblings: [],
          },
          { transaction },
        );
        console.log(
          `✅ Created sender card in target family: ${senderId} → ${targetFamilyCode}`,
          senderCard.id,
        );
      } else {
        console.log(`⚠️ Sender card already exists in target family`);
      }

      // Create target's card in sender's family tree (if doesn't exist)
      if (!existingTargetCard) {
        console.log(`🔧 Creating target card in sender family...`);
        const targetCard = await FamilyTree.create(
          {
            familyCode: senderFamilyCode,
            userId: targetUserId,
            personId: senderPersonId,
            generation: 1,
            parents: [],
            children: [],
            spouses: [], // Will be updated with proper cross-family personId references
            siblings: [],
          },
          { transaction },
        );
        console.log(
          `✅ Created target card in sender family: ${targetUserId} → ${senderFamilyCode}`,
          targetCard.id,
        );
      } else {
        console.log(`⚠️ Target card already exists in sender family`);
      }

      console.log(`✅ Simple spouse cards creation completed successfully`);
    } catch (error) {
      console.error(`❌ Error in createSimpleSpouseCards:`, error);
      throw error;
    }
  }

  /**
   * Create parent-child relationship cards
   */
  private async createParentChildCards(
    senderId: number,
    targetUserId: number,
    senderFamilyCode: string,
    targetFamilyCode: string,
    senderPersonId: number,
    targetPersonId: number,
    senderProfile: any,
    targetProfile: any,
    transaction: any,
  ): Promise<void> {
    const { FamilyTree } = await import('../family/model/family-tree.model');

    console.log(
      `🔧 Creating parent-child cards between ${senderId} and ${targetUserId}`,
    );

    // Determine who is parent and who is child based on age
    const senderAge = senderProfile.age || 0;
    const targetAge = targetProfile.age || 0;

    const isTargetParent = targetAge > senderAge;
    const parentId = isTargetParent ? targetUserId : senderId;
    const childId = isTargetParent ? senderId : targetUserId;
    const parentFamilyCode = isTargetParent
      ? targetFamilyCode
      : senderFamilyCode;
    const childFamilyCode = isTargetParent
      ? senderFamilyCode
      : targetFamilyCode;
    const parentPersonId = isTargetParent ? targetPersonId : senderPersonId;
    const childPersonId = isTargetParent ? senderPersonId : targetPersonId;

    // Check if parent card already exists in child's family tree
    const existingParentCard = await FamilyTree.findOne({
      where: {
        familyCode: childFamilyCode,
        userId: parentId,
      },
      transaction,
    });

    // Check if child card already exists in parent's family tree
    const existingChildCard = await FamilyTree.findOne({
      where: {
        familyCode: parentFamilyCode,
        userId: childId,
      },
      transaction,
    });

    // Create or update parent card in child's family tree
    if (existingParentCard) {
      const currentChildren = existingParentCard.children || [];
      if (!currentChildren.includes(childId)) {
        await existingParentCard.update(
          {
            children: [...currentChildren, childId],
          },
          { transaction },
        );
        console.log(`🔧 Updated existing parent card with new child`);
      }
    } else {
      await FamilyTree.create(
        {
          familyCode: childFamilyCode,
          userId: parentId,
          personId: childPersonId,
          generation: 0, // Parent generation
          parents: [],
          children: [childId],
          spouses: [],
          siblings: [],
        },
        { transaction },
      );
      console.log(`✅ Created parent card in child's family tree`);
    }

    // Create or update child card in parent's family tree
    if (existingChildCard) {
      const currentParents = existingChildCard.parents || [];
      if (!currentParents.includes(parentId)) {
        await existingChildCard.update(
          {
            parents: [...currentParents, parentId],
          },
          { transaction },
        );
        console.log(`🔧 Updated existing child card with new parent`);
      }
    } else {
      await FamilyTree.create(
        {
          familyCode: parentFamilyCode,
          userId: childId,
          personId: parentPersonId,
          generation: 1, // Child generation
          parents: [parentId],
          children: [],
          spouses: [],
          siblings: [],
        },
        { transaction },
      );
      console.log(`✅ Created child card in parent's family tree`);
    }

    console.log(`✅ Parent-child relationship established successfully`);
  }

  /**
   * Create sibling relationship cards
   */
  private async createSiblingCards(
    senderId: number,
    targetUserId: number,
    senderFamilyCode: string,
    targetFamilyCode: string,
    senderPersonId: number,
    targetPersonId: number,
    senderProfile: any,
    targetProfile: any,
    transaction: any,
  ): Promise<void> {
    const { FamilyTree } = await import('../family/model/family-tree.model');

    console.log(
      `🔧 Creating sibling cards between ${senderId} and ${targetUserId}`,
    );

    // Check if sender card already exists in target's family tree
    const existingSenderCard = await FamilyTree.findOne({
      where: {
        familyCode: targetFamilyCode,
        userId: senderId,
      },
      transaction,
    });

    // Check if target card already exists in sender's family tree
    const existingTargetCard = await FamilyTree.findOne({
      where: {
        familyCode: senderFamilyCode,
        userId: targetUserId,
      },
      transaction,
    });

    // Get or create sender's parents from their own family tree
    const senderInOwnFamily = await FamilyTree.findOne({
      where: {
        familyCode: senderFamilyCode,
        userId: senderId,
      },
      transaction,
    });

    const parents = senderInOwnFamily?.parents || [];
    const generation = senderInOwnFamily?.generation || 1;

    // Create or update sender card in target's family tree
    if (existingSenderCard) {
      const currentSiblings = existingSenderCard.siblings || [];
      if (!currentSiblings.includes(targetUserId)) {
        await existingSenderCard.update(
          {
            siblings: [...currentSiblings, targetUserId],
            parents: [
              ...new Set([...parents, ...(existingSenderCard.parents || [])]),
            ],
          },
          { transaction },
        );
        console.log(`🔧 Updated existing sender card with new sibling`);
      }
    } else {
      await FamilyTree.create(
        {
          familyCode: targetFamilyCode,
          userId: senderId,
          personId: targetPersonId,
          generation: generation,
          parents: parents,
          children: [],
          spouses: [],
          siblings: [targetUserId], // Connected as sibling
        },
        { transaction },
      );
      console.log(`✅ Created sender card in target's family tree`);
    }

    // Create or update target card in sender's family tree
    if (existingTargetCard) {
      const currentSiblings = existingTargetCard.siblings || [];
      if (!currentSiblings.includes(senderId)) {
        await existingTargetCard.update(
          {
            siblings: [...currentSiblings, senderId],
            parents: [
              ...new Set([...parents, ...(existingTargetCard.parents || [])]),
            ],
          },
          { transaction },
        );
        console.log(`🔧 Updated existing target card with new sibling`);
      }
    } else {
      await FamilyTree.create(
        {
          familyCode: senderFamilyCode,
          userId: targetUserId,
          personId: senderPersonId,
          generation: generation,
          parents: parents,
          children: [],
          spouses: [],
          siblings: [senderId], // Connected as sibling
        },
        { transaction },
      );
      console.log(`✅ Created target card in sender's family tree`);
    }

    console.log(`✅ Sibling relationship established successfully`);
  }

  /**
   * Create general association cards
   */
  private async createGeneralAssociationCards(
    senderId: number,
    targetUserId: number,
    senderFamilyCode: string,
    targetFamilyCode: string,
    senderPersonId: number,
    targetPersonId: number,
    senderProfile: any,
    targetProfile: any,
    transaction: any,
  ): Promise<void> {
    const { FamilyTree } = await import('../family/model/family-tree.model');

    console.log(
      `🔧 Creating general association cards between ${senderId} and ${targetUserId}`,
    );

    // Check if sender card already exists in target's family tree
    const existingSenderCard = await FamilyTree.findOne({
      where: {
        familyCode: targetFamilyCode,
        userId: senderId,
      },
      transaction,
    });

    // Check if target card already exists in sender's family tree
    const existingTargetCard = await FamilyTree.findOne({
      where: {
        familyCode: senderFamilyCode,
        userId: targetUserId,
      },
      transaction,
    });

    // Create or update sender card in target's family tree
    if (!existingSenderCard) {
      await FamilyTree.create(
        {
          familyCode: targetFamilyCode,
          userId: senderId,
          personId: targetPersonId,
          generation: 1,
          parents: [],
          children: [],
          spouses: [],
          siblings: [],
        },
        { transaction },
      );
      console.log(`✅ Created sender card in target's family tree`);
    } else {
      console.log(`⚠️ Sender card already exists in target family`);
    }

    // Create or update target card in sender's family tree
    if (!existingTargetCard) {
      await FamilyTree.create(
        {
          familyCode: senderFamilyCode,
          userId: targetUserId,
          personId: senderPersonId,
          generation: 1,
          parents: [],
          children: [],
          spouses: [],
          siblings: [],
        },
        { transaction },
      );
      console.log(`✅ Created target card in sender's family tree`);
    } else {
      console.log(`⚠️ Target card already exists in sender family`);
    }

    console.log(`✅ General association established successfully`);
  }

  /**
   * Update existing family tree entries to include spouse relationships
   */
  private async updateExistingSpouseRelationships(
    senderId: number,
    targetUserId: number,
    senderFamilyCode: string,
    targetFamilyCode: string,
    transaction: any,
  ): Promise<void> {
    const { FamilyTree } = await import('../family/model/family-tree.model');

    // Get sender's existing card in their own family
    const senderCard = await FamilyTree.findOne({
      where: {
        familyCode: senderFamilyCode,
        userId: senderId,
      },
      transaction,
    });

    // Get target's existing card in their own family
    const targetCard = await FamilyTree.findOne({
      where: {
        familyCode: targetFamilyCode,
        userId: targetUserId,
      },
      transaction,
    });

    // Update sender's card to include spouse (if card exists)
    if (senderCard) {
      const currentSpouses = senderCard.spouses || [];
      if (!currentSpouses.includes(targetUserId)) {
        await senderCard.update(
          {
            spouses: [...currentSpouses, targetUserId],
          },
          { transaction },
        );
        console.log(
          `✅ Updated sender's existing card with spouse relationship`,
        );
      }
    }

    // Update target's card to include spouse (if card exists)
    if (targetCard) {
      const currentSpouses = targetCard.spouses || [];
      if (!currentSpouses.includes(senderId)) {
        await targetCard.update(
          {
            spouses: [...currentSpouses, senderId],
          },
          { transaction },
        );
        console.log(
          `✅ Updated target's existing card with spouse relationship`,
        );
      }
    }

    console.log(`✅ Existing spouse relationships updated`);
  }
}
