import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserService } from './user.service';

@Injectable()
export class UserAccountCleanupService {
  private readonly logger = new Logger(UserAccountCleanupService.name);
  private isRunning = false;

  constructor(private readonly userService: UserService) {}

  @Cron('0 2 * * *')
  async purgeExpiredDeletedUsers() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.logger.log('🔄 Running scheduled job: Purge deleted users past purgeAfter');
    try {
      const result = await this.userService.purgeExpiredDeletedUsers(50);
      this.logger.log(`✅ Purged ${Number(result?.purgedCount || 0)} deleted users`);
    } catch (error) {
      this.logger.error('❌ Error in user purge job:', error);
    } finally {
      this.isRunning = false;
    }
  }
}
