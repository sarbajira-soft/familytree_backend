import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { GalleryRetentionService } from './gallery-retention.service';

@Injectable()
export class GalleryRetentionScheduler {
  private readonly logger = new Logger(GalleryRetentionScheduler.name);

  constructor(private readonly galleryRetentionService: GalleryRetentionService) {
    this.logger.log('✅ GalleryRetentionScheduler initialized - daily purge job active');
  }

  /**
   * Purge soft-deleted galleries older than 60 days.
   * Runs daily at 02:00.
   */
  @Cron('0 2 * * *')
  async purgeSoftDeletedGalleries() {
    this.logger.log('🔄 Running scheduled job: Purge soft-deleted galleries older than 60 days');
    try {
      const result = await this.galleryRetentionService.purgeSoftDeletedGalleriesOlderThan(60);
      if (result.success) {
        this.logger.log(`✅ Purged ${result.purgedCount} galleries`);
      }
    } catch (error) {
      this.logger.error('❌ Error in gallery purge job:', error);
    }
  }
}
