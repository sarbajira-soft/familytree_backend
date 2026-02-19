import { Injectable, Logger } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op } from 'sequelize';
import { FamilyTree } from '../family/model/family-tree.model';
import { UserProfile } from '../user/model/user-profile.model';
import { repairFamilyTreeIntegrity } from '../family/tree-integrity';
import { RelationshipService } from './relationship.service';

/**
 * TreeMutationService — extracted from NotificationService.
 *
 * Owns: all tree-node creation/mutation, card creation, JSON-array manipulation.
 * Called by NotificationService.respondToNotification() and FamilyLinkService.
 */
@Injectable()
export class TreeMutationService {
    private readonly logger = new Logger(TreeMutationService.name);

    constructor(
        @InjectModel(FamilyTree)
        private readonly familyTreeModel: typeof FamilyTree,

        @InjectModel(UserProfile)
        private readonly UserProfileModel: typeof UserProfile,

        @InjectConnection()
        private readonly sequelize: Sequelize,

        private readonly relationshipService: RelationshipService,
    ) { }

    // ─── Array helpers ──────────────────────────────────────────────────

    mergeUnique(list: any, value: number): number[] {
        const arr = Array.isArray(list) ? list.map((x) => Number(x)) : [];
        if (!arr.includes(Number(value))) {
            arr.push(Number(value));
        }
        return arr;
    }

    removeUnique(list: any, value: number): number[] {
        const arr = Array.isArray(list) ? list.map((x) => Number(x)) : [];
        return arr.filter((x) => Number.isFinite(x) && Number(x) !== Number(value));
    }

    // ─── Profile helpers ───────────────────────────────────────────────

