import { Injectable } from '@nestjs/common';
import { UserProfile } from '../user/model/user-profile.model';
import { DashboardNotification } from './notification.model';
import { Op } from 'sequelize';
import {
  DashboardNotificationResponseDTO,
  NotificationStatsResponseDTO,
  CleanupResponseDTO,
  MarkReadResponseDTO,
  WeeklyNotificationResponseDTO,
} from './notification.dto';

@Injectable()
export class NotificationService {
  constructor() {}

  // New method to create event notifications for family members
  async createEventNotificationForFamily(
    familyCode: string,
    eventName: string,
    eventStartDate: string,
    eventDescription?: string,
    createdBy?: number,
  ): Promise<{ status: string; notificationsCreated: number }> {
    try {
      // Get all family members based on family code
      const familyMembers = await UserProfile.findAll({
        where: { familyCode },
        include: [
          {
            model: UserProfile.sequelize?.models.User,
            attributes: ['id', 'email', 'firstName', 'lastName'],
            required: true,
          },
        ],
        raw: false,
      });

      let notificationCount = 0;
      const eventDate = new Date(eventStartDate).toLocaleDateString();

      for (const memberProfile of familyMembers) {
        const member = memberProfile.user;
        if (!member) continue;

        // Skip the creator of the event (optional - remove this if you want creator to also get notification)
        if (createdBy && member.id === createdBy) continue;

        const message = eventDescription
          ? `🎯 New Event: ${eventName}\n📅 Date: ${eventDate}\n📝 ${eventDescription}`
          : `🎯 New Event: ${eventName}\n📅 Date: ${eventDate}`;

        try {
          await DashboardNotification.create({
            userId: member.id,
            message,
            notificationType: 'reminder',
          });
          notificationCount++;
        } catch (error) {
          console.error(
            `Failed to create event notification for user ${member.id}:`,
            error,
          );
        }
      }

      return {
        status: 'Event notifications created successfully',
        notificationsCreated: notificationCount,
      };
    } catch (error) {
      console.error('Error creating event notifications for family:', error);
      throw new Error('Failed to create event notifications');
    }
  }

  // Modified method to create push notifications instead of emails
  async sendBirthdayNotifications(): Promise<NotificationStatsResponseDTO> {
    try {
      const now = new Date();
      const todayMonth = now.getMonth() + 1;
      const todayDate = now.getDate();

      // Get all users with their birth dates
      const users = await UserProfile.findAll({
        attributes: ['id', 'dob', 'familyCode', 'userId', 'fatherName', 'firstName', 'lastName'],
        include: [
          {
            model: UserProfile.sequelize?.models.User,
            attributes: ['id', 'email', 'firstName', 'lastName'],
            required: true,
          },
        ],
        raw: false,
      });

      let notificationCount = 0;
      const processedUsers = new Set();

      for (const userProfile of users) {
        if (!userProfile.dob) continue;

        const user = userProfile.user;
        if (!user) continue;

        // Create display name with user name and father name
        const firstName = userProfile.firstName || '';
        const lastName = userProfile.lastName || '';
        let userName = `${firstName} ${lastName}`.trim();

        if (!userName) {
          const emailUsername = user.email.split('@')[0];
          userName =
            emailUsername.charAt(0).toUpperCase() + emailUsername.slice(1);
        }

        const fatherName = userProfile.fatherName || 'Not specified';
        const displayName = `${userName} (S/o ${fatherName})`;

        const dob = new Date(userProfile.dob);
        const birthDate = new Date(
          now.getFullYear(),
          dob.getMonth(),
          dob.getDate(),
        );

        if (birthDate < now) {
          birthDate.setFullYear(now.getFullYear() + 1);
        }

        const diffTime = birthDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        const isBirthdayIn7Days = diffDays === 7;
        const isBirthdayToday =
          dob.getMonth() + 1 === todayMonth && dob.getDate() === todayDate;

        if (isBirthdayIn7Days || isBirthdayToday) {
          // Find family members (excluding the birthday person)
          const familyMembers = users.filter(
            (u) =>
              u.familyCode === userProfile.familyCode &&
              u.userId !== userProfile.userId &&
              u.user,
          );

          for (const memberProfile of familyMembers) {
            const member = memberProfile.user;

            const message = isBirthdayToday
              ? `🎉 Today is ${displayName}'s birthday! Don't forget to wish them a happy birthday! 🎂`
              : `📅 ${displayName}'s birthday is coming up in 7 days (${birthDate.toLocaleDateString()})! 🎈`;

            // Create push notification in dashboard
            try {
              await DashboardNotification.create({
                userId: member.id,
                message,
                notificationType: 'birthday',
              });
              notificationCount++;
            } catch (error) {
              console.error(
                `Failed to create dashboard notification for user ${member.id}:`,
                error,
              );
            }
          }
        }

        processedUsers.add(userProfile.userId);
      }

      return {
        status: 'Push notifications created successfully',
        emailsSent: 0, // No emails sent anymore
        dashboardNotifications: notificationCount,
        usersProcessed: processedUsers.size,
      };
    } catch (error) {
      console.error('Error in sendBirthdayNotifications:', error);
      throw new Error('Failed to process birthday notifications');
    }
  }

