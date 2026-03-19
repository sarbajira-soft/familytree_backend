import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { CommentRetentionService } from './comment-retention.service';

@Injectable()
export class CommentRetentionScheduler {
  private readonly logger = new Logger(CommentRetentionScheduler.name);

  constructor(private readonly commentRetentionService: CommentRetentionService) {
    this.logger.log('✅ CommentRetentionScheduler initialized - daily purge job active');
  }

  @Cron('0 2 * * *')
  async purgeSoftDeletedComments() {
    this.logger.log('🔄 Running scheduled job: Purge soft-deleted comments older than 60 days');
    try {
      const result = await this.commentRetentionService.purgeSoftDeletedCommentsOlderThan(60);
      if (result.success) {
        this.logger.log(`✅ Purged ${result.purgedCount} comments`);
      }
    } catch (error) {
      this.logger.error('❌ Error in comments purge job:', error);
    }
  }
}
