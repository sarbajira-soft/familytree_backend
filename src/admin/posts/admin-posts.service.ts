import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { Post } from '../../post/model/post.model';
import { PostLike } from '../../post/model/post-like.model';
import { PostComment } from '../../post/model/post-comment.model';
import { User } from '../../user/model/user.model';
import { UserProfile } from '../../user/model/user-profile.model';
import { UploadService } from '../../uploads/upload.service';
import { AdminAuditLogService } from '../admin-audit-log.service';
import { UpdateAdminPostDto } from './dto/update-admin-post.dto';

@Injectable()
export class AdminPostsService {
  constructor(
    @InjectModel(Post)
    private readonly postModel: typeof Post,
    @InjectModel(PostLike)
    private readonly postLikeModel: typeof PostLike,
    @InjectModel(PostComment)
    private readonly postCommentModel: typeof PostComment,
    @InjectModel(User)
    private readonly userModel: typeof User,
    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,
    private readonly uploadService: UploadService,
    private readonly adminAuditLogService: AdminAuditLogService,
  ) {}

  private assertActor(actor: any) {
    if (!actor?.adminId) {
      throw new ForbiddenException('No admin data in request');
    }
  }

  async getPostsStats(actor: any) {
    this.assertActor(actor);

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const last7Days = new Date(now);
    last7Days.setDate(last7Days.getDate() - 7);

    const [
      totalPosts,
      totalActivePosts,
      totalInactivePosts,
      totalDeletedPosts,
      postsToday,
      totalLikes,
      totalComments,
      mediaPosts,
      textOnlyPosts,
      activeUsersLast7Days,
      topLikedAgg,
      topCommentedAgg,
    ] = await Promise.all([
      this.postModel.count(),
      this.postModel.count({ where: { status: 1 } }),
      this.postModel.count({ where: { status: 0 } }),
      this.postModel.count({ where: { deletedAt: { [Op.ne]: null } } }),
      this.postModel.count({ where: { createdAt: { [Op.between]: [startOfToday, endOfToday] } } }),
      this.postLikeModel.count(),
      this.postCommentModel.count({ where: { deletedAt: null } as any }),
      this.postModel.count({
        where: {
          status: 1,
          [Op.or]: [
            { postImage: { [Op.and]: [{ [Op.ne]: null }, { [Op.not]: '' }] } },
            { postVideo: { [Op.and]: [{ [Op.ne]: null }, { [Op.not]: '' }] } },
          ],
        },
      }),
      this.postModel.count({
        where: {
          status: 1,
          [Op.and]: [
            { [Op.or]: [{ postImage: null }, { postImage: '' }] },
            { [Op.or]: [{ postVideo: null }, { postVideo: '' }] },
          ],
        },
      }),
      this.postModel.count({
        where: { status: 1, createdAt: { [Op.gte]: last7Days } },
        distinct: true,
        col: 'createdBy' as any,
      }),
      this.postLikeModel.findAll({
        attributes: ['postId', [this.postLikeModel.sequelize.fn('COUNT', this.postLikeModel.sequelize.col('id')), 'likeCount']] as any,
        group: ['postId'] as any,
        order: [[this.postLikeModel.sequelize.fn('COUNT', this.postLikeModel.sequelize.col('id')), 'DESC']] as any,
        limit: 1,
        raw: true,
      }),
      this.postCommentModel.findAll({
        attributes: ['postId', [this.postCommentModel.sequelize.fn('COUNT', this.postCommentModel.sequelize.col('id')), 'commentCount']] as any,
        where: { deletedAt: null } as any,
        group: ['postId'] as any,
        order: [[this.postCommentModel.sequelize.fn('COUNT', this.postCommentModel.sequelize.col('id')), 'DESC']] as any,
        limit: 1,
        raw: true,
      }),
    ]);

    const avgLikesPerPost = totalPosts > 0 ? totalLikes / totalPosts : 0;
    const avgCommentsPerPost = totalPosts > 0 ? totalComments / totalPosts : 0;

    const topLikedPostId = Array.isArray(topLikedAgg) && topLikedAgg.length > 0 ? Number((topLikedAgg[0] as any)?.postId) : null;
    const topLikedCount = Array.isArray(topLikedAgg) && topLikedAgg.length > 0 ? Number((topLikedAgg[0] as any)?.likeCount || 0) : 0;

    const topCommentedPostId =
      Array.isArray(topCommentedAgg) && topCommentedAgg.length > 0 ? Number((topCommentedAgg[0] as any)?.postId) : null;
    const topCommentedCount =
      Array.isArray(topCommentedAgg) && topCommentedAgg.length > 0 ? Number((topCommentedAgg[0] as any)?.commentCount || 0) : 0;

    const [topLikedPostRaw, topCommentedPostRaw] = await Promise.all([
      topLikedPostId
        ? this.postModel.findOne({
            where: { id: topLikedPostId },
            attributes: ['id', 'caption', 'postImage', 'postVideo', 'privacy', 'createdBy', 'createdAt', 'status'] as any,
          })
        : null,
      topCommentedPostId
        ? this.postModel.findOne({
            where: { id: topCommentedPostId },
            attributes: ['id', 'caption', 'postImage', 'postVideo', 'privacy', 'createdBy', 'createdAt', 'status'] as any,
          })
        : null,
    ]);

    const topCreatorIds = [
      Number((topLikedPostRaw as any)?.createdBy),
      Number((topCommentedPostRaw as any)?.createdBy),
    ].filter((v) => Number.isFinite(v) && v > 0);

    const creatorsRaw =
      topCreatorIds.length > 0
        ? await this.userModel.findAll({
            where: { id: { [Op.in]: Array.from(new Set(topCreatorIds)) } },
            attributes: ['id', 'email'] as any,
            include: [
              {
                model: this.userProfileModel,
                as: 'userProfile',
                required: false,
                attributes: ['firstName', 'lastName', 'profile'] as any,
              },
            ],
          })
        : [];

    const creatorsById = new Map<number, any>();
    for (const u of creatorsRaw || []) {
      const json: any = typeof (u as any)?.toJSON === 'function' ? (u as any).toJSON() : u;
      creatorsById.set(Number(json?.id), {
        id: json?.id,
        email: json?.email,
        userProfile: json?.userProfile
          ? {
              ...json.userProfile,
              profile: json.userProfile.profile
                ? this.uploadService.getFileUrl(String(json.userProfile.profile), 'profile')
                : null,
            }
          : json?.userProfile,
      });
    }

    function formatPost(postRaw: any) {
      if (!postRaw) return null;
      const json: any = typeof postRaw?.toJSON === 'function' ? postRaw.toJSON() : postRaw;
      return {
        ...json,
        postImage: json?.postImage ? this.uploadService.getFileUrl(String(json.postImage), 'posts') : null,
        postVideo: json?.postVideo ? this.uploadService.getFileUrl(String(json.postVideo), 'posts') : null,
      };
    }

    const topLikedPost = formatPost.call(this, topLikedPostRaw);
    const topCommentedPost = formatPost.call(this, topCommentedPostRaw);

    return {
      message: 'Posts stats fetched successfully',
      data: {
        totalPosts,
        totalActivePosts,
        totalInactivePosts,
        postsToday,
        totalLikes,
        totalComments,
        avgLikesPerPost,
        avgCommentsPerPost,
        mediaPosts,
        textOnlyPosts,
        activeUsersLast7Days,
        reportedPosts: 0,
        deletedPosts: totalDeletedPosts,
        topLikedPost: topLikedPost
          ? {
              post: topLikedPost,
              likeCount: topLikedCount,
              creator: creatorsById.get(Number(topLikedPost?.createdBy)) || null,
            }
          : null,
        topCommentedPost: topCommentedPost
          ? {
              post: topCommentedPost,
              commentCount: topCommentedCount,
              creator: creatorsById.get(Number(topCommentedPost?.createdBy)) || null,
            }
          : null,
      },
    };
  }

