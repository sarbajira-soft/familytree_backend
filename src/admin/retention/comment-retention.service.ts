import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { PostComment } from '../../post/model/post-comment.model';
import { GalleryComment } from '../../gallery/model/gallery-comment.model';

@Injectable()
export class CommentRetentionService {
  private readonly logger = new Logger(CommentRetentionService.name);

  constructor(
    @InjectModel(PostComment)
    private readonly postCommentModel: typeof PostComment,
    @InjectModel(GalleryComment)
    private readonly galleryCommentModel: typeof GalleryComment,
  ) {}

  async purgeSoftDeletedCommentsOlderThan(days: number) {
    const safeDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 60;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - safeDays);

    const [purgedPostComments, purgedGalleryComments] = await Promise.all([
      this.postCommentModel.destroy({
        where: {
          deletedAt: {
            [Op.ne]: null,
            [Op.lt]: cutoff,
          },
        } as any,
      }),
      this.galleryCommentModel.destroy({
        where: {
          deletedAt: {
            [Op.ne]: null,
            [Op.lt]: cutoff,
          },
        } as any,
      }),
    ]);

    const total = Number(purgedPostComments || 0) + Number(purgedGalleryComments || 0);

    this.logger.log(
      `✅ Purged ${total} comments (post=${purgedPostComments}, gallery=${purgedGalleryComments}) (deleted > ${safeDays} days)`,
    );

    return {
      success: true,
      purgedPostComments,
      purgedGalleryComments,
      purgedCount: total,
      message: `Purged ${total} comments`,
    };
  }
}
