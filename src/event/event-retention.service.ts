import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { Event } from './model/event.model';
import { EventImage } from './model/event-image.model';

@Injectable()
export class EventRetentionService {
  private readonly logger = new Logger(EventRetentionService.name);

  constructor(
    @InjectModel(Event)
    private readonly eventModel: typeof Event,
    @InjectModel(EventImage)
    private readonly eventImageModel: typeof EventImage,
  ) {}

  async purgeSoftDeletedEventsOlderThan(days: number) {
    const safeDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 60;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - safeDays);

    const events = await this.eventModel.findAll({
      where: {
        deletedAt: {
          [Op.ne]: null,
          [Op.lt]: cutoff,
        },
      } as any,
      attributes: ['id'] as any,
    });

    const eventIds = events
      .map((e: any) => Number(typeof e?.get === 'function' ? e.get('id') : e?.id))
      .filter((v) => Number.isFinite(v) && v > 0);

    if (eventIds.length === 0) {
      return {
        success: true,
        purgedCount: 0,
        message: 'No soft-deleted events eligible for purge',
      };
    }

    await this.eventImageModel.destroy({ where: { eventId: { [Op.in]: eventIds } } as any });
    const purgedCount = await this.eventModel.destroy({ where: { id: { [Op.in]: eventIds } } as any });

    this.logger.log(`✅ Purged ${purgedCount} events (deleted > ${safeDays} days)`);

    return {
      success: true,
      purgedCount,
      message: `Purged ${purgedCount} events`,
    };
  }
}