  private normalizeId(value: any, label: string) {
    const id = Number(value);
    if (!Number.isFinite(id) || Number.isNaN(id) || id <= 0) {
      throw new NotFoundException(`${label} not found`);
    }
    return id;
  }

  async listPosts(
    actor: any,
    params?: {
      page?: number;
      limit?: number;
      q?: string;
      status?: string;
      privacy?: string;
      media?: string;
      userId?: number;
      from?: string;
      to?: string;
    },
  ) {
    this.assertActor(actor);

    const page = Math.max(1, Number(params?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params?.limit || 25)));
    const offset = (page - 1) * limit;

    const q = String(params?.q || '').trim();
    const statusFilter = String(params?.status || '').trim().toLowerCase();
    const privacy = String(params?.privacy || '').trim().toLowerCase();
    const media = String(params?.media || '').trim().toLowerCase();
    const userId = params?.userId;
    const from = String(params?.from || '').trim();
    const to = String(params?.to || '').trim();

    // Admin default: include both active + deleted posts.
    // Filter:
    // - status=active  => deletedAt IS NULL
    // - status=deleted => deletedAt IS NOT NULL
    // - status=all (or empty) => no deletedAt filter
    const where: any = {};

    if (statusFilter === 'active') {
      where.deletedAt = null;
    } else if (statusFilter === 'deleted') {
      where.deletedAt = { [Op.ne]: null };
    }

