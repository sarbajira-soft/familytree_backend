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
        const targetUserId = userId; // The user who is responding to the request
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
            
            // Update associations bidirectionally
            const [updatedSender, updatedTarget] = await Promise.all([
              // Add target's family code to sender's associated families
              this.updateUserFamilyAssociations(
                senderId, 
                targetFamilyCode,
                senderFamilyCode
              ),
              // Add sender's family code to target's associated families
              this.updateUserFamilyAssociations(
                targetUserId, 
                senderFamilyCode,
                targetFamilyCode
              )
            ]);
            
            console.log(`📊 Association results: sender=${updatedSender}, target=${updatedTarget}`);
            
            // Note: We only update associatedFamilyCodes, not create cards in each other's trees
            // This maintains proper family tree structure and alignment
            console.log(`✅ Family association completed - users can now navigate via eye icon`);
            
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
                  requestType: 'family_association_accepted'
                },
                userIds: [senderId],
              },
              targetUserId,
            );
            
            return { 
              success: true, 
              message: 'Family association created successfully',
              data: {
                originalRequesterId: senderId, // The user who originally sent the request
                acceptingUserId: targetUserId, // The user who accepted the request
                requesterFamilyCode: senderFamilyCode,
                accepterFamilyCode: targetFamilyCode,
                bidirectionalCardsCreated: false
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
}