  // New method for weekly notifications
  async sendWeeklyNotifications(): Promise<WeeklyNotificationResponseDTO> {
    try {
      const now = new Date();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Get all users with their birth dates
      const users = await UserProfile.findAll({
        attributes: ['id', 'dob', 'familyCode', 'userId', 'fatherName', 'firstName', 'lastName'],
        include: [
          {
            model: UserProfile.sequelize?.models.User,
            attributes: ['id', 'email', 'firstName', 'lastName'],
            required: true,
          },
        ],
        raw: false,
      });

      const weeklyUpdates: Record<string, string[]> = {};
      let notificationCount = 0;

      // Process upcoming birthdays in the next week
      for (const userProfile of users) {
        if (!userProfile.dob) continue;

        const user = userProfile.user;
        if (!user) continue;

        const firstName = userProfile.firstName || '';
        const lastName = userProfile.lastName || '';
        let userName = `${firstName} ${lastName}`.trim();

        if (!userName) {
          const emailUsername = user.email.split('@')[0];
          userName =
            emailUsername.charAt(0).toUpperCase() + emailUsername.slice(1);
        }

        const fatherName = userProfile.fatherName || 'Not specified';
        const displayName = `${userName} (S/o ${fatherName})`;

        const dob = new Date(userProfile.dob);
        const birthDate = new Date(
          now.getFullYear(),
          dob.getMonth(),
          dob.getDate(),
        );

        if (birthDate < now) {
          birthDate.setFullYear(now.getFullYear() + 1);
        }

        // Check if birthday is within the next week
        if (birthDate >= now && birthDate <= nextWeek) {
          const familyMembers = users.filter(
            (u) =>
              u.familyCode === userProfile.familyCode &&
              u.userId !== userProfile.userId &&
              u.user,
          );

          for (const memberProfile of familyMembers) {
            const familyCode = memberProfile.familyCode;

            if (!weeklyUpdates[familyCode]) {
              weeklyUpdates[familyCode] = [];
            }

            const daysDiff = Math.ceil(
              (birthDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
            );
            const message =
              daysDiff === 0
                ? `🎉 Today is ${displayName}'s birthday!`
                : `📅 ${displayName}'s birthday is in ${daysDiff} days (${birthDate.toLocaleDateString()})`;

            weeklyUpdates[familyCode].push(message);
          }
        }
      }

      // Create weekly summary notifications
      for (const [familyCode, messages] of Object.entries(weeklyUpdates)) {
        if (messages.length === 0) continue;

        // Get all family members
        const familyMembers = users.filter((u) => u.familyCode === familyCode);

        for (const memberProfile of familyMembers) {
          const member = memberProfile.user;
          if (!member) continue;

          const weeklyMessage = `📬 Weekly Family Update:\n\n${messages.join('\n')}\n\n🎈 Don't forget to celebrate together!`;

          try {
            await DashboardNotification.create({
              userId: member.id,
              message: weeklyMessage,
              notificationType: 'family',
            });
            notificationCount++;
          } catch (error) {
            console.error(
              `Failed to create weekly notification for user ${member.id}:`,
              error,
            );
          }
        }
      }

      return {
        status: 'Weekly notifications created successfully',
        notificationsCreated: notificationCount,
        familiesProcessed: Object.keys(weeklyUpdates).length,
        weekStartDate: now.toISOString(),
        weekEndDate: nextWeek.toISOString(),
      };
    } catch (error) {
      console.error('Error in sendWeeklyNotifications:', error);
      throw new Error('Failed to process weekly notifications');
    }
  }

  // Method to create event notifications
  async createEventNotification(
    userId: number,
    eventTitle: string,
    eventDate: Date,
    eventDescription?: string,
  ): Promise<{ status: string; notificationId: number }> {
    try {
      const message = eventDescription
        ? `🎯 New Event: ${eventTitle}\n📅 Date: ${eventDate.toLocaleDateString()}\n📝 ${eventDescription}`
        : `🎯 New Event: ${eventTitle}\n📅 Date: ${eventDate.toLocaleDateString()}`;

      const notification = await DashboardNotification.create({
        userId,
        message,
        notificationType: 'reminder',
      });

      return {
        status: 'Event notification created successfully',
        notificationId: notification.id,
      };
    } catch (error) {
      console.error('Failed to create event notification:', error);
      throw new Error('Failed to create event notification');
    }
  }

  // Method to create system notifications
  async createSystemNotification(
    userIds: number[],
    message: string,
  ): Promise<{ status: string; notificationsCreated: number }> {
    try {
      let createdCount = 0;

      for (const userId of userIds) {
        try {
          await DashboardNotification.create({
            userId,
            message: `🔔 System Update: ${message}`,
            notificationType: 'system',
          });
          createdCount++;
        } catch (error) {
          console.error(
            `Failed to create system notification for user ${userId}:`,
            error,
          );
        }
      }

      return {
        status: 'System notifications created successfully',
        notificationsCreated: createdCount,
      };
    } catch (error) {
      console.error('Failed to create system notifications:', error);
      throw new Error('Failed to create system notifications');
    }
  }

  async getDashboardNotifications(
    userId: number,
    limit: number = 10,
  ): Promise<DashboardNotificationResponseDTO[]> {
    try {
      const notifications = await DashboardNotification.findAll({
        where: { userId },
        order: [['createdAt', 'DESC']],
        limit,
        raw: false,
      });

      return notifications.map((notification) => ({
        id: notification.id,
        userId: notification.userId,
        message: notification.message,
        read: notification.read,
        notificationType: notification.notificationType,
        createdAt: notification.createdAt,
        updatedAt: notification.updatedAt,
      }));
    } catch (error) {
      console.error(
        `Failed to get dashboard notifications for user ${userId}:`,
        error,
      );
      throw new Error('Failed to retrieve notifications');
    }
  }

  async markNotificationAsRead(
    notificationId: number,
    userId: number,
  ): Promise<MarkReadResponseDTO> {
    try {
      const notification = await DashboardNotification.findOne({
        where: { id: notificationId, userId },
      });

      if (!notification) {
        throw new Error('Notification not found');
      }

      await notification.update({ read: true });

      return { status: 'Notification marked as read' };
    } catch (error) {
      console.error(`Failed to mark notification as read:`, error);
      throw new Error('Failed to update notification');
    }
  }

  async cleanupOldNotifications(
    daysOld: number = 30,
  ): Promise<CleanupResponseDTO> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const deletedCount = await DashboardNotification.destroy({
        where: {
          createdAt: {
            [Op.lt]: cutoffDate,
          },
        },
      });

      return {
        status: 'Cleanup completed',
        deletedNotifications: deletedCount,
      };
    } catch (error) {
      console.error('Failed to cleanup old notifications:', error);
      throw new Error('Failed to cleanup notifications');
    }
  }
}