    if (Number.isFinite(Number(userId)) && Number(userId) > 0) {
      where.createdBy = Number(userId);
    }

    if (q) {
      const numericId = Number(q);
      const or: any[] = [{ caption: { [Op.iLike]: `%${q}%` } }];
      if (!Number.isNaN(numericId) && Number.isFinite(numericId)) {
        or.unshift({ id: numericId });
      }
      where[Op.or] = or;
    }

    if (privacy && ['public', 'private', 'family'].includes(privacy)) {
      where.privacy = privacy;
    }

    if (media) {
      if (media === 'image') {
        where.postImage = { [Op.and]: [{ [Op.ne]: null }, { [Op.not]: '' }] };
      } else if (media === 'video') {
        where.postVideo = { [Op.and]: [{ [Op.ne]: null }, { [Op.not]: '' }] };
      } else if (media === 'none') {
        where[Op.and] = [
          ...(Array.isArray(where[Op.and]) ? where[Op.and] : []),
          {
            [Op.or]: [{ postImage: null }, { postImage: '' }],
          },
          {
            [Op.or]: [{ postVideo: null }, { postVideo: '' }],
          },
        ];
      }
    }

    if (from || to) {
      const createdAt: any = {};
      if (from) {
        const fromDate = new Date(from);
        if (!Number.isNaN(fromDate.getTime())) {
          createdAt[Op.gte] = fromDate;
        }
      }
      if (to) {
        const toDate = new Date(to);
        if (!Number.isNaN(toDate.getTime())) {
          createdAt[Op.lte] = toDate;
        }
      }
      if (Object.keys(createdAt).length > 0) {
        where.createdAt = createdAt;
      }
    }

    const { rows, count } = await this.postModel.findAndCountAll({
      where,
      attributes: ['id', 'caption', 'postImage', 'postVideo', 'privacy', 'familyCode', 'status', 'createdBy', 'createdAt', 'deletedAt', 'deletedByUserId', 'deletedByAdminId'] as any,
      order: [['createdAt', 'DESC']] as any,
      limit,
      offset,
    });

    const data = rows.map((r: any) => {
      const json = typeof r?.toJSON === 'function' ? r.toJSON() : r;
      return {
        ...json,
        postImage: json?.postImage ? this.uploadService.getFileUrl(String(json.postImage), 'posts') : null,
        postVideo: json?.postVideo ? this.uploadService.getFileUrl(String(json.postVideo), 'posts') : null,
      };
    });

