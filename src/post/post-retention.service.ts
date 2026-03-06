import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { Post } from './model/post.model';
import { PostLike } from './model/post-like.model';
import { PostComment } from './model/post-comment.model';

@Injectable()
export class PostRetentionService {
  private readonly logger = new Logger(PostRetentionService.name);

  constructor(
    @InjectModel(Post)
    private readonly postModel: typeof Post,
    @InjectModel(PostLike)
    private readonly postLikeModel: typeof PostLike,
    @InjectModel(PostComment)
    private readonly postCommentModel: typeof PostComment,
  ) {}

  async purgeSoftDeletedPostsOlderThan(days: number) {
    const safeDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 60;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - safeDays);

    const posts = await this.postModel.findAll({
      where: {
        deletedAt: {
          [Op.ne]: null,
          [Op.lt]: cutoff,
        },
      } as any,
      attributes: ['id'] as any,
    });

    const postIds = posts
      .map((p: any) => Number(typeof p?.get === 'function' ? p.get('id') : p?.id))
      .filter((v) => Number.isFinite(v) && v > 0);

    if (postIds.length === 0) {
      return {
        success: true,
        purgedCount: 0,
        message: 'No soft-deleted posts eligible for purge',
      };
    }

    await this.postLikeModel.destroy({ where: { postId: { [Op.in]: postIds } } });
    await this.postCommentModel.destroy({ where: { postId: { [Op.in]: postIds } } });
    const purgedCount = await this.postModel.destroy({ where: { id: { [Op.in]: postIds } } });

    this.logger.log(`✅ Purged ${purgedCount} posts (deleted > ${safeDays} days)`);

    return {
      success: true,
      purgedCount,
      message: `Purged ${purgedCount} posts`,
    };
  }
}
