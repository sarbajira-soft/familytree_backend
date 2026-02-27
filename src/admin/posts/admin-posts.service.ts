import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { Post } from '../../post/model/post.model';
import { PostLike } from '../../post/model/post-like.model';
import { PostComment } from '../../post/model/post-comment.model';
import { User } from '../../user/model/user.model';
import { UserProfile } from '../../user/model/user-profile.model';
import { UploadService } from '../../uploads/upload.service';

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
  ) {}

  private assertActor(actor: any) {
    if (!actor?.adminId) {
      throw new ForbiddenException('No admin data in request');
    }
  }

  private normalizeId(value: any, label: string) {
    const id = Number(value);
    if (!Number.isFinite(id) || Number.isNaN(id) || id <= 0) {
      throw new NotFoundException(`${label} not found`);
    }
    return id;
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
      this.postCommentModel.count({ where: { postId: id } }),
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

  async listPostLikes(actor: any, postId: number) {
    this.assertActor(actor);
    const id = this.normalizeId(postId, 'Post');

    const post = await this.postModel.findOne({ where: { id }, attributes: ['id'] as any });
    if (!post) throw new NotFoundException('Post not found');

    const likes = await this.postLikeModel.findAll({
      where: { postId: id },
      order: [['createdAt', 'DESC']] as any,
      attributes: ['id', 'postId', 'userId', 'createdAt'] as any,
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
      total: data.length,
      likes: data,
    };
  }

  async listPostComments(actor: any, postId: number) {
    this.assertActor(actor);
    const id = this.normalizeId(postId, 'Post');

    const post = await this.postModel.findOne({ where: { id }, attributes: ['id'] as any });
    if (!post) throw new NotFoundException('Post not found');

    const comments = await this.postCommentModel.findAll({
      where: { postId: id },
      order: [['createdAt', 'DESC']] as any,
      attributes: ['id', 'postId', 'userId', 'comment', 'parentCommentId', 'createdAt', 'updatedAt'] as any,
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
      total: data.length,
      comments: data,
    };
  }
}
