import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { EventRetentionService } from './event-retention.service';

@Injectable()
export class EventRetentionScheduler {
  private readonly logger = new Logger(EventRetentionScheduler.name);

  constructor(private readonly eventRetentionService: EventRetentionService) {
    this.logger.log('✅ EventRetentionScheduler initialized - daily purge job active');
  }

  @Cron('0 2 * * *')
  async purgeSoftDeletedEvents() {
    this.logger.log('🔄 Running scheduled job: Purge soft-deleted events older than 60 days');
    try {
      const result = await this.eventRetentionService.purgeSoftDeletedEventsOlderThan(60);
      if (result.success) {
        this.logger.log(`✅ Purged ${result.purgedCount} events`);
      }
    } catch (error) {
      this.logger.error('❌ Error in event purge job:', error);
    }
  }
}
