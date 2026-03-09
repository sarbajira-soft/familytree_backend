import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PostRetentionService } from './post-retention.service';

@Injectable()
export class PostRetentionScheduler {
  private readonly logger = new Logger(PostRetentionScheduler.name);

  constructor(private readonly postRetentionService: PostRetentionService) {
    this.logger.log('✅ PostRetentionScheduler initialized - daily purge job active');
  }

  /**
   * Purge soft-deleted posts older than 60 days.
   * Runs daily at 02:00.
   */
  @Cron('0 2 * * *')
  async purgeSoftDeletedPosts() {
    this.logger.log('🔄 Running scheduled job: Purge soft-deleted posts older than 60 days');
    try {
      const result = await this.postRetentionService.purgeSoftDeletedPostsOlderThan(60);
      if (result.success) {
        this.logger.log(`✅ Purged ${result.purgedCount} posts`);
      }
    } catch (error) {
      this.logger.error('❌ Error in post purge job:', error);
    }
  }
}