    return {
      message: 'Posts fetched successfully',
      data,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit) || 1,
      },
    };
  }

  async getPostById(actor: any, postId: number) {
    this.assertActor(actor);
    const id = this.normalizeId(postId, 'Post');

    const post = await this.postModel.findOne({
      where: { id },
      attributes: [
        'id',
        'caption',
        'postImage',
        'postVideo',
        'privacy',
        'familyCode',
        'status',
        'createdBy',
        'createdAt',
        'updatedAt',
        'deletedAt',
        'deletedByUserId',
        'deletedByAdminId',
      ] as any,
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const postJson: any = typeof (post as any)?.toJSON === 'function' ? (post as any).toJSON() : post;
    const createdBy = Number(postJson?.createdBy);

    const postWithUrls = {
      ...postJson,
      postImage: postJson?.postImage ? this.uploadService.getFileUrl(String(postJson.postImage), 'posts') : null,
      postVideo: postJson?.postVideo ? this.uploadService.getFileUrl(String(postJson.postVideo), 'posts') : null,
    };

    const [likeCount, commentCount] = await Promise.all([
      this.postLikeModel.count({ where: { postId: id } }),
      this.postCommentModel.count({ where: { postId: id, deletedAt: null } as any }),
    ]);

    const creatorRaw = Number.isFinite(createdBy)
      ? await this.userModel.findOne({
          where: { id: createdBy },
          attributes: ['id', 'email', 'countryCode', 'mobile', 'status', 'role', 'isAppUser'] as any,
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
              required: false,
              attributes: ['firstName', 'lastName', 'profile', 'familyCode', 'gender'] as any,
            },
          ],
        })
      : null;

    const creatorJson: any = creatorRaw && typeof (creatorRaw as any).toJSON === 'function' ? (creatorRaw as any).toJSON() : creatorRaw;
    const creator = creatorJson
      ? {
          ...creatorJson,
          userProfile: creatorJson?.userProfile
            ? {
                ...creatorJson.userProfile,
                profile: creatorJson.userProfile.profile
                  ? this.uploadService.getFileUrl(String(creatorJson.userProfile.profile), 'profile')
                  : null,
              }
            : creatorJson?.userProfile,
        }
      : null;

    return {
      message: 'Post fetched successfully',
      data: {
        ...postWithUrls,
        likeCount,
        commentCount,
      },
      creator,
    };
  }

  async updatePost(actor: any, postId: number, dto: UpdateAdminPostDto, file?: Express.Multer.File | null) {
    this.assertActor(actor);
    const id = this.normalizeId(postId, 'Post');

    const post = await this.postModel.findOne({ where: { id } as any });
    if (!post) throw new NotFoundException('Post not found');

    if ((post as any).deletedAt) {
      throw new ForbiddenException('Cannot update a deleted post');
    }

    const patch: any = {};
    if (dto?.caption !== undefined) patch.caption = String(dto.caption ?? '').trim();

    const removeImage = String((dto as any)?.removeImage || '').toLowerCase() === 'true';
    const hasNewImage = Boolean(file);

    if (removeImage && hasNewImage) {
      throw new BadRequestException('Cannot upload a new image and remove image at the same time');
    }

    if (removeImage) {
      patch.postImage = null;
    }

    if (hasNewImage) {
      const oldImage = (post as any)?.postImage ? String((post as any).postImage) : null;
      if (oldImage) {
        try {
          await this.uploadService.deleteFile(oldImage, 'posts');
        } catch (_) {
          // ignore
        }
      }
      patch.postImage = await this.uploadService.uploadFile(file as any, 'posts');
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('No changes');
    }

    const before = {
      caption: (post as any)?.caption ?? null,
      postImage: (post as any)?.postImage ?? null,
    };

    await post.update(patch as any);

    if (removeImage) {
      const oldImage = before.postImage ? String(before.postImage) : null;
      if (oldImage) {
        try {
          await this.uploadService.deleteFile(oldImage, 'posts');
        } catch (_) {
          // ignore
        }
      }
    }

    const after = {
      caption: (post as any)?.caption ?? null,
      postImage: (post as any)?.postImage ?? null,
    };

    await this.adminAuditLogService.log(Number(actor?.adminId), 'post_update', {
      targetType: 'post',
      targetId: id,
      metadata: {
        postId: id,
        createdBy: Number((post as any)?.createdBy),
        before,
        after,
      },
    });

    return this.getPostById(actor, id);
  }

  async softDeletePost(actor: any, postId: number) {
    this.assertActor(actor);
    const id = this.normalizeId(postId, 'Post');

    const post = await this.postModel.findOne({ where: { id } });
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if ((post as any).deletedAt) {
      return { message: 'Post already deleted' };
    }

    await post.update({
      deletedAt: new Date(),
      deletedByAdminId: Number(actor?.adminId),
      deletedByUserId: null,
    } as any);

    await this.adminAuditLogService.log(Number(actor?.adminId), 'post_soft_delete', {
      targetType: 'post',
      targetId: id,
      metadata: {
        postId: id,
        createdBy: Number((post as any)?.createdBy),
      },
    });
    return { message: 'Post deleted successfully' };
  }

  async restorePost(actor: any, postId: number) {
    this.assertActor(actor);
    const id = this.normalizeId(postId, 'Post');

    const post = await this.postModel.findOne({ where: { id } });
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (!(post as any).deletedAt) {
      return { message: 'Post is not deleted' };
    }

    await post.update({ deletedAt: null, deletedByAdminId: null, deletedByUserId: null } as any);

    await this.adminAuditLogService.log(Number(actor?.adminId), 'post_restore', {
      targetType: 'post',
      targetId: id,
      metadata: {
        postId: id,
        createdBy: Number((post as any)?.createdBy),
      },
    });
    return { message: 'Post restored successfully' };
  }

  async purgePost(actor: any, postId: number) {
    this.assertActor(actor);
    const id = this.normalizeId(postId, 'Post');

    const post = await this.postModel.findOne({ where: { id } });
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (!(post as any).deletedAt) {
      throw new ForbiddenException('Post must be soft deleted before it can be purged');
    }

    const createdBy = Number((post as any)?.createdBy);

    const postJson: any = typeof (post as any)?.toJSON === 'function' ? (post as any).toJSON() : post;

    try {
      if (postJson?.postImage) {
        await this.uploadService.deleteFile(String(postJson.postImage), 'posts');
      }
    } catch (_) {
      // ignore
    }

    try {
      if (postJson?.postVideo) {
        await this.uploadService.deleteFile(String(postJson.postVideo), 'posts');
      }
    } catch (_) {
      // ignore
    }

    await this.postLikeModel.destroy({ where: { postId: id } });
    await this.postCommentModel.destroy({ where: { postId: id } });
    await (post as any).destroy();

    await this.adminAuditLogService.log(Number(actor?.adminId), 'post_purge', {
      targetType: 'post',
      targetId: id,
      metadata: {
        postId: id,
        createdBy,
      },
    });

    return { message: 'Post permanently deleted' };
  }

  async listPostLikes(
    actor: any,
    postId: number,
    params?: {
      page?: number;
      limit?: number;
    },
  ) {
    this.assertActor(actor);
    const id = this.normalizeId(postId, 'Post');

    const post = await this.postModel.findOne({ where: { id }, attributes: ['id'] as any });
    if (!post) throw new NotFoundException('Post not found');

    const page = Math.max(1, Number(params?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params?.limit || 25)));
    const offset = (page - 1) * limit;

    const { rows: likes, count: total } = await this.postLikeModel.findAndCountAll({
      where: { postId: id },
      order: [['createdAt', 'DESC']] as any,
      attributes: ['id', 'postId', 'userId', 'createdAt'] as any,
      limit,
      offset,
      distinct: true,
    });

    const userIds = Array.from(
      new Set(
        likes
          .map((l: any) => Number(typeof l?.get === 'function' ? l.get('userId') : l?.userId))
          .filter((v) => Number.isFinite(v) && !Number.isNaN(v)),
      ),
    );

    const profiles = await this.userProfileModel.findAll({
      where: { userId: userIds },
      attributes: ['userId', 'firstName', 'lastName', 'profile'] as any,
    });

    const byUserId = new Map<number, any>();
    profiles.forEach((p: any) => {
      const json = typeof p?.toJSON === 'function' ? p.toJSON() : p;
      byUserId.set(Number(json.userId), json);
    });

    const data = likes.map((l: any) => {
      const json = typeof l?.toJSON === 'function' ? l.toJSON() : l;
      const uid = Number(json.userId);
      const p = byUserId.get(uid);
      return {
        id: json.id,
        postId: json.postId,
        userId: uid,
        createdAt: json.createdAt,
        user: p
          ? {
              userId: uid,
              name: [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || null,
              profile: p.profile ? this.uploadService.getFileUrl(String(p.profile), 'profile') : null,
            }
          : null,
      };
    });

    return {
      message: 'Post likes fetched successfully',
      total,
      likes: data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async listPostComments(
    actor: any,
    postId: number,
    params?: {
      page?: number;
      limit?: number;
    },
  ) {
    this.assertActor(actor);
    const id = this.normalizeId(postId, 'Post');

    const post = await this.postModel.findOne({ where: { id }, attributes: ['id'] as any });
    if (!post) throw new NotFoundException('Post not found');

    const page = Math.max(1, Number(params?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params?.limit || 25)));
    const offset = (page - 1) * limit;

    const { rows: comments, count: total } = await this.postCommentModel.findAndCountAll({
      where: { postId: id, deletedAt: null } as any,
      order: [['createdAt', 'DESC']] as any,
      attributes: ['id', 'postId', 'userId', 'comment', 'parentCommentId', 'createdAt', 'updatedAt'] as any,
      limit,
      offset,
      distinct: true,
    });

    const userIds = Array.from(
      new Set(
        comments
          .map((c: any) => Number(typeof c?.get === 'function' ? c.get('userId') : c?.userId))
          .filter((v) => Number.isFinite(v) && !Number.isNaN(v)),
      ),
    );

    const profiles = await this.userProfileModel.findAll({
      where: { userId: userIds },
      attributes: ['userId', 'firstName', 'lastName', 'profile'] as any,
    });

    const byUserId = new Map<number, any>();
    profiles.forEach((p: any) => {
      const json = typeof p?.toJSON === 'function' ? p.toJSON() : p;
      byUserId.set(Number(json.userId), json);
    });

    const data = comments.map((c: any) => {
      const json = typeof c?.toJSON === 'function' ? c.toJSON() : c;
      const uid = Number(json.userId);
      const p = byUserId.get(uid);
      return {
        id: json.id,
        postId: json.postId,
        userId: uid,
        content: json.comment,
        parentCommentId: json.parentCommentId,
        createdAt: json.createdAt,
        updatedAt: json.updatedAt,
        user: p
          ? {
              userId: uid,
              firstName: p.firstName,
              lastName: p.lastName,
              profile: p.profile ? this.uploadService.getFileUrl(String(p.profile), 'profile') : null,
            }
          : null,
      };
    });

    return {
      message: 'Post comments fetched successfully',
      total,
      comments: data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async softDeletePostComment(actor: any, commentId: number) {
    this.assertActor(actor);

    const id = this.normalizeId(commentId, 'Comment');

    const comment = await this.postCommentModel.findOne({ where: { id } as any });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if ((comment as any).deletedAt) {
      return { message: 'Comment already deleted' };
    }

    const now = new Date();

    await this.postCommentModel.update(
      { deletedAt: now, deletedByAdminId: Number(actor?.adminId), deletedByUserId: null },
      { where: { parentCommentId: id, deletedAt: null } as any },
    );

    await (comment as any).update({
      deletedAt: now,
      deletedByAdminId: Number(actor?.adminId),
      deletedByUserId: null,
    } as any);

    await this.adminAuditLogService.log(Number(actor?.adminId), 'post_comment_soft_delete', {
      targetType: 'post_comment',
      targetId: id,
      metadata: {
        commentId: id,
        postId: Number((comment as any)?.postId),
        userId: Number((comment as any)?.userId),
      },
    });

    return { message: 'Comment deleted successfully' };
  }

  async listDeletedPostComments(
    actor: any,
    params?: {
      page?: number;
      limit?: number;
    },
  ) {
    this.assertActor(actor);

    const page = Math.max(1, Number(params?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params?.limit || 25)));
    const offset = (page - 1) * limit;

    const { rows: comments, count: total } = await this.postCommentModel.findAndCountAll({
      where: { deletedAt: { [Op.ne]: null } } as any,
      order: [['deletedAt', 'DESC']] as any,
      attributes: ['id', 'postId', 'userId', 'comment', 'parentCommentId', 'deletedAt', 'deletedByAdminId', 'deletedByUserId', 'createdAt', 'updatedAt'] as any,
      limit,
      offset,
      distinct: true,
    });

    const userIds = Array.from(
      new Set(
        comments
          .map((c: any) => Number(typeof c?.get === 'function' ? c.get('userId') : c?.userId))
          .filter((v) => Number.isFinite(v) && !Number.isNaN(v)),
      ),
    );

    const profiles = await this.userProfileModel.findAll({
      where: { userId: userIds },
      attributes: ['userId', 'firstName', 'lastName', 'profile'] as any,
    });

    const byUserId = new Map<number, any>();
    profiles.forEach((p: any) => {
      const json = typeof p?.toJSON === 'function' ? p.toJSON() : p;
      byUserId.set(Number(json.userId), json);
    });

    const data = comments.map((c: any) => {
      const json = typeof c?.toJSON === 'function' ? c.toJSON() : c;
      const uid = Number(json.userId);
      const p = byUserId.get(uid);
      return {
        id: json.id,
        postId: json.postId,
        userId: uid,
        content: json.comment,
        parentCommentId: json.parentCommentId,
        deletedAt: json.deletedAt,
        deletedByAdminId: json.deletedByAdminId,
        deletedByUserId: json.deletedByUserId,
        createdAt: json.createdAt,
        updatedAt: json.updatedAt,
        user: p
          ? {
              userId: uid,
              firstName: p.firstName,
              lastName: p.lastName,
              profile: p.profile ? this.uploadService.getFileUrl(String(p.profile), 'profile') : null,
            }
          : null,
      };
    });

    return {
      message: 'Deleted post comments fetched successfully',
      total,
      comments: data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async restorePostComment(actor: any, commentId: number) {
    this.assertActor(actor);
    const id = this.normalizeId(commentId, 'Comment');

    const comment = await this.postCommentModel.findOne({ where: { id } as any });
    if (!comment) throw new NotFoundException('Comment not found');

    if (!(comment as any).deletedAt) {
      return { message: 'Comment is not deleted' };
    }

    await this.postCommentModel.update(
      { deletedAt: null, deletedByAdminId: null, deletedByUserId: null },
      { where: { parentCommentId: id } as any },
    );

    await (comment as any).update({ deletedAt: null, deletedByAdminId: null, deletedByUserId: null } as any);

    await this.adminAuditLogService.log(Number(actor?.adminId), 'post_comment_restore', {
      targetType: 'post_comment',
      targetId: id,
      metadata: {
        commentId: id,
        postId: Number((comment as any)?.postId),
        userId: Number((comment as any)?.userId),
      },
    });

    return { message: 'Comment restored successfully' };
  }

  async purgePostComment(actor: any, commentId: number) {
    this.assertActor(actor);
    const id = this.normalizeId(commentId, 'Comment');

    const comment = await this.postCommentModel.findOne({ where: { id } as any });
    if (!comment) throw new NotFoundException('Comment not found');

    if (!(comment as any).deletedAt) {
      throw new ForbiddenException('Comment must be soft deleted before it can be purged');
    }

    await this.postCommentModel.destroy({
      where: {
        [Op.or]: [{ id }, { parentCommentId: id }],
      } as any,
    });

    await this.adminAuditLogService.log(Number(actor?.adminId), 'post_comment_purge', {
      targetType: 'post_comment',
      targetId: id,
      metadata: {
        commentId: id,
        postId: Number((comment as any)?.postId),
        userId: Number((comment as any)?.userId),
      },
    });

    return { message: 'Comment deleted permanently' };
  }
}
