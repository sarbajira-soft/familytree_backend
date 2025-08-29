// notifications.service.ts
import { Injectable, NotFoundException, Inject, forwardRef, BadRequestException, Optional } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op } from 'sequelize';
import { Notification } from './model/notification.model';
import { NotificationRecipient } from './model/notification-recipients.model';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';
import { FamilyMember } from '../family/model/family-member.model';
import { FamilyMemberService } from '../family/family-member.service';

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
          as: 'recipients'
        }
      ]
    });
  }

  async markAsAccepted(notificationId: number) {
    return this.notificationModel.update(
      { status: 'accepted', updatedAt: new Date() },
      { where: { id: notificationId } }
    );
  }

  async markAsRejected(notificationId: number) {
    return this.notificationModel.update(
      { status: 'rejected', updatedAt: new Date() },
      { where: { id: notificationId } }
    );
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
    
    @InjectConnection()
    private readonly sequelize: Sequelize,

    @Inject(forwardRef(() => FamilyMemberService))
    private readonly familyMemberService: FamilyMemberService,
    
    @Optional()
    private readonly mailService?: any, // Using 'any' to avoid type errors for optional services

    @Optional()
    private readonly uploadService?: any,
  ) {}

  async createNotification(dto: CreateNotificationDto, triggeredBy: number) {
    const notification = await this.notificationModel.create({
      type: dto.type,
      title: dto.title,
      message: dto.message,
      familyCode: dto.familyCode,
      referenceId: dto.referenceId,
      triggeredBy,
      data: (dto as any).data || {},
    });

    const recipientRecords = dto.userIds.map((userId) => ({
      notificationId: notification.id,
      userId,
    }));

    await this.recipientModel.bulkCreate(recipientRecords);

    // Return both notification ID and request ID (referenceId) in the response
    return {
      message: 'Notification created and sent to recipients',
      notificationId: notification.id,
      requestId: notification.referenceId || notification.id // Fallback to notification.id if referenceId is not set
    };
  }

  async getAdminsForFamily(familyCode: string): Promise<number[]> {
    const admins = await this.userModel.findAll({
      include: [{
        model: FamilyMember,
        as: 'familyMemberships',
        where: {
          familyCode,
          approveStatus: 'approved',
        },
      }],
      where: { role: [2, 3] },
    });

    return admins.map((u) => u.id);
  }

  async getaAllFamilyMember(familyCode: string): Promise<number[]> {
    const admins = await this.userModel.findAll({
      include: [{
        model: FamilyMember,
        as: 'familyMemberships',
        where: {
          familyCode,
          approveStatus: 'approved',
        },
      }],
    });

    return admins.map((u) => u.id);
  }

  async updateUserFamilyAssociations(
    userId: number, 
    familyCodeToAdd: string | null | undefined,
    currentUserFamilyCode: string
  ): Promise<boolean> {
    if (!familyCodeToAdd) {
      console.log(`❌ No familyCodeToAdd provided for userId: ${userId}`);
      return false;
    }

    const userProfile = await this.UserProfileModel.findOne({
      where: { userId },
      include: [{
        model: this.userModel,
        as: 'user',
        include: [{ model: UserProfile, as: 'userProfile' }]
      }]
    });

    if (!userProfile) {
      console.log(`❌ No user profile found for userId: ${userId}`);
      return false;
    }
    
    // Skip if this is the user's own family
    if (userProfile.familyCode === familyCodeToAdd || 
        familyCodeToAdd === currentUserFamilyCode) {
      console.log(`⚠️ Skipping self-family association for userId: ${userId}`);
      return false;
    }
    
    const currentAssoc: string[] = Array.isArray(userProfile.associatedFamilyCodes)
      ? userProfile.associatedFamilyCodes.filter(Boolean) // Remove any empty/null values
      : [];
    
    if (!currentAssoc.includes(familyCodeToAdd)) {
      userProfile.associatedFamilyCodes = [...currentAssoc, familyCodeToAdd];
      await userProfile.save();
      console.log(`✅ Added familyCode ${familyCodeToAdd} to userId ${userId}'s associated codes`);
      return true;
    }
    
    console.log(`⚠️ FamilyCode ${familyCodeToAdd} already exists in userId ${userId}'s associated codes`);
    return false;
  }

  async respondToNotification(notificationId: number, action: 'accept' | 'reject', userId: number) {
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
    
    // For family association requests, we need to use the referenceId
    if (notification.type === 'FAMILY_ASSOCIATION_REQUEST' && !notification.referenceId) {
      throw new BadRequestException('Invalid notification: Missing reference ID');
    }

    // Handle different notification types
    switch (notification.type) {
      case 'FAMILY_ASSOCIATION_REQUEST':
        const notificationData = notification.data || {};
        const senderId = notificationData.senderId; // The user who sent the request
        // Prefer the intended target from notification payload; fallback to the accepting actor (admin/user)
        const targetUserId = notificationData.targetUserId || notificationData.targetId || userId;
        const senderFamilyCode = notificationData.senderFamilyCode;
        const targetFamilyCode = notification.familyCode;
        
        if (!senderId || !targetUserId || !senderFamilyCode || !targetFamilyCode) {
          throw new BadRequestException('Invalid notification data: Missing required fields');
        }
        
        // Get both users' profiles with their associated user data
        const [
          senderProfile, 
          targetProfile
        ] = await Promise.all([
          this.UserProfileModel.findOne({ 
            where: { userId: senderId },
            include: [{
              model: this.userModel,
              as: 'user',
              include: [{ model: UserProfile, as: 'userProfile' }]
            }]
          }),
          this.UserProfileModel.findOne({ 
            where: { userId: targetUserId },
            include: [{
              model: this.userModel,
              as: 'user',
              include: [{ model: UserProfile, as: 'userProfile' }]
            }]
          })
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
              console.log(`🔧 DEBUG: Starting card creation for ${senderId} ↔ ${targetUserId}`);
              console.log(`🔧 DEBUG: Family codes: ${senderFamilyCode} ↔ ${targetFamilyCode}`);
              
              // Create cards directly without method calls to avoid errors
              const { FamilyTree } = await import('../family/model/family-tree.model');
              
              // Get next available personIds
              const senderPersonId = await this.getNextPersonId(senderFamilyCode, transaction);
              const targetPersonId = await this.getNextPersonId(targetFamilyCode, transaction);
              
              console.log(`🔧 DEBUG: PersonIds - Sender: ${senderPersonId}, Target: ${targetPersonId}`);
              
              // Create sender's card in target's family tree
              await FamilyTree.create({
                familyCode: targetFamilyCode,
                userId: senderId,
                personId: targetPersonId,
                generation: 1,
                parents: [],
                children: [],
                spouses: [senderPersonId], // Reference the target's personId in sender's family
                siblings: []
              }, { transaction });
              
              // Create target's card in sender's family tree
              await FamilyTree.create({
                familyCode: senderFamilyCode,
                userId: targetUserId,
                personId: senderPersonId,
                generation: 1,
                parents: [],
                children: [],
                spouses: [targetPersonId], // Reference the sender's personId in target's family
                siblings: []
              }, { transaction });
              
              cardsCreated = true;
              console.log(`✅ DEBUG: Card creation completed successfully`);
            } catch (error) {
              console.error('❌ ERROR: Card creation failed:', error);
              console.error('❌ ERROR: Stack trace:', error.stack);
              cardsError = error.message;
              // Continue with the rest of the process even if card creation fails
            }

            // Update associated family codes bidirectionally
            const [updatedSender, updatedTarget] = await Promise.all([
              this.updateUserFamilyAssociations(
                senderId,
                targetFamilyCode,
                senderFamilyCode
              ),
              this.updateUserFamilyAssociations(
                targetUserId,
                senderFamilyCode,
                targetFamilyCode
              )
            ]);

            console.log(`📊 Association results after card creation: sender=${updatedSender}, target=${updatedTarget}`);
            
            if (cardsCreated) {
              console.log(`✅ Family association completed with dynamic cards created`);
            } else {
              console.warn(`⚠️ Family association completed but card creation had issues: ${cardsError || 'Unknown error'}`);
            }
            
            await transaction.commit();
            console.log(`✅ Family association completed successfully`);
            
            // Get the target user's name for the notification
            const targetName = targetProfile.user?.userProfile 
              ? `${targetProfile.user.userProfile.firstName || ''} ${targetProfile.user.userProfile.lastName || ''}`.trim() 
              : 'A user';
            
            // Create notification for the sender
            await this.createNotification(
              {
                type: 'FAMILY_ASSOCIATION_ACCEPTED',
                title: 'Association Request Accepted',
                message: `${targetName} has accepted your family association request.`,
                familyCode: senderFamilyCode,
                referenceId: targetUserId,
                data: {
                  senderId: targetUserId,
                  senderName: targetName,
                  senderFamilyCode: targetFamilyCode,
                  targetUserId: senderId,
                  targetFamilyCode: senderFamilyCode,
                  requestType: 'family_association_accepted',
                  cardsCreated: cardsCreated
                },
                userIds: [senderId],
              },
              targetUserId,
            );
            
            return { 
              success: true, 
              message: cardsCreated 
                ? 'Family association created successfully with dynamic cards' 
                : `Family association created but there were issues with card creation: ${cardsError || 'Unknown error'}`,
              data: {
                originalRequesterId: senderId, // The user who originally sent the request
                acceptingUserId: targetUserId, // The user who accepted the request
                requesterFamilyCode: senderFamilyCode,
                accepterFamilyCode: targetFamilyCode,
                bidirectionalCardsCreated: cardsCreated,
                cardsError: cardsError
              }
            };
            
          } catch (error) {
            await transaction.rollback();
            throw new BadRequestException('Failed to create family association: ' + error.message);
          }
          
        } else {
          // Handle rejection (actor is the target user/admin who rejected)
          const actorName = targetProfile.user?.userProfile
            ? `${targetProfile.user.userProfile.firstName || ''} ${targetProfile.user.userProfile.lastName || ''}`.trim()
            : 'A user';
            
          await this.createNotification(
            {
              type: 'FAMILY_ASSOCIATION_REJECTED',
              title: 'Association Request Declined',
              message: `Your family association request has been declined by ${actorName}.`,
              familyCode: senderFamilyCode,
              referenceId: targetUserId,
              data: {
                senderId: targetUserId,
                senderName: actorName,
                senderFamilyCode: targetFamilyCode,
                targetUserId: senderId,
                targetName: actorName,
                targetFamilyCode: senderFamilyCode,
                requestType: 'family_association_rejected'
              },
              userIds: [senderId],
            },
            targetUserId,
          );
          
          return { 
            success: true, 
            message: 'Family association request declined',
            data: {
              senderId,
              targetUserId,
              senderFamilyCode,
              targetFamilyCode
            }
          };
        }
        break;
      
      // Add other notification types here
      
      default:
        throw new BadRequestException(`Action not supported for notification type: ${notification.type}`);
    }

    // Mark the notification as read
    await this.recipientModel.update(
      { isRead: true },
      { where: { notificationId, userId } },
    );

    return { success: true, message: `Request ${action}ed successfully` };
  }

  async getNotificationsForUser(userId: number, showAll = false) {
    const options: any = {
      where: { userId },
      include: [{ model: Notification, required: true }],
      order: [['createdAt', 'DESC']],
    };

    if (!showAll) {
      options.limit = 5; // Only 5 recent if not all
    }

    const notifications = await this.recipientModel.findAll(options);

    return notifications.map((notifRecipient) => ({
      id: notifRecipient.notificationId,
      title: notifRecipient.notification.title,
      message: notifRecipient.notification.message,
      type: notifRecipient.notification.type,
      familyCode: notifRecipient.notification.familyCode,
      data: notifRecipient.notification.data,
      isRead: notifRecipient.isRead,
      createdAt: notifRecipient.notification.createdAt,
      triggeredBy: notifRecipient.notification.triggeredBy,
      referenceId: notifRecipient.notification.referenceId,
      readAt: notifRecipient.readAt,
    }));
  }

  async markNotificationAsRead(notificationId: number, userId: number) {
    const notifRecipient = await this.recipientModel.findOne({
      where: {
        notificationId,
        userId,
      },
    });

    if (!notifRecipient) {
      throw new NotFoundException('Notification not found for this user');
    }

    if (!notifRecipient.isRead) {
      notifRecipient.isRead = true;
      notifRecipient.readAt = new Date();
      await notifRecipient.save();
    }

    return { message: 'Notification marked as read' };
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
      const fullName = `${user.userProfile?.firstName ?? ''} ${user.userProfile?.lastName ?? ''}`;
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
      }
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
        transaction
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
      },
      order: [['createdAt', 'DESC']],
    });
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
    transaction: any
  ): Promise<void> {
    try {
      const { FamilyTree } = await import('../family/model/family-tree.model');
      
      console.log(`🔄 Creating dynamic family cards between families ${senderFamilyCode} and ${targetFamilyCode}`);
      
      // Get user profile details for relationship detection
      const senderUserProfile = senderProfile.user?.userProfile;
      const targetUserProfile = targetProfile.user?.userProfile;
      
      console.log(`🔧 DEBUG: Sender profile structure:`, JSON.stringify(senderProfile, null, 2));
      console.log(`🔧 DEBUG: Target profile structure:`, JSON.stringify(targetProfile, null, 2));
      
      if (!senderUserProfile || !targetUserProfile) {
        console.log('❌ Missing user profile data for relationship detection');
        console.log(`❌ DEBUG: senderUserProfile exists: ${!!senderUserProfile}`);
        console.log(`❌ DEBUG: targetUserProfile exists: ${!!targetUserProfile}`);
        throw new Error('Missing user profile data for relationship detection');
      }
      
      // Detect relationship type based on gender, age, and generation
      const relationshipType = this.detectRelationshipType(
        senderUserProfile,
        targetUserProfile
      );
      
      console.log(`🔍 Detected relationship: ${relationshipType}`);
      
      // Get next available personIds for both family trees
      const [senderNextPersonId, targetNextPersonId] = await Promise.all([
        this.getNextPersonId(senderFamilyCode, transaction),
        this.getNextPersonId(targetFamilyCode, transaction)
      ]);
      
      // Create cards based on relationship type
      switch (relationshipType) {
        case 'spouse':
          await this.createSpouseCards(
            senderId, targetUserId,
            senderFamilyCode, targetFamilyCode,
            senderNextPersonId, targetNextPersonId,
            senderUserProfile, targetUserProfile,
            transaction
          );
          break;
          
        case 'parent-child':
          await this.createParentChildCards(
            senderId, targetUserId,
            senderFamilyCode, targetFamilyCode,
            senderNextPersonId, targetNextPersonId,
            senderUserProfile, targetUserProfile,
            transaction
          );
          break;
          
        case 'sibling':
          await this.createSiblingCards(
            senderId, targetUserId,
            senderFamilyCode, targetFamilyCode,
            senderNextPersonId, targetNextPersonId,
            senderUserProfile, targetUserProfile,
            transaction
          );
          break;
          
        default:
          // Create general association cards
          await this.createGeneralAssociationCards(
            senderId, targetUserId,
            senderFamilyCode, targetFamilyCode,
            senderNextPersonId, targetNextPersonId,
            senderUserProfile, targetUserProfile,
            transaction
          );
      }
      
      console.log(`✅ Dynamic family cards created successfully`);
      
    } catch (error) {
      console.error('❌ Error creating dynamic family cards:', error);
      throw error;
    }
  }
  
  /**
   * Detect relationship type between two users
   */
  private detectRelationshipType(user1Profile: any, user2Profile: any): string {
    const user1Gender = user1Profile.gender?.toLowerCase();
    const user2Gender = user2Profile.gender?.toLowerCase();
    const user1Age = user1Profile.age || 0;
    const user2Age = user2Profile.age || 0;
    
    // Log the input data for debugging
    console.log(`🔍 Relationship detection - User1: age=${user1Age}, gender=${user1Gender} | User2: age=${user2Age}, gender=${user2Gender}`);

    // Age difference threshold for parent-child relationship
    const ageDifference = Math.abs(user1Age - user2Age);
    const PARENT_CHILD_AGE_THRESHOLD = 15;
    const SPOUSE_AGE_THRESHOLD = 10;
    
    // If significant age difference, likely parent-child
    if (ageDifference >= PARENT_CHILD_AGE_THRESHOLD) {
      console.log(`🔍 Detected parent-child relationship (age difference: ${ageDifference} years)`);
      return 'parent-child';
    }
    
    // If opposite genders and reasonable age difference, likely spouse
    if (user1Gender && user2Gender && 
        user1Gender !== user2Gender && 
        ageDifference <= SPOUSE_AGE_THRESHOLD) {
      console.log(`🔍 Detected spouse relationship (age difference: ${ageDifference} years)`);
      return 'spouse';
    }
    
    // If same gender and similar age, likely sibling
    if (user1Gender && user2Gender && 
        user1Gender === user2Gender && 
        ageDifference < 10) {
      console.log(`🔍 Detected sibling relationship (age difference: ${ageDifference} years)`);
      return 'sibling';
    }
    
    console.log(`🔍 No specific relationship detected, using general association`);
    return 'general';
  }
  
  /**
   * Create spouse relationship cards
   */
  private async createSpouseCards(
    senderId: number, targetUserId: number,
    senderFamilyCode: string, targetFamilyCode: string,
    senderPersonId: number, targetPersonId: number,
    senderProfile: any, targetProfile: any,
    transaction: any
  ): Promise<void> {
    const { FamilyTree } = await import('../family/model/family-tree.model');
    
    console.log(`🔧 DEBUG: Creating spouse cards`);
    console.log(`🔧 DEBUG: Sender ${senderId} -> Target family ${targetFamilyCode} with personId ${targetPersonId}`);
    console.log(`🔧 DEBUG: Target ${targetUserId} -> Sender family ${senderFamilyCode} with personId ${senderPersonId}`);
    
    // Check if sender already exists in target's family tree
    const existingSenderCard = await FamilyTree.findOne({
      where: {
        familyCode: targetFamilyCode,
        userId: senderId
      },
      transaction
    });
    
    // Check if target already exists in sender's family tree
    const existingTargetCard = await FamilyTree.findOne({
      where: {
        familyCode: senderFamilyCode,
        userId: targetUserId
      },
      transaction
    });
    
    if (existingSenderCard) {
      console.log(`⚠️ DEBUG: Sender ${senderId} already exists in family ${targetFamilyCode}, updating spouse relationship`);
      // Update existing card to add spouse relationship
      const currentSpouses = existingSenderCard.spouses || [];
      if (!currentSpouses.includes(targetUserId)) {
        await existingSenderCard.update({
          spouses: [...currentSpouses, targetUserId]
        }, { transaction });
      }
    } else {
      // Create card for sender in target's family tree
      const senderCard = await FamilyTree.create({
        familyCode: targetFamilyCode,
        userId: senderId,
        personId: targetPersonId,
        generation: 1, // Same generation as spouse
        parents: [],
        children: [],
        spouses: [targetUserId], // Connected as spouse
        siblings: []
      }, { transaction });
      console.log(`🔧 DEBUG: Created sender card:`, senderCard.toJSON());
    }
    
    if (existingTargetCard) {
      console.log(`⚠️ DEBUG: Target ${targetUserId} already exists in family ${senderFamilyCode}, updating spouse relationship`);
      // Update existing card to add spouse relationship
      const currentSpouses = existingTargetCard.spouses || [];
      if (!currentSpouses.includes(senderId)) {
        await existingTargetCard.update({
          spouses: [...currentSpouses, senderId]
        }, { transaction });
      }
    } else {
      // Create card for target in sender's family tree
      const targetCard = await FamilyTree.create({
        familyCode: senderFamilyCode,
        userId: targetUserId,
        personId: senderPersonId,
        generation: 1, // Same generation as spouse
        parents: [],
        children: [],
        spouses: [senderId], // Connected as spouse
        siblings: []
      }, { transaction });
      console.log(`🔧 DEBUG: Created target card:`, targetCard.toJSON());
    }
    
    // Update existing cards to include spouse relationships
    await this.updateExistingSpouseRelationships(
      senderId, targetUserId,
      senderFamilyCode, targetFamilyCode,
      transaction
    );
    
    console.log(`✅ Spouse cards created successfully`);
  }

  /**
   * Create association cards - completely new clean implementation
   */
  private async createAssociationCards(
    senderId: number,
    targetUserId: number,
    senderFamilyCode: string,
    targetFamilyCode: string,
    transaction: any
  ): Promise<void> {
    const { FamilyTree } = await import('../family/model/family-tree.model');
    
    console.log(`🔧 Creating association cards: ${senderId} ↔ ${targetUserId}`);
    console.log(`🔧 Families: ${senderFamilyCode} ↔ ${targetFamilyCode}`);
    
    // Step 1: Check if cards already exist
    const [senderInTargetFamily, targetInSenderFamily] = await Promise.all([
      FamilyTree.findOne({
        where: { familyCode: targetFamilyCode, userId: senderId },
        transaction
      }),
      FamilyTree.findOne({
        where: { familyCode: senderFamilyCode, userId: targetUserId },
        transaction
      })
    ]);
    
    // Step 2: Get next available personIds
    const [senderPersonId, targetPersonId] = await Promise.all([
      this.getNextPersonId(senderFamilyCode, transaction),
      this.getNextPersonId(targetFamilyCode, transaction)
    ]);
    
    console.log(`🔧 PersonIds: sender=${senderPersonId}, target=${targetPersonId}`);
    
    // Step 3: Create sender's card in target's family (if not exists)
    if (!senderInTargetFamily) {
      const senderCard = await FamilyTree.create({
        familyCode: targetFamilyCode,
        userId: senderId,
        personId: targetPersonId,
        generation: 1,
        parents: [],
        children: [],
        spouses: [senderPersonId], // Reference the target's personId in sender's family
        siblings: []
      }, { transaction });
      
      console.log(`✅ Created sender card in target family: ${senderId} → ${targetFamilyCode}`);
    } else {
      console.log(`⚠️ Sender already exists in target family`);
    }
    
    // Step 4: Create target's card in sender's family (if not exists)
    if (!targetInSenderFamily) {
      const targetCard = await FamilyTree.create({
        familyCode: senderFamilyCode,
        userId: targetUserId,
        personId: senderPersonId,
        generation: 1,
        parents: [],
        children: [],
        spouses: [targetPersonId], // Reference the sender's personId in target's family
        siblings: []
      }, { transaction });
      
      console.log(`✅ Created target card in sender family: ${targetUserId} → ${senderFamilyCode}`);
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
    transaction: any
  ): Promise<void> {
    try {
      const { FamilyTree } = await import('../family/model/family-tree.model');
      
      console.log(`🔧 Creating simple spouse cards: ${senderId} ↔ ${targetUserId}`);
      console.log(`🔧 Family codes: ${senderFamilyCode} ↔ ${targetFamilyCode}`);
      
      // Check if cards already exist to prevent duplicates
      console.log(`🔧 Checking for existing cards...`);
      const [existingSenderCard, existingTargetCard] = await Promise.all([
        FamilyTree.findOne({
          where: { familyCode: targetFamilyCode, userId: senderId },
          transaction
        }),
        FamilyTree.findOne({
          where: { familyCode: senderFamilyCode, userId: targetUserId },
          transaction
        })
      ]);
      
      console.log(`🔧 Existing cards - Sender: ${!!existingSenderCard}, Target: ${!!existingTargetCard}`);
      
      // Get next available personIds
      console.log(`🔧 Getting next person IDs...`);
      const [senderPersonId, targetPersonId] = await Promise.all([
        this.getNextPersonId(senderFamilyCode, transaction),
        this.getNextPersonId(targetFamilyCode, transaction)
      ]);
      
      console.log(`🔧 Person IDs - Sender: ${senderPersonId}, Target: ${targetPersonId}`);
      
      // Create sender's card in target's family tree (if doesn't exist)
      if (!existingSenderCard) {
        console.log(`🔧 Creating sender card in target family...`);
        const senderCard = await FamilyTree.create({
          familyCode: targetFamilyCode,
          userId: senderId,
          personId: targetPersonId,
          generation: 1,
          parents: [],
          children: [],
          spouses: [senderPersonId], // Reference the target's personId in sender's family
          siblings: []
        }, { transaction });
        console.log(`✅ Created sender card in target family: ${senderId} → ${targetFamilyCode}`, senderCard.id);
      } else {
        console.log(`⚠️ Sender card already exists in target family`);
      }
      
      // Create target's card in sender's family tree (if doesn't exist)  
      if (!existingTargetCard) {
        console.log(`🔧 Creating target card in sender family...`);
        const targetCard = await FamilyTree.create({
          familyCode: senderFamilyCode,
          userId: targetUserId,
          personId: senderPersonId,
          generation: 1,
          parents: [],
          children: [],
          spouses: [targetPersonId], // Reference the sender's personId in target's family
          siblings: []
        }, { transaction });
        console.log(`✅ Created target card in sender family: ${targetUserId} → ${senderFamilyCode}`, targetCard.id);
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
    senderId: number, targetUserId: number,
    senderFamilyCode: string, targetFamilyCode: string,
    senderPersonId: number, targetPersonId: number,
    senderProfile: any, targetProfile: any,
    transaction: any
  ): Promise<void> {
    const { FamilyTree } = await import('../family/model/family-tree.model');
    
    console.log(`🔧 Creating parent-child cards between ${senderId} and ${targetUserId}`);
    
    // Determine who is parent and who is child based on age
    const senderAge = senderProfile.age || 0;
    const targetAge = targetProfile.age || 0;
    
    const isTargetParent = targetAge > senderAge;
    const parentId = isTargetParent ? targetUserId : senderId;
    const childId = isTargetParent ? senderId : targetUserId;
    const parentFamilyCode = isTargetParent ? targetFamilyCode : senderFamilyCode;
    const childFamilyCode = isTargetParent ? senderFamilyCode : targetFamilyCode;
    const parentPersonId = isTargetParent ? targetPersonId : senderPersonId;
    const childPersonId = isTargetParent ? senderPersonId : targetPersonId;
    
    // Check if parent card already exists in child's family tree
    const existingParentCard = await FamilyTree.findOne({
      where: {
        familyCode: childFamilyCode,
        userId: parentId
      },
      transaction
    });
    
    // Check if child card already exists in parent's family tree
    const existingChildCard = await FamilyTree.findOne({
      where: {
        familyCode: parentFamilyCode,
        userId: childId
      },
      transaction
    });
    
    // Create or update parent card in child's family tree
    if (existingParentCard) {
      const currentChildren = existingParentCard.children || [];
      if (!currentChildren.includes(childId)) {
        await existingParentCard.update({
          children: [...currentChildren, childId]
        }, { transaction });
        console.log(`🔧 Updated existing parent card with new child`);
      }
    } else {
      await FamilyTree.create({
        familyCode: childFamilyCode,
        userId: parentId,
        personId: childPersonId,
        generation: 0, // Parent generation
        parents: [],
        children: [childId],
        spouses: [],
        siblings: []
      }, { transaction });
      console.log(`✅ Created parent card in child's family tree`);
    }
    
    // Create or update child card in parent's family tree
    if (existingChildCard) {
      const currentParents = existingChildCard.parents || [];
      if (!currentParents.includes(parentId)) {
        await existingChildCard.update({
          parents: [...currentParents, parentId]
        }, { transaction });
        console.log(`🔧 Updated existing child card with new parent`);
      }
    } else {
      await FamilyTree.create({
        familyCode: parentFamilyCode,
        userId: childId,
        personId: parentPersonId,
        generation: 1, // Child generation
        parents: [parentId],
        children: [],
        spouses: [],
        siblings: []
      }, { transaction });
      console.log(`✅ Created child card in parent's family tree`);
    }
    
    console.log(`✅ Parent-child relationship established successfully`);
  }
  
  /**
   * Create sibling relationship cards
   */
  private async createSiblingCards(
    senderId: number, targetUserId: number,
    senderFamilyCode: string, targetFamilyCode: string,
    senderPersonId: number, targetPersonId: number,
    senderProfile: any, targetProfile: any,
    transaction: any
  ): Promise<void> {
    const { FamilyTree } = await import('../family/model/family-tree.model');
    
    console.log(`🔧 Creating sibling cards between ${senderId} and ${targetUserId}`);
    
    // Check if sender card already exists in target's family tree
    const existingSenderCard = await FamilyTree.findOne({
      where: {
        familyCode: targetFamilyCode,
        userId: senderId
      },
      transaction
    });
    
    // Check if target card already exists in sender's family tree
    const existingTargetCard = await FamilyTree.findOne({
      where: {
        familyCode: senderFamilyCode,
        userId: targetUserId
      },
      transaction
    });
    
    // Get or create sender's parents from their own family tree
    const senderInOwnFamily = await FamilyTree.findOne({
      where: {
        familyCode: senderFamilyCode,
        userId: senderId
      },
      transaction
    });
    
    const parents = senderInOwnFamily?.parents || [];
    const generation = senderInOwnFamily?.generation || 1;
    
    // Create or update sender card in target's family tree
    if (existingSenderCard) {
      const currentSiblings = existingSenderCard.siblings || [];
      if (!currentSiblings.includes(targetUserId)) {
        await existingSenderCard.update({
          siblings: [...currentSiblings, targetUserId],
          parents: [...new Set([...parents, ...(existingSenderCard.parents || [])])]
        }, { transaction });
        console.log(`🔧 Updated existing sender card with new sibling`);
      }
    } else {
      await FamilyTree.create({
        familyCode: targetFamilyCode,
        userId: senderId,
        personId: targetPersonId,
        generation: generation,
        parents: parents,
        children: [],
        spouses: [],
        siblings: [targetUserId] // Connected as sibling
      }, { transaction });
      console.log(`✅ Created sender card in target's family tree`);
    }
    
    // Create or update target card in sender's family tree
    if (existingTargetCard) {
      const currentSiblings = existingTargetCard.siblings || [];
      if (!currentSiblings.includes(senderId)) {
        await existingTargetCard.update({
          siblings: [...currentSiblings, senderId],
          parents: [...new Set([...parents, ...(existingTargetCard.parents || [])])]
        }, { transaction });
        console.log(`🔧 Updated existing target card with new sibling`);
      }
    } else {
      await FamilyTree.create({
        familyCode: senderFamilyCode,
        userId: targetUserId,
        personId: senderPersonId,
        generation: generation,
        parents: parents,
        children: [],
        spouses: [],
        siblings: [senderId] // Connected as sibling
      }, { transaction });
      console.log(`✅ Created target card in sender's family tree`);
    }
    
    console.log(`✅ Sibling relationship established successfully`);
  }
  
  /**
   * Create general association cards
   */
  private async createGeneralAssociationCards(
    senderId: number, targetUserId: number,
    senderFamilyCode: string, targetFamilyCode: string,
    senderPersonId: number, targetPersonId: number,
    senderProfile: any, targetProfile: any,
    transaction: any
  ): Promise<void> {
    const { FamilyTree } = await import('../family/model/family-tree.model');
    
    console.log(`🔧 Creating general association cards between ${senderId} and ${targetUserId}`);
    
    // Check if sender card already exists in target's family tree
    const existingSenderCard = await FamilyTree.findOne({
      where: {
        familyCode: targetFamilyCode,
        userId: senderId
      },
      transaction
    });
    
    // Check if target card already exists in sender's family tree
    const existingTargetCard = await FamilyTree.findOne({
      where: {
        familyCode: senderFamilyCode,
        userId: targetUserId
      },
      transaction
    });
    
    // Create or update sender card in target's family tree
    if (!existingSenderCard) {
      await FamilyTree.create({
        familyCode: targetFamilyCode,
        userId: senderId,
        personId: targetPersonId,
        generation: 1,
        parents: [],
        children: [],
        spouses: [],
        siblings: []
      }, { transaction });
      console.log(`✅ Created sender card in target's family tree`);
    } else {
      console.log(`⚠️ Sender card already exists in target family`);
    }
    
    // Create or update target card in sender's family tree
    if (!existingTargetCard) {
      await FamilyTree.create({
        familyCode: senderFamilyCode,
        userId: targetUserId,
        personId: senderPersonId,
        generation: 1,
        parents: [],
        children: [],
        spouses: [],
        siblings: []
      }, { transaction });
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
    senderId: number, targetUserId: number,
    senderFamilyCode: string, targetFamilyCode: string,
    transaction: any
  ): Promise<void> {
    const { FamilyTree } = await import('../family/model/family-tree.model');
    
    // Get sender's existing card in their own family
    const senderCard = await FamilyTree.findOne({
      where: {
        familyCode: senderFamilyCode,
        userId: senderId
      },
      transaction
    });
    
    // Get target's existing card in their own family
    const targetCard = await FamilyTree.findOne({
      where: {
        familyCode: targetFamilyCode,
        userId: targetUserId
      },
      transaction
    });
    
    // Update sender's card to include spouse (if card exists)
    if (senderCard) {
      const currentSpouses = senderCard.spouses || [];
      if (!currentSpouses.includes(targetUserId)) {
        await senderCard.update({
          spouses: [...currentSpouses, targetUserId]
        }, { transaction });
        console.log(`✅ Updated sender's existing card with spouse relationship`);
      }
    }
    
    // Update target's card to include spouse (if card exists)
    if (targetCard) {
      const currentSpouses = targetCard.spouses || [];
      if (!currentSpouses.includes(senderId)) {
        await targetCard.update({
          spouses: [...currentSpouses, senderId]
        }, { transaction });
        console.log(`✅ Updated target's existing card with spouse relationship`);
      }
    }
    
    console.log(`✅ Existing spouse relationships updated`);
  }
}