    async getUserName(userId: number): Promise<string> {
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

    // ─── PersonId generation ──────────────────────────────────────────

    async getNextPersonId(familyCode: string, transaction: any): Promise<number> {
        try {
            const maxPersonId = await this.familyTreeModel.max('personId', {
                where: { familyCode },
                transaction,
            });

            return (Number(maxPersonId) || 0) + 1;
        } catch (error) {
            this.logger.error('Error getting next personId:', error);
            return 1;
        }
    }

    // ─── Tree node mutations ──────────────────────────────────────────

    async ensureExternalLinkedCardInFamily(params: {
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

        let resolvedCanonicalUserId: number | null =
            canonicalUserId !== null && canonicalUserId !== undefined
                ? Number(canonicalUserId)
                : null;
        if (!resolvedCanonicalUserId && canonicalFamilyCode && canonicalNodeUid) {
            const canonicalRow = await this.familyTreeModel.findOne({
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

        const existing = await this.familyTreeModel.findOne({
            where: { familyCode: targetFamilyCode, nodeUid },
            transaction,
        });
        if (existing) {
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
        const created = await this.familyTreeModel.create(
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

    async replaceParentByRoleInFamily(params: {
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

        const child = await this.familyTreeModel.findOne({
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

        const parentRows = await this.familyTreeModel.findAll({
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
                genderByPersonId.set(pid, this.relationshipService.normalizeGenderValue((profile as any)?.gender));
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
            this.familyTreeModel.findOne({ where: { familyCode, personId: parentToRemove } as any, transaction }),
            otherParentId
                ? this.familyTreeModel.findOne({ where: { familyCode, personId: otherParentId } as any, transaction })
                : Promise.resolve(null as any),
            this.familyTreeModel.findOne({
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

    async ensureSpouseLinkBetweenChildParentsIfSafe(params: {
        familyCode: string;
        childPersonId: number;
        transaction: any;
    }) {
        const { familyCode, childPersonId, transaction } = params;

        const child = await this.familyTreeModel.findOne({
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
            this.familyTreeModel.findOne({ where: { familyCode, personId: p1Id } as any, transaction }),
            this.familyTreeModel.findOne({ where: { familyCode, personId: p2Id } as any, transaction }),
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

    async updateLocalRelationship(params: {
        familyCode: string;
        aPersonId: number;
        bPersonId: number;
        relationshipTypeAtoB: string;
        transaction: any;
    }) {
        const { familyCode, aPersonId, bPersonId, relationshipTypeAtoB, transaction } =
            params;

        const [a, b] = await Promise.all([
            this.familyTreeModel.findOne({ where: { familyCode, personId: aPersonId }, transaction }),
            this.familyTreeModel.findOne({ where: { familyCode, personId: bPersonId }, transaction }),
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

    async linkAsSiblingByParents(params: {
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

        const [canonical, external] = await Promise.all([
            this.familyTreeModel.findOne({ where: { familyCode, personId: canonicalPersonId }, transaction }),
            this.familyTreeModel.findOne({ where: { familyCode, personId: externalPersonId }, transaction }),
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
                const parent = await this.familyTreeModel.findOne({
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

    async propagateChildToCanonicalSpouses(params: {
        familyCode: string;
        canonicalParentPersonId: number;
        childPersonId: number;
        transaction: any;
    }) {
        const { familyCode, canonicalParentPersonId, childPersonId, transaction } = params;

        const canonicalParent = await this.familyTreeModel.findOne({
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

    // ─── Card creation methods ────────────────────────────────────────

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
            this.logger.log(
                `Creating dynamic family cards between families ${senderFamilyCode} and ${targetFamilyCode}`,
            );

            const senderUserProfile =
                senderProfile?.user?.userProfile || senderProfile;
            const targetUserProfile =
                targetProfile?.user?.userProfile || targetProfile;

            if (!senderUserProfile || !targetUserProfile) {
                this.logger.warn('Missing user profile data — falling back to spouse relationship creation');
                await this.createSpouseCards(
                    senderId,
                    targetUserId,
                    senderFamilyCode,
                    targetFamilyCode,
                    1,
                    1,
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

            const [senderNextPersonId, targetNextPersonId] = await Promise.all([
                this.getNextPersonId(senderFamilyCode, transaction),
                this.getNextPersonId(targetFamilyCode, transaction),
            ]);

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

            this.logger.log(`Dynamic family cards created successfully`);
        } catch (error) {
            this.logger.error('Error creating dynamic family cards:', error);
            throw error;
        }
    }

    async createSpouseCards(
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
        this.logger.log(`Creating spouse cards with proper cross-references`);

        const [senderGeneration, targetGeneration] = await Promise.all([
            this.relationshipService.calculateGeneration(
                senderFamilyCode,
                senderId,
                targetUserId,
                'spouse',
                transaction,
            ),
            this.relationshipService.calculateGeneration(
                targetFamilyCode,
                targetUserId,
                senderId,
                'spouse',
                transaction,
            ),
        ]);

        const finalGeneration = Math.max(senderGeneration, targetGeneration);

        // Step 1: Create sender's card in target's family tree
        let senderCardInTargetFamily = await this.familyTreeModel.findOne({
            where: { familyCode: targetFamilyCode, userId: senderId },
            order: [['id', 'DESC']],
            transaction,
        });

        if (!senderCardInTargetFamily) {
            senderCardInTargetFamily = await this.familyTreeModel.create(
                {
                    familyCode: targetFamilyCode,
                    userId: senderId,
                    personId: targetPersonId,
                    generation: finalGeneration,
                    parents: [],
                    children: [],
                    spouses: [],
                    siblings: [],
                },
                { transaction },
            );
        }

        // Step 2: Create target's card in sender's family tree
        let targetCardInSenderFamily = await this.familyTreeModel.findOne({
            where: { familyCode: senderFamilyCode, userId: targetUserId },
            order: [['id', 'DESC']],
            transaction,
        });

        if (!targetCardInSenderFamily) {
            targetCardInSenderFamily = await this.familyTreeModel.create(
                {
                    familyCode: senderFamilyCode,
                    userId: targetUserId,
                    personId: senderPersonId,
                    generation: finalGeneration,
                    parents: [],
                    children: [],
                    spouses: [],
                    siblings: [],
                },
                { transaction },
            );
        }

        // Step 3: Find or create the target's original card in their own family
        let targetOriginalCard = await this.familyTreeModel.findOne({
            where: { familyCode: targetFamilyCode, userId: targetUserId },
            transaction,
        });

        if (!targetOriginalCard) {
            const targetOriginalPersonId = await this.getNextPersonId(
                targetFamilyCode,
                transaction,
            );
            targetOriginalCard = await this.familyTreeModel.create(
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
        }

        // Step 4: Find or create the sender's original card in their own family
        let senderOriginalCard = await this.familyTreeModel.findOne({
            where: { familyCode: senderFamilyCode, userId: senderId },
            transaction,
        });

        if (!senderOriginalCard) {
            const senderOriginalPersonId = await this.getNextPersonId(
                senderFamilyCode,
                transaction,
            );
            senderOriginalCard = await this.familyTreeModel.create(
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
        }

        // Step 5: Update spouse relationships with correct personId references
        if (targetOriginalCard) {
            const currentSpouses = senderCardInTargetFamily.spouses || [];
            if (!currentSpouses.includes(targetOriginalCard.personId)) {
                await senderCardInTargetFamily.update(
                    {
                        spouses: [...currentSpouses, targetOriginalCard.personId],
                    },
                    { transaction },
                );
            }
        }

        if (senderOriginalCard) {
            const currentSpouses = targetCardInSenderFamily.spouses || [];
            if (!currentSpouses.includes(senderOriginalCard.personId)) {
                await targetCardInSenderFamily.update(
                    {
                        spouses: [...currentSpouses, senderOriginalCard.personId],
                    },
                    { transaction },
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
            }
        }

        // Step 7: Reload and verify
        await senderOriginalCard.reload({ transaction });
        await targetOriginalCard.reload({ transaction });
        await senderCardInTargetFamily.reload({ transaction });
        await targetCardInSenderFamily.reload({ transaction });

        this.logger.log(`Spouse cards created successfully with proper cross-references`);
    }

    async createAssociationCards(
        senderId: number,
        targetUserId: number,
        senderFamilyCode: string,
        targetFamilyCode: string,
        transaction: any,
    ): Promise<void> {
        this.logger.log(`Creating association cards: ${senderId} ↔ ${targetUserId}`);

        const [senderInTargetFamily, targetInSenderFamily] = await Promise.all([
            this.familyTreeModel.findOne({
                where: { familyCode: targetFamilyCode, userId: senderId },
                transaction,
            }),
            this.familyTreeModel.findOne({
                where: { familyCode: senderFamilyCode, userId: targetUserId },
                transaction,
            }),
        ]);

        const [senderPersonId, targetPersonId] = await Promise.all([
            this.getNextPersonId(senderFamilyCode, transaction),
            this.getNextPersonId(targetFamilyCode, transaction),
        ]);

        if (!senderInTargetFamily) {
            await this.familyTreeModel.create(
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
        }

        if (!targetInSenderFamily) {
            await this.familyTreeModel.create(
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
        }

        this.logger.log(`Association cards creation completed`);
    }

    async createSimpleSpouseCards(
        senderId: number,
        targetUserId: number,
        senderFamilyCode: string,
        targetFamilyCode: string,
        transaction: any,
    ): Promise<void> {
        try {
            this.logger.log(`Creating simple spouse cards: ${senderId} ↔ ${targetUserId}`);

            const [existingSenderCard, existingTargetCard] = await Promise.all([
                this.familyTreeModel.findOne({
                    where: { familyCode: targetFamilyCode, userId: senderId },
                    transaction,
                }),
                this.familyTreeModel.findOne({
                    where: { familyCode: senderFamilyCode, userId: targetUserId },
                    transaction,
                }),
            ]);

            const [senderPersonId, targetPersonId] = await Promise.all([
                this.getNextPersonId(senderFamilyCode, transaction),
                this.getNextPersonId(targetFamilyCode, transaction),
            ]);

            if (!existingSenderCard) {
                await this.familyTreeModel.create(
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
            }

            if (!existingTargetCard) {
                await this.familyTreeModel.create(
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
            }

            this.logger.log(`Simple spouse cards creation completed successfully`);
        } catch (error) {
            this.logger.error(`Error in createSimpleSpouseCards:`, error);
            throw error;
        }
    }

    async createParentChildCards(
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
        this.logger.log(
            `Creating parent-child cards between ${senderId} and ${targetUserId}`,
        );

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

        const existingParentCard = await this.familyTreeModel.findOne({
            where: {
                familyCode: childFamilyCode,
                userId: parentId,
            },
            transaction,
        });

        const existingChildCard = await this.familyTreeModel.findOne({
            where: {
                familyCode: parentFamilyCode,
                userId: childId,
            },
            transaction,
        });

        if (existingParentCard) {
            const currentChildren = existingParentCard.children || [];
            if (!currentChildren.includes(childId)) {
                await existingParentCard.update(
                    {
                        children: [...currentChildren, childId],
                    },
                    { transaction },
                );
            }
        } else {
            await this.familyTreeModel.create(
                {
                    familyCode: childFamilyCode,
                    userId: parentId,
                    personId: childPersonId,
                    generation: 0,
                    parents: [],
                    children: [childId],
                    spouses: [],
                    siblings: [],
                },
                { transaction },
            );
        }

        if (existingChildCard) {
            const currentParents = existingChildCard.parents || [];
            if (!currentParents.includes(parentId)) {
                await existingChildCard.update(
                    {
                        parents: [...currentParents, parentId],
                    },
                    { transaction },
                );
            }
        } else {
            await this.familyTreeModel.create(
                {
                    familyCode: parentFamilyCode,
                    userId: childId,
                    personId: parentPersonId,
                    generation: 1,
                    parents: [parentId],
                    children: [],
                    spouses: [],
                    siblings: [],
                },
                { transaction },
            );
        }

        this.logger.log(`Parent-child relationship established successfully`);
    }

    async createSiblingCards(
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
        this.logger.log(
            `Creating sibling cards between ${senderId} and ${targetUserId}`,
        );

        const existingSenderCard = await this.familyTreeModel.findOne({
            where: {
                familyCode: targetFamilyCode,
                userId: senderId,
            },
            transaction,
        });

        const existingTargetCard = await this.familyTreeModel.findOne({
            where: {
                familyCode: senderFamilyCode,
                userId: targetUserId,
            },
            transaction,
        });

        const senderInOwnFamily = await this.familyTreeModel.findOne({
            where: {
                familyCode: senderFamilyCode,
                userId: senderId,
            },
            transaction,
        });

        const parents = senderInOwnFamily?.parents || [];
        const generation = senderInOwnFamily?.generation || 1;

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
            }
        } else {
            await this.familyTreeModel.create(
                {
                    familyCode: targetFamilyCode,
                    userId: senderId,
                    personId: targetPersonId,
                    generation: generation,
                    parents: parents,
                    children: [],
                    spouses: [],
                    siblings: [targetUserId],
                },
                { transaction },
            );
        }

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
            }
        } else {
            await this.familyTreeModel.create(
                {
                    familyCode: senderFamilyCode,
                    userId: targetUserId,
                    personId: senderPersonId,
                    generation: generation,
                    parents: parents,
                    children: [],
                    spouses: [],
                    siblings: [senderId],
                },
                { transaction },
            );
        }

        this.logger.log(`Sibling relationship established successfully`);
    }

    async createGeneralAssociationCards(
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
        this.logger.log(
            `Creating general association cards between ${senderId} and ${targetUserId}`,
        );

        const existingSenderCard = await this.familyTreeModel.findOne({
            where: {
                familyCode: targetFamilyCode,
                userId: senderId,
            },
            transaction,
        });

        const existingTargetCard = await this.familyTreeModel.findOne({
            where: {
                familyCode: senderFamilyCode,
                userId: targetUserId,
            },
            transaction,
        });

        if (!existingSenderCard) {
            await this.familyTreeModel.create(
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
        }

        if (!existingTargetCard) {
            await this.familyTreeModel.create(
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
        }

        this.logger.log(`General association established successfully`);
    }

    async updateExistingSpouseRelationships(
        senderId: number,
        targetUserId: number,
        senderFamilyCode: string,
        targetFamilyCode: string,
        transaction: any,
    ): Promise<void> {
        const senderCard = await this.familyTreeModel.findOne({
            where: {
                familyCode: senderFamilyCode,
                userId: senderId,
            },
            transaction,
        });

        const targetCard = await this.familyTreeModel.findOne({
            where: {
                familyCode: targetFamilyCode,
                userId: targetUserId,
            },
            transaction,
        });

        if (senderCard) {
            const currentSpouses = senderCard.spouses || [];
            if (!currentSpouses.includes(targetUserId)) {
                await senderCard.update(
                    {
                        spouses: [...currentSpouses, targetUserId],
                    },
                    { transaction },
                );
            }
        }

        if (targetCard) {
            const currentSpouses = targetCard.spouses || [];
            if (!currentSpouses.includes(senderId)) {
                await targetCard.update(
                    {
                        spouses: [...currentSpouses, senderId],
                    },
                    { transaction },
                );
            }
        }

        this.logger.log(`Existing spouse relationships updated`);
    }
}
