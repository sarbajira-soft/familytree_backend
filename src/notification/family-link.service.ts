import {
    BadRequestException,
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    forwardRef,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { BlockingService } from '../blocking/blocking.service';
import { FamilyLink } from '../family/model/family-link.model';
import { FamilyMember } from '../family/model/family-member.model';
import { FamilyTree } from '../family/model/family-tree.model';
import { TreeLinkRequest } from '../family/model/tree-link-request.model';
import { TreeLink } from '../family/model/tree-link.model';
import { UserProfile } from '../user/model/user-profile.model';
import { User } from '../user/model/user.model';
import { NotificationRecipient } from './model/notification-recipients.model';
import { Notification } from './model/notification.model';
import { NotificationService } from './notification.service';
import { RelationshipService } from './relationship.service';

/**
 * FamilyLinkService — extracted from NotificationService.
 *
 * Owns: cross-family linking, tree link request creation/revocation/listing,
 * family association helpers, normalised family-pair helpers.
 */
@Injectable()
export class FamilyLinkService {
    private readonly logger = new Logger(FamilyLinkService.name);

    constructor(
        @InjectModel(User)
        private readonly userModel: typeof User,

        @InjectModel(UserProfile)
        private readonly UserProfileModel: typeof UserProfile,

        @InjectModel(FamilyMember)
        private readonly familyMemberModel: typeof FamilyMember,

        @InjectModel(FamilyLink)
        private readonly familyLinkModel: typeof FamilyLink,

        @InjectModel(TreeLinkRequest)
        private readonly treeLinkRequestModel: typeof TreeLinkRequest,

        @InjectModel(TreeLink)
        private readonly treeLinkModel: typeof TreeLink,

        @InjectModel(Notification)
        private readonly notificationModel: typeof Notification,

        @InjectModel(NotificationRecipient)
        private readonly recipientModel: typeof NotificationRecipient,

        @InjectModel(FamilyTree)
        private readonly familyTreeModel: typeof FamilyTree,

        @InjectConnection()
        private readonly sequelize: Sequelize,

        @Inject(forwardRef(() => BlockingService))
        private readonly blockingService: BlockingService,

        private readonly relationshipService: RelationshipService,

        @Inject(forwardRef(() => NotificationService))
        private readonly notificationService: NotificationService,
    ) { }

    // ─── Internal helpers ──────────────────────────────────────────────

    normalizeFamilyPair(a: string, b: string) {
        const low = a <= b ? a : b;
        const high = a <= b ? b : a;
        const aIsLow = low === a;
        return { low, high, aIsLow };
    }

    async isFamilyAdmin(userId: number, familyCode: string): Promise<boolean> {
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

    async ensureFamilyLink(
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

    async ensureTreeLink(
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
            : this.relationshipService.invertRelationshipType(relationshipTypeSenderToReceiver);

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

    // ─── Family association helpers ──────────────────────────────────────

    async updateUserFamilyAssociations(
        userId: number,
        familyCodeToAdd: string | null | undefined,
        currentUserFamilyCode: string,
    ): Promise<boolean> {
        if (!familyCodeToAdd) {
            this.logger.warn(`No familyCodeToAdd provided for userId: ${userId}`);
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
            this.logger.warn(`No user profile found for userId: ${userId}`);
            return false;
        }

        if (
            userProfile.familyCode === familyCodeToAdd ||
            familyCodeToAdd === currentUserFamilyCode
        ) {
            return false;
        }

        const currentAssoc: string[] = Array.isArray(
            userProfile.associatedFamilyCodes,
        )
            ? userProfile.associatedFamilyCodes.filter(Boolean)
            : [];

        if (!currentAssoc.includes(familyCodeToAdd)) {
            userProfile.associatedFamilyCodes = [...currentAssoc, familyCodeToAdd];
            await userProfile.save();
            this.logger.log(
                `Added familyCode ${familyCodeToAdd} to userId ${userId}'s associated codes`,
            );
            return true;
        }

        return false;
    }

    // ─── Tree link request methods ────────────────────────────────────

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

        const requesterUser = await this.userModel.findByPk(Number(requesterUserId), {
            attributes: ['id', 'status'],
        });
        if (!requesterUser || Number((requesterUser as any).status) !== 1) {
            throw new ForbiddenException('Your account is not active');
        }

        const requesterIsAdmin = await this.isFamilyAdmin(requesterUserId, String(senderFamilyCode));
        if (!requesterIsAdmin) {
            throw new ForbiddenException('Only admins can send link requests');
        }

        // BLOCK OVERRIDE: Removed legacy family-membership block validation tied to removed ft_family_members columns.

        if (String(senderFamilyCode) === String(receiverFamilyCode)) {
            throw new BadRequestException('Cannot create a cross-family link within the same family');
        }

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
                : this.relationshipService.invertRelationshipType(String(relationshipType));

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

        const [senderNode, receiverNode] = await Promise.all([
            this.familyTreeModel.findOne({ where: { familyCode: senderFamilyCode, nodeUid: senderNodeUid } as any }),
            this.familyTreeModel.findOne({ where: { familyCode: receiverFamilyCode, nodeUid: receiverNodeUid } as any }),
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

        const senderNodeUserId = (senderNode as any).userId ? Number((senderNode as any).userId) : null;
        const receiverNodeUserId = (receiverNode as any).userId ? Number((receiverNode as any).userId) : null;

        if (!receiverNodeUserId) {
            throw new BadRequestException(
                'This person does not have an app account yet. Ask them to join the app first.',
            );
        }

        if (senderNodeUserId && receiverNodeUserId && Number(senderNodeUserId) === Number(receiverNodeUserId)) {
            throw new BadRequestException('You can\'t link to your own account');
        }

        if (receiverNodeUserId) {
            const receiverUser = await this.userModel.findByPk(Number(receiverNodeUserId), {
                attributes: ['id', 'status'],
            });
            if (!receiverUser || Number((receiverUser as any).status) !== 1) {
                throw new BadRequestException('Target user account is not active');
            }

            // BLOCK OVERRIDE: Removed legacy target membership block validation tied to removed ft_family_members columns.

            const alreadyInSenderTree = await this.familyTreeModel.findOne({
                where: { familyCode: senderFamilyCode, userId: Number(receiverNodeUserId) } as any,
            });
            if (alreadyInSenderTree) {
                throw new BadRequestException('This member is already in your family tree');
            }
        }

        const receiverCanonicalInSenderTree = await this.familyTreeModel.findOne({
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

        if (senderNodeUserId) {
            const alreadyInReceiverTree = await this.familyTreeModel.findOne({
                where: { familyCode: receiverFamilyCode, userId: Number(senderNodeUserId) } as any,
            });
            if (alreadyInReceiverTree) {
                throw new BadRequestException('This link can\'t be created because the member already exists in the target tree');
            }
        }

        const senderCanonicalInReceiverTree = await this.familyTreeModel.findOne({
            where: {
                familyCode: receiverFamilyCode,
                canonicalFamilyCode: senderFamilyCode,
                canonicalNodeUid: senderNodeUid,
            } as any,
            order: [['id', 'DESC']],
        });
        if (senderCanonicalInReceiverTree) {
            throw new BadRequestException('This link can\'t be created because the member already exists in the target tree');
        }

        if (senderNodeUserId && receiverNodeUserId) {
            const blockedEitherWay = await this.blockingService.isUserBlockedEitherWay(
                senderNodeUserId,
                receiverNodeUserId,
            );
            if (blockedEitherWay) {
                throw new ForbiddenException('This link can\'t be created because one of the members is blocked');
            }
        }

        // Gender / parentRole validation
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
            return this.relationshipService.normalizeGenderValue((profile as any)?.gender);
        };

        const needsParentRole =
            String(relationshipType) === 'parent' || String(relationshipType) === 'child';
        let finalParentRole: string | null = normalizedParentRole || null;

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

        if (senderNodeUserId && senderNodeUserId !== Number(requesterUserId)) {
            const isAdmin = await this.isFamilyAdmin(requesterUserId, senderFamilyCode);
            if (!isAdmin) {
                throw new BadRequestException('Not authorized to request a link for this card');
            }
        }

        // De-dup pending request both directions
        const inverseType = this.relationshipService.invertRelationshipType(String(relationshipType));
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
                const receiverNodeForPending = await this.familyTreeModel.findOne({
                    where: { familyCode: pendingReceiverFamilyCode, nodeUid: pendingReceiverNodeUid } as any,
                });

                const directTargetUserId = receiverNodeForPending?.userId
                    ? Number((receiverNodeForPending as any).userId)
                    : null;
                const receiverAdmins = Array.from(
                    new Set(await this.notificationService.getAdminsForFamily(pendingReceiverFamilyCode)),
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

                const eligibleRecipients = await this.notificationService.filterRecipientsForBlocks(
                    requesterUserId ?? null,
                    pendingReceiverFamilyCode,
                    recipientCandidates,
                );

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

                    const requesterName = (await this.notificationService.getUserName(requesterUserId)) || 'A user';
                    const title = 'Tree Link Request';
                    const msg = `${requesterName} requested a ${pendingRelationshipType} link between families.`;

                    const notification = await this.notificationService.createNotification(
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
        const receiverAdmins = Array.from(new Set(await this.notificationService.getAdminsForFamily(receiverFamilyCode))).map(
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

        const eligibleRecipientIds = await this.notificationService.filterRecipientsForBlocks(
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

        const requesterName = (await this.notificationService.getUserName(requesterUserId)) || 'A user';
        const title = 'Tree Link Request';
        const message = `${requesterName} requested a ${relationshipType} link between families.`;

        const notification = await this.notificationService.createNotification(
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

        const canRevoke =
            (createdBy && Number(createdBy) === Number(actingUserId)) ||
            (senderFamilyCode && (await this.isFamilyAdmin(actingUserId, senderFamilyCode)));

        if (!canRevoke) {
            throw new ForbiddenException('You don\'t have permission to revoke this request');
        }

        const transaction = await this.sequelize.transaction();
        try {
            await this.treeLinkRequestModel.update(
                { status: 'revoked', respondedBy: actingUserId, updatedAt: new Date() } as any,
                { where: { id } as any, transaction },
            );

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

        const results: any[] = [];

        for (const row of rows as any[]) {
            const senderFamilyCode = String(row.senderFamilyCode || '').trim();
            const receiverFamilyCode = String(row.receiverFamilyCode || '').trim();
            const senderNodeUid = String(row.senderNodeUid || '').trim();
            const receiverNodeUid = String(row.receiverNodeUid || '').trim();

            const [senderNode, receiverNode] = await Promise.all([
                this.familyTreeModel.findOne({
                    where: { familyCode: senderFamilyCode, nodeUid: senderNodeUid } as any,
                    attributes: ['name', 'personId', 'nodeUid', 'userId'],
                }),
                this.familyTreeModel.findOne({
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
}
