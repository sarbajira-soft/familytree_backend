// notifications.service.ts
import { Injectable, Logger, NotFoundException, Inject, forwardRef, BadRequestException, Optional, ForbiddenException } from '@nestjs/common';
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
import { TreeMutationService } from './tree-mutation.service';
import { FamilyLinkService } from './family-link.service';
import { RelationshipService } from './relationship.service';

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
  private readonly logger = new Logger(NotificationService.name);

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

    @Inject(forwardRef(() => TreeMutationService))
    private readonly treeMutationService: TreeMutationService,

    @Inject(forwardRef(() => FamilyLinkService))
    private readonly familyLinkService: FamilyLinkService,

    private readonly relationshipService: RelationshipService,
  ) { }

  // ─── Extracted methods ──────────────────────────────────────────
  // The following methods have been moved to dedicated services:
  // • normalizeFamilyPair, isFamilyAdmin, ensureFamilyLink, ensureTreeLink,
  //   updateUserFamilyAssociations → FamilyLinkService
  // • invertRelationshipType, getOtherGeneration, normalizeGenderValue,
  //   parseAge, detectRelationshipType, calculateGeneration → RelationshipService
  // • ensureExternalLinkedCardInFamily, replaceParentByRoleInFamily,
  //   ensureSpouseLinkBetweenChildParentsIfSafe, updateLocalRelationship,
  //   linkAsSiblingByParents, propagateChildToCanonicalSpouses, getUserName,
  //   getNextPersonId, createDynamicFamilyCards, createSpouseCards,
  //   createAssociationCards, createSimpleSpouseCards, createParentChildCards,
  //   createSiblingCards, createGeneralAssociationCards,
  //   updateExistingSpouseRelationships, mergeUnique, removeUnique → TreeMutationService

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

  // [EXTRACTED] Methods moved to FamilyLinkService: createTreeLinkRequestNotification, revokeTreeLinkRequest, getPendingTreeLinkRequestsForUser, etc.
  public async filterRecipientsForBlocks(
    triggeredBy: number | null,
    familyCode: string | null | undefined,
    recipientIds: number[],
  ): Promise<number[]> {
    if (!recipientIds || recipientIds.length === 0) {
      return [];
    }

    let ids = Array.from(new Set(recipientIds.map((x) => Number(x)).filter(Boolean)));

    // BLOCK OVERRIDE: Removed legacy family-member block filtering; user-level blocking is enforced bidirectionally.
    void familyCode;

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
              await this.treeMutationService.createDynamicFamilyCards(
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
                  `🔧 DEBUG: Card - familyCode: ${card.familyCode}, userId: ${card.userId
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
              this.familyLinkService.updateUserFamilyAssociations(
                senderId,
                targetFamilyCode,
                senderFamilyCode,
              ),
              this.familyLinkService.updateUserFamilyAssociations(
                targetUserId,
                senderFamilyCode,
                targetFamilyCode,
              ),
            ]);

            // Ensure one-hop content visibility link between families
            await this.familyLinkService.ensureFamilyLink(
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
                await this.familyLinkService.updateUserFamilyAssociations(
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
                `⚠️ Family association completed but card creation had issues: ${cardsError || 'Unknown error'
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
              ? `${targetProfile.user.userProfile.firstName || ''} ${targetProfile.user.userProfile.lastName || ''
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
                        ? `${senderProfile.user.userProfile.firstName || ''} ${senderProfile.user.userProfile.lastName || ''
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
                : `Family association created but there were issues with card creation: ${cardsError || 'Unknown error'
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
            ? `${targetProfile.user.userProfile.firstName || ''} ${targetProfile.user.userProfile.lastName || ''
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
                    ? `${senderProfile.user.userProfile.firstName || ''} ${senderProfile.user.userProfile.lastName || ''
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
          await this.familyLinkService.ensureFamilyLink(
            lockedSenderFamilyCode,
            lockedReceiverFamilyCode,
            'tree',
            transaction,
          );
          await this.familyLinkService.ensureTreeLink(
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
          const inverseType = this.relationshipService.invertRelationshipType(type);

          const senderSideExternalGen = this.relationshipService.getOtherGeneration(senderGen, inverseType);
          const receiverSideExternalGen = this.relationshipService.getOtherGeneration(receiverGen, type);

          const [receiverInSenderFamily, senderInReceiverFamily] = await Promise.all([
            this.treeMutationService.ensureExternalLinkedCardInFamily({
              targetFamilyCode: lockedSenderFamilyCode,
              nodeUid: lockedReceiverNodeUid,
              canonicalFamilyCode: lockedReceiverFamilyCode,
              canonicalNodeUid: lockedReceiverNodeUid,
              canonicalUserId: receiverUserId,
              desiredGeneration: senderSideExternalGen,
              transaction,
            }),
            this.treeMutationService.ensureExternalLinkedCardInFamily({
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
              this.treeMutationService.linkAsSiblingByParents({
                familyCode: lockedSenderFamilyCode,
                canonicalPersonId: senderPersonId,
                externalPersonId: receiverExternalPersonId,
                canonicalParents: senderParents,
                transaction,
              }),
              this.treeMutationService.linkAsSiblingByParents({
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
                await this.treeMutationService.replaceParentByRoleInFamily({
                  familyCode: lockedSenderFamilyCode,
                  childPersonId: senderPersonId,
                  newParentPersonId: receiverExternalPersonId,
                  parentRole: lockedParentRole,
                  transaction,
                });
              }
              if (type === 'parent') {
                await this.treeMutationService.replaceParentByRoleInFamily({
                  familyCode: lockedReceiverFamilyCode,
                  childPersonId: receiverPersonId,
                  newParentPersonId: senderExternalPersonId,
                  parentRole: lockedParentRole,
                  transaction,
                });
              }
            }
            await Promise.all([
              this.treeMutationService.updateLocalRelationship({
                familyCode: lockedSenderFamilyCode,
                aPersonId: senderPersonId,
                bPersonId: receiverExternalPersonId,
                relationshipTypeAtoB: type,
                transaction,
              }),
              this.treeMutationService.updateLocalRelationship({
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
                await this.treeMutationService.ensureSpouseLinkBetweenChildParentsIfSafe({
                  familyCode: lockedSenderFamilyCode,
                  childPersonId: senderPersonId,
                  transaction,
                });
              }
              if (type === 'parent') {
                await this.treeMutationService.ensureSpouseLinkBetweenChildParentsIfSafe({
                  familyCode: lockedReceiverFamilyCode,
                  childPersonId: receiverPersonId,
                  transaction,
                });
              }
            }

            if (type === 'parent') {
              if (!lockedParentRole) {
                await this.treeMutationService.propagateChildToCanonicalSpouses({
                  familyCode: lockedSenderFamilyCode,
                  canonicalParentPersonId: senderPersonId,
                  childPersonId: receiverExternalPersonId,
                  transaction,
                });
              }
            }
            if (inverseType === 'parent') {
              if (!lockedParentRole) {
                await this.treeMutationService.propagateChildToCanonicalSpouses({
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

    // BLOCK OVERRIDE: Removed blocked family code filtering tied to removed ft_family_members block columns.
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
      .filter((notifRecipient: any) => !!notifRecipient)
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
      const fullName = `${user.userProfile?.firstName ?? ''} ${user.userProfile?.lastName ?? ''
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

  // [EXTRACTED] getNextPersonId moved to TreeMutationService

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

  // [EXTRACTED] Card creation methods moved to TreeMutationService
}

