import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationService } from './notification.service';

@Injectable()
export class NotificationScheduler {
  private readonly logger = new Logger(NotificationScheduler.name);

  constructor(
    private notificationService: NotificationService,
  ) {
    this.logger.log('✅ NotificationScheduler initialized - Auto-expiry job active');
  }

  /**
   * Auto-expire family association requests older than 15 days
   * Runs every day at midnight (00:00)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleExpireOldRequests() {
    this.logger.log('🔄 Running scheduled job: Expire old association requests');
    try {
      const result = await this.notificationService.expireOldAssociationRequests();
      if (result.success) {
        this.logger.log(`✅ Expired ${result.expiredCount} old association requests`);
      } else {
        this.logger.error('❌ Failed to expire old requests:', result.error);
      }
    } catch (error) {
      this.logger.error('❌ Error in scheduled expiry job:', error);
    }
  }

  /**
   * Manual trigger for testing - can be called via API endpoint
   */
  async triggerExpireOldRequests() {
    this.logger.log('🔧 Manual trigger: Expire old association requests');
    return await this.notificationService.expireOldAssociationRequests();
  }
}
