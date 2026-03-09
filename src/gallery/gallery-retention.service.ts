import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { Gallery } from './model/gallery.model';
import { GalleryAlbum } from './model/gallery-album.model';
import { GalleryLike } from './model/gallery-like.model';
import { GalleryComment } from './model/gallery-comment.model';

@Injectable()
export class GalleryRetentionService {
  private readonly logger = new Logger(GalleryRetentionService.name);

  constructor(
    @InjectModel(Gallery)
    private readonly galleryModel: typeof Gallery,
    @InjectModel(GalleryAlbum)
    private readonly galleryAlbumModel: typeof GalleryAlbum,
    @InjectModel(GalleryLike)
    private readonly galleryLikeModel: typeof GalleryLike,
    @InjectModel(GalleryComment)
    private readonly galleryCommentModel: typeof GalleryComment,
  ) {}

  async purgeSoftDeletedGalleriesOlderThan(days: number) {
    const safeDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 60;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - safeDays);

    const galleries = await this.galleryModel.findAll({
      where: {
        deletedAt: {
          [Op.ne]: null,
          [Op.lt]: cutoff,
        },
      } as any,
      attributes: ['id'] as any,
    });

    const galleryIds = galleries
      .map((g: any) => Number(typeof g?.get === 'function' ? g.get('id') : g?.id))
      .filter((v) => Number.isFinite(v) && v > 0);

    if (galleryIds.length === 0) {
      return {
        success: true,
        purgedCount: 0,
        message: 'No soft-deleted galleries eligible for purge',
      };
    }

    await this.galleryLikeModel.destroy({ where: { galleryId: { [Op.in]: galleryIds } } as any });
    await this.galleryCommentModel.destroy({ where: { galleryId: { [Op.in]: galleryIds } } as any });
    await this.galleryAlbumModel.destroy({ where: { galleryId: { [Op.in]: galleryIds } } as any });
    const purgedCount = await this.galleryModel.destroy({ where: { id: { [Op.in]: galleryIds } } as any });

    this.logger.log(`✅ Purged ${purgedCount} galleries (deleted > ${safeDays} days)`);

    return {
      success: true,
      purgedCount,
      message: `Purged ${purgedCount} galleries`,
    };
  }
}
