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
              console.log(`🔧 DEBUG: Sender profile:`, JSON.stringify(senderProfile?.user?.userProfile, null, 2));
              console.log(`🔧 DEBUG: Target profile:`, JSON.stringify(targetProfile?.user?.userProfile, null, 2));
              
              // Create dynamic family cards with proper relationship detection
              await this.createDynamicFamilyCards(
                senderId,
                targetUserId,
                senderFamilyCode,
                targetFamilyCode,
                senderProfile,
                targetProfile,
                transaction
              );
              
              cardsCreated = true;
              console.log(`✅ DEBUG: Card creation completed successfully`);
              
              // Verify cards were actually created by querying the database
              const { FamilyTree } = await import('../family/model/family-tree.model');
              const createdCards = await FamilyTree.findAll({
                where: {
                  [require('sequelize').Op.or]: [
                    { familyCode: senderFamilyCode, userId: targetUserId },
                    { familyCode: targetFamilyCode, userId: senderId },
                    { familyCode: senderFamilyCode, userId: senderId },
                    { familyCode: targetFamilyCode, userId: targetUserId }
                  ]
                },
                transaction
              });
              
              console.log(`🔧 DEBUG: Found ${createdCards.length} cards after creation:`);
              createdCards.forEach(card => {
                console.log(`🔧 DEBUG: Card - familyCode: ${card.familyCode}, userId: ${card.userId}, personId: ${card.personId}, spouses: ${JSON.stringify(card.spouses)}`);
              });
              
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

  async markNotificationAsRead(notificationId: number, userId: number, status?: 'accepted' | 'rejected') {
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
        { where: { id: notificationId } }
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
      console.log(`🔧 DEBUG: Input parameters - senderId: ${senderId}, targetUserId: ${targetUserId}`);
      
      // Get user profile details for relationship detection
      const senderUserProfile = senderProfile?.user?.userProfile || senderProfile;
      const targetUserProfile = targetProfile?.user?.userProfile || targetProfile;
      
      console.log(`🔧 DEBUG: Extracted profiles:`);
      console.log(`🔧 DEBUG: Sender - gender: ${senderUserProfile?.gender}, age: ${senderUserProfile?.age}`);
      console.log(`🔧 DEBUG: Target - gender: ${targetUserProfile?.gender}, age: ${targetUserProfile?.age}`);
      
      if (!senderUserProfile || !targetUserProfile) {
        console.log('❌ Missing user profile data for relationship detection');
        console.log(`❌ DEBUG: senderUserProfile exists: ${!!senderUserProfile}`);
        console.log(`❌ DEBUG: targetUserProfile exists: ${!!targetUserProfile}`);
        
        // Fallback: create spouse cards anyway with default relationship
        console.log('⚠️ Falling back to spouse relationship creation');
        await this.createSpouseCards(
          senderId, targetUserId,
          senderFamilyCode, targetFamilyCode,
          1, 1, // Default personIds, will be updated
          { gender: 'unknown', age: 0 },
          { gender: 'unknown', age: 0 },
          transaction
        );
        return;
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
      console.log(`🔧 DEBUG: Creating cards for relationship type: ${relationshipType}`);
      
      switch (relationshipType) {
        case 'spouse':
          console.log(`🔧 DEBUG: Creating spouse cards with personIds - sender: ${senderNextPersonId}, target: ${targetNextPersonId}`);
          await this.createSpouseCards(
            senderId, targetUserId,
            senderFamilyCode, targetFamilyCode,
            senderNextPersonId, targetNextPersonId,
            senderUserProfile, targetUserProfile,
            transaction
          );
          break;
          
        case 'parent-child':
          console.log(`🔧 DEBUG: Creating parent-child cards`);
          await this.createParentChildCards(
            senderId, targetUserId,
            senderFamilyCode, targetFamilyCode,
            senderNextPersonId, targetNextPersonId,
            senderUserProfile, targetUserProfile,
            transaction
          );
          break;
          
        case 'sibling':
          console.log(`🔧 DEBUG: Creating sibling cards`);
          await this.createSiblingCards(
            senderId, targetUserId,
            senderFamilyCode, targetFamilyCode,
            senderNextPersonId, targetNextPersonId,
            senderUserProfile, targetUserProfile,
            transaction
          );
          break;
          
        default:
          console.log(`🔧 DEBUG: Creating general association cards`);
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
   * Detect relationship type between two users
   */
  private detectRelationshipType(user1Profile: any, user2Profile: any): string {
    const user1Gender = user1Profile?.gender;
    const user2Gender = user2Profile?.gender;
    
    // Safely parse ages with proper validation
    const user1Age = this.parseAge(user1Profile?.age);
    const user2Age = this.parseAge(user2Profile?.age);
    const ageDifference = Math.abs(user1Age - user2Age);
    
    console.log(`🔍 Relationship detection:`);
    console.log(`   User 1: ${user1Gender}, age ${user1Age}`);
    console.log(`   User 2: ${user2Gender}, age ${user2Age}`);
    console.log(`   Age difference: ${ageDifference} years`);
    
    // Improved relationship detection logic
    
    // If significant age difference (>15 years), likely parent-child
    if (ageDifference > 15) {
      console.log(`🔍 Detected parent-child relationship (age difference: ${ageDifference} years)`);
      return 'parent-child';
    }
    
    // If opposite gender and similar age (within 10 years), likely spouse
    if (user1Gender && user2Gender && 
        user1Gender !== user2Gender && 
        ageDifference <= 10) {
      console.log(`🔍 Detected spouse relationship (opposite gender, age difference: ${ageDifference} years)`);
      return 'spouse';
    }
    
    // If same gender and similar age (within 8 years), likely sibling
    if (user1Gender && user2Gender && 
        user1Gender === user2Gender && 
        ageDifference <= 8) {
      console.log(`🔍 Detected sibling relationship (same gender, age difference: ${ageDifference} years)`);
      return 'sibling';
    }
    
    // If moderate age difference (8-15 years), could be sibling or cousin
    if (ageDifference >= 8 && ageDifference <= 15) {
      console.log(`🔍 Detected sibling/cousin relationship (moderate age difference: ${ageDifference} years)`);
      return 'sibling';
    }
    
    console.log(`🔍 No specific relationship detected, using general association`);
    return 'general';
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
    transaction: any
  ): Promise<number> {
    const { FamilyTree } = await import('../family/model/family-tree.model');
    
    // Check if the user already has a card in this family
    const existingCard = await FamilyTree.findOne({
      where: { familyCode, userId },
      transaction
    });
    
    if (existingCard) {
      console.log(`🔧 User ${userId} already exists in family ${familyCode} with generation ${existingCard.generation}`);
      return existingCard.generation;
    }
    
    // Check if the partner already has a card in this family
    const partnerCard = await FamilyTree.findOne({
      where: { familyCode, userId: partnerUserId },
      transaction
    });
    
    if (partnerCard) {
      const partnerGeneration = partnerCard.generation || 0;
      let calculatedGeneration;
      
      switch (relationshipType) {
        case 'spouse':
        case 'sibling':
          // Same generation as partner
          calculatedGeneration = partnerGeneration;
          console.log(`🔧 ${relationshipType} relationship: using partner's generation ${calculatedGeneration}`);
          break;
        case 'parent-child':
          // Determine who is parent/child based on age or existing family structure
          calculatedGeneration = partnerGeneration - 1; // Default: user is parent (older generation)
          console.log(`🔧 Parent-child relationship: using generation ${calculatedGeneration} (parent of partner)`);
          break;
        default:
          calculatedGeneration = partnerGeneration;
          console.log(`🔧 General relationship: using partner's generation ${calculatedGeneration}`);
      }
      
      return calculatedGeneration;
    }
    
    // Find all existing family members to determine the appropriate generation
    const familyMembers = await FamilyTree.findAll({
      where: { familyCode },
      transaction
    });
    
    if (familyMembers.length === 0) {
      console.log(`🔧 No existing members in family ${familyCode}, using generation 0`);
      return 0;
    }
    
    // Calculate generation based on relationship type and existing family structure
    const generationCounts = {};
    familyMembers.forEach(member => {
      const gen = member.generation || 0;
      generationCounts[gen] = (generationCounts[gen] || 0) + 1;
    });
    
    // Find the most common generation (mode) among existing members
    const mostCommonGeneration = Object.keys(generationCounts)
      .reduce((a, b) => generationCounts[a] > generationCounts[b] ? a : b);
    
    let calculatedGeneration = parseInt(mostCommonGeneration);
    
    // Adjust generation based on relationship type
    switch (relationshipType) {
      case 'parent-child':
        // If adding as parent, use older generation (lower number)
        calculatedGeneration = calculatedGeneration - 1;
        console.log(`🔧 Parent-child: calculated generation ${calculatedGeneration} (parent level)`);
        break;
      case 'spouse':
      case 'sibling':
        // Same generation as most common
        console.log(`🔧 ${relationshipType}: using most common generation ${calculatedGeneration}`);
        break;
      default:
        console.log(`🔧 General relationship: using most common generation ${calculatedGeneration}`);
    }
    
    return calculatedGeneration;
  }
  
  /**
   * Create spouse relationship cards with proper personId cross-references
   */
  private async createSpouseCards(
    senderId: number, targetUserId: number,
    senderFamilyCode: string, targetFamilyCode: string,
    senderPersonId: number, targetPersonId: number,
    senderProfile: any, targetProfile: any,
    transaction: any
  ): Promise<void> {
    const { FamilyTree } = await import('../family/model/family-tree.model');
    
    console.log(`🔧 Creating spouse cards with proper cross-references`);
    console.log(`🔧 Sender ${senderId} (personId: ${senderPersonId} in ${senderFamilyCode}) -> Target family ${targetFamilyCode} (personId: ${targetPersonId})`);
    console.log(`🔧 Target ${targetUserId} (personId: ${targetPersonId} in ${targetFamilyCode}) -> Sender family ${senderFamilyCode} (personId: ${senderPersonId})`);
    
    // Calculate proper generations for both families, considering both users and relationship type
    const [senderGeneration, targetGeneration] = await Promise.all([
      this.calculateGeneration(senderFamilyCode, senderId, targetUserId, 'spouse', transaction),
      this.calculateGeneration(targetFamilyCode, targetUserId, senderId, 'spouse', transaction)
    ]);
    
    console.log(`🔧 Calculated generations - Sender: ${senderGeneration}, Target: ${targetGeneration}`);
    
    // Ensure both spouses are in the same generation level by using the same generation
    // Use the higher generation number to maintain family hierarchy
    const finalGeneration = Math.max(senderGeneration, targetGeneration);
    console.log(`🔧 Using final generation ${finalGeneration} for both spouse cards`);
    
    // Step 1: Create sender's card in target's family tree
    // Duplicate support: always create a fresh card for sender in target family
    const senderCardInTargetFamily = await FamilyTree.create({
        familyCode: targetFamilyCode,
        userId: senderId,
        personId: targetPersonId,
        generation: finalGeneration, // Use final matched generation
        parents: [],
        children: [],
        spouses: [], // Will be updated after target card is created
        siblings: []
      }, { transaction });
    console.log(`✅ Created sender card in target family`);
    
    // Step 2: Create target's card in sender's family tree
    // Duplicate support: always create a fresh card for target in sender family
    const targetCardInSenderFamily = await FamilyTree.create({
        familyCode: senderFamilyCode,
        userId: targetUserId,
        personId: senderPersonId,
        generation: finalGeneration, // Use final matched generation
        parents: [],
        children: [],
        spouses: [], // Will be updated after sender card is created
        siblings: []
      }, { transaction });
    console.log(`✅ Created target card in sender family`);
    
    // Step 3: Find or create the target's original card in their own family
    let targetOriginalCard = await FamilyTree.findOne({
      where: { familyCode: targetFamilyCode, userId: targetUserId },
      transaction
    });
    
    if (!targetOriginalCard) {
      // Create original card if it doesn't exist
      const targetOriginalPersonId = await this.getNextPersonId(targetFamilyCode, transaction);
      targetOriginalCard = await FamilyTree.create({
        familyCode: targetFamilyCode,
        userId: targetUserId,
        personId: targetOriginalPersonId,
        generation: 1,
        parents: [],
        children: [],
        spouses: [],
        siblings: []
      }, { transaction });
      console.log(`✅ Created target's original card in their own family`);
    }
    
    // Step 4: Find or create the sender's original card in their own family
    let senderOriginalCard = await FamilyTree.findOne({
      where: { familyCode: senderFamilyCode, userId: senderId },
      transaction
    });
    
    if (!senderOriginalCard) {
      // Create original card if it doesn't exist
      const senderOriginalPersonId = await this.getNextPersonId(senderFamilyCode, transaction);
      senderOriginalCard = await FamilyTree.create({
        familyCode: senderFamilyCode,
        userId: senderId,
        personId: senderOriginalPersonId,
        generation: 1,
        parents: [],
        children: [],
        spouses: [],
        siblings: []
      }, { transaction });
      console.log(`✅ Created sender's original card in their own family`);
    }
    
    // Step 5: Update spouse relationships with correct personId references
    // Sender's card in target family should reference target's original personId
    if (targetOriginalCard) {
      const currentSpouses = senderCardInTargetFamily.spouses || [];
      if (!currentSpouses.includes(targetOriginalCard.personId)) {
        await senderCardInTargetFamily.update({
          spouses: [...currentSpouses, targetOriginalCard.personId]
        }, { transaction });
        console.log(`✅ Updated sender card spouse reference to target's original personId: ${targetOriginalCard.personId}`);
      }
    }
    
    // Target's card in sender family should reference sender's original personId
    if (senderOriginalCard) {
      const currentSpouses = targetCardInSenderFamily.spouses || [];
      if (!currentSpouses.includes(senderOriginalCard.personId)) {
        await targetCardInSenderFamily.update({
          spouses: [...currentSpouses, senderOriginalCard.personId]
        }, { transaction });
        console.log(`✅ Updated target card spouse reference to sender's original personId: ${senderOriginalCard.personId}`);
      }
    }
    
    // Step 6: Update original cards to include cross-family spouse references
    if (senderOriginalCard && targetCardInSenderFamily) {
      const currentSpouses = Array.isArray(senderOriginalCard.spouses) ? senderOriginalCard.spouses : [];
      if (!currentSpouses.includes(targetCardInSenderFamily.personId)) {
        await senderOriginalCard.update({
          spouses: [...currentSpouses, targetCardInSenderFamily.personId]
        }, { transaction });
        console.log(`✅ Updated sender's original card (personId: ${senderOriginalCard.personId}) with cross-family spouse reference: ${targetCardInSenderFamily.personId}`);
      }
    }
    
    if (targetOriginalCard && senderCardInTargetFamily) {
      const currentSpouses = Array.isArray(targetOriginalCard.spouses) ? targetOriginalCard.spouses : [];
      if (!currentSpouses.includes(senderCardInTargetFamily.personId)) {
        await targetOriginalCard.update({
          spouses: [...currentSpouses, senderCardInTargetFamily.personId]
        }, { transaction });
        console.log(`✅ Updated target's original card (personId: ${targetOriginalCard.personId}) with cross-family spouse reference: ${senderCardInTargetFamily.personId}`);
      }
    }
    
    // Step 7: Reload and verify the updates
    await senderOriginalCard.reload({ transaction });
    await targetOriginalCard.reload({ transaction });
    await senderCardInTargetFamily.reload({ transaction });
    await targetCardInSenderFamily.reload({ transaction });
    
    console.log(`🔧 DEBUG: Final spouse arrays after reload:`);
    console.log(`🔧 DEBUG: Sender original card (${senderFamilyCode}) spouses: ${JSON.stringify(senderOriginalCard.spouses)}`);
    console.log(`🔧 DEBUG: Target original card (${targetFamilyCode}) spouses: ${JSON.stringify(targetOriginalCard.spouses)}`);
    console.log(`🔧 DEBUG: Sender card in target family spouses: ${JSON.stringify(senderCardInTargetFamily.spouses)}`);
    console.log(`🔧 DEBUG: Target card in sender family spouses: ${JSON.stringify(targetCardInSenderFamily.spouses)}`);
    
    console.log(`✅ Spouse cards created successfully with proper cross-references`);
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
        spouses: [], // Will be updated with proper cross-family personId references
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
        spouses: [], // Will be updated with proper cross-family personId references
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
          spouses: [], // Will be updated with proper cross-family personId references
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
          spouses: [], // Will be updated with proper cross-family personId references
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
