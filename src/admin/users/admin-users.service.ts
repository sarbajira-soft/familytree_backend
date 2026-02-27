import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, fn, col } from 'sequelize';

import { User } from '../../user/model/user.model';
import { UserProfile } from '../../user/model/user-profile.model';
import { Post } from '../../post/model/post.model';
import { PostLike } from '../../post/model/post-like.model';
import { PostComment } from '../../post/model/post-comment.model';
import { Gallery } from '../../gallery/model/gallery.model';
import { GalleryAlbum } from '../../gallery/model/gallery-album.model';
import { Event } from '../../event/model/event.model';
import { FamilyMember } from '../../family/model/family-member.model';
import { UploadService } from '../../uploads/upload.service';

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectModel(User)
    private readonly userModel: typeof User,
    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,
    @InjectModel(Post)
    private readonly postModel: typeof Post,
    @InjectModel(PostLike)
    private readonly postLikeModel: typeof PostLike,
    @InjectModel(PostComment)
    private readonly postCommentModel: typeof PostComment,
    @InjectModel(Gallery)
    private readonly galleryModel: typeof Gallery,
    @InjectModel(GalleryAlbum)
    private readonly galleryAlbumModel: typeof GalleryAlbum,
    @InjectModel(Event)
    private readonly eventModel: typeof Event,
    @InjectModel(FamilyMember)
    private readonly familyMemberModel: typeof FamilyMember,
    private readonly uploadService: UploadService,
  ) {}

  async getUsersStats(actor: any) {
    if (!actor?.adminId) {
      throw new ForbiddenException('No admin data in request');
    }

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const last7Days = new Date(now);
    last7Days.setDate(last7Days.getDate() - 7);

    const prev7Days = new Date(last7Days);
    prev7Days.setDate(prev7Days.getDate() - 7);

    const last30Days = new Date(now);
    last30Days.setDate(last30Days.getDate() - 30);

    const baseWhere: any = { isAppUser: true };

    const [
      totalUsers,
      newUsersToday,
      newUsersLast7Days,
      newUsersPrev7Days,
      inactiveUsers30Days,
      verifiedUsers,
      suspendedUsers,
      totalPosts,
      distinctPosters,
    ] = await Promise.all([
      this.userModel.count({ where: baseWhere }),
      this.userModel.count({ where: { ...baseWhere, createdAt: { [Op.gte]: startOfToday } } as any }),
      this.userModel.count({ where: { ...baseWhere, createdAt: { [Op.gte]: last7Days } } as any }),
      this.userModel.count({ where: { ...baseWhere, createdAt: { [Op.gte]: prev7Days, [Op.lt]: last7Days } } as any }),
      this.userModel.count({ where: { ...baseWhere, [Op.or]: [{ lastLoginAt: null }, { lastLoginAt: { [Op.lt]: last30Days } }] } as any }),
      this.userModel.count({ where: { ...baseWhere, verifiedAt: { [Op.ne]: null } } as any }),
      this.userModel.count({ where: { ...baseWhere, status: 2 } as any }),
      this.postModel.count({ where: { status: 1 } as any }),
      this.postModel.count({ where: { status: 1 } as any, distinct: true, col: 'createdBy' as any } as any),
    ]);

    const usersWithZeroPosts = Math.max(0, Number(totalUsers || 0) - Number(distinctPosters || 0));

    const avgPostsPerUser = totalUsers ? Number(totalPosts || 0) / Number(totalUsers || 1) : 0;

    const weeklyGrowthPct = newUsersPrev7Days
      ? ((Number(newUsersLast7Days || 0) - Number(newUsersPrev7Days || 0)) / Number(newUsersPrev7Days)) * 100
      : null;

    const recentPosters = await this.postModel.findAll({
      where: { status: 1, createdAt: { [Op.gte]: last7Days } } as any,
      attributes: [[fn('DISTINCT', col('createdBy')), 'userId']] as any,
      raw: true,
    });

    const recentLikers = await this.postLikeModel.findAll({
      where: { createdAt: { [Op.gte]: last7Days } } as any,
      attributes: [[fn('DISTINCT', col('userId')), 'userId']] as any,
      raw: true,
    });

    const recentCommenters = await this.postCommentModel.findAll({
      where: { createdAt: { [Op.gte]: last7Days } } as any,
      attributes: [[fn('DISTINCT', col('userId')), 'userId']] as any,
      raw: true,
    });

    const recentLogins = await this.userModel.findAll({
      where: { ...baseWhere, lastLoginAt: { [Op.gte]: last7Days } } as any,
      attributes: [[fn('DISTINCT', col('id')), 'userId']] as any,
      raw: true,
    });

    const activeIds = new Set<number>();
    [recentPosters, recentLikers, recentCommenters, recentLogins].forEach((arr: any[]) => {
      arr.forEach((x: any) => {
        const v = Number(x?.userId);
        if (Number.isFinite(v) && !Number.isNaN(v) && v > 0) activeIds.add(v);
      });
    });

    const activeUsersLast7Days = activeIds.size;

    const topActive = (await this.postModel.findOne({
      where: { status: 1, createdAt: { [Op.gte]: last7Days } } as any,
      attributes: ['createdBy', [fn('COUNT', col('id')), 'postCount']] as any,
      group: ['createdBy'] as any,
      order: [[fn('COUNT', col('id')), 'DESC']] as any,
      raw: true,
    })) as any;

    const topActiveUserId = topActive?.createdBy ? Number((topActive as any).createdBy) : null;
    const topActiveUserPosts = topActive?.postCount ? Number((topActive as any).postCount) : 0;

    const topActiveUser = topActiveUserId
      ? await this.userModel.findOne({
          where: { id: topActiveUserId, isAppUser: true } as any,
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
              required: false,
              attributes: ['id', 'userId', 'firstName', 'lastName', 'profile'] as any,
            },
          ],
          attributes: ['id', 'email', 'countryCode', 'mobile', 'status', 'role', 'lastLoginAt', 'verifiedAt', 'createdAt'] as any,
        })
      : null;

    return {
      message: 'Users stats fetched successfully',
      data: {
        totalUsers,
        newUsersToday,
        newUsersLast7Days,
        newUsersPrev7Days,
        weeklyGrowthPct,
        activeUsersLast7Days,
        inactiveUsers30Days,
        verifiedUsers,
        suspendedUsers,
        reportedUsers: 0,
        usersWithZeroPosts,
        avgPostsPerUser,
        topActiveUser: topActiveUser
          ? {
              user: topActiveUser,
              postsLast7Days: topActiveUserPosts,
            }
          : null,
      },
    };
  }

  async listUserGalleries(
    actor: any,
    userId: number,
    params: {
      page?: number;
      limit?: number;
      q?: string;
      privacy?: string;
    },
  ) {
    if (!actor?.adminId) {
      throw new ForbiddenException('No admin data in request');
    }

    const targetUserId = Number(userId);
    if (!Number.isFinite(targetUserId) || Number.isNaN(targetUserId) || targetUserId <= 0) {
      throw new NotFoundException('User not found');
    }

    const exists = await this.userModel.findOne({
      where: { id: targetUserId, isAppUser: true },
      attributes: ['id'],
    });

    if (!exists) {
      throw new NotFoundException('User not found');
    }

    const page = Math.max(1, Number(params.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params.limit || 25)));
    const offset = (page - 1) * limit;

    const q = String(params.q || '').trim();
    const privacy = String(params.privacy || '').trim().toLowerCase();

    const where: any = {
      createdBy: targetUserId,
      status: 1,
    };

    if (q) {
      const numericId = Number(q);
      const or: any[] = [{ galleryTitle: { [Op.iLike]: `%${q}%` } }];
      if (!Number.isNaN(numericId) && Number.isFinite(numericId)) {
        or.unshift({ id: numericId });
      }
      where[Op.or] = or;
    }

    if (privacy && ['public', 'private'].includes(privacy)) {
      where.privacy = privacy;
    }

    const { rows, count } = await this.galleryModel.findAndCountAll({
      where,
      attributes: ['id', 'galleryTitle', 'galleryDescription', 'coverPhoto', 'privacy', 'familyCode', 'status', 'createdBy', 'createdAt'] as any,
      order: [['createdAt', 'DESC']] as any,
      limit,
      offset,
    });

    const galleryIds = rows.map((r: any) => Number((typeof r?.get === 'function' ? r.get('id') : r?.id) as any)).filter((n) => Number.isFinite(n));

    const albums = galleryIds.length
      ? await this.galleryAlbumModel.findAll({
          where: { galleryId: galleryIds } as any,
          attributes: ['id', 'galleryId', 'album'] as any,
          order: [['id', 'ASC']] as any,
        })
      : [];

    const firstImageByGalleryId = new Map<number, any>();
    const countByGalleryId = new Map<number, number>();

    albums.forEach((a: any) => {
      const json = typeof a?.toJSON === 'function' ? a.toJSON() : a;
      const gid = Number(json.galleryId);
      if (!firstImageByGalleryId.has(gid)) {
        firstImageByGalleryId.set(gid, json);
      }
      countByGalleryId.set(gid, (countByGalleryId.get(gid) || 0) + 1);
    });

    const data = rows.map((r: any) => {
      const json = typeof r?.toJSON === 'function' ? r.toJSON() : r;
      const gid = Number(json.id);
      const first = firstImageByGalleryId.get(gid);
      const previewImage = first?.album ? this.uploadService.getFileUrl(String(first.album), 'gallery') : null;
      const coverPhoto = json?.coverPhoto ? this.uploadService.getFileUrl(String(json.coverPhoto), 'gallery/cover') : null;
      const effectiveCover = coverPhoto || previewImage;
      return {
        ...json,
        coverPhoto: effectiveCover,
        previewImage,
        imagesCount: countByGalleryId.get(gid) || 0,
      };
    });

    return {
      message: 'Galleries fetched successfully',
      data,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit) || 1,
      },
    };
  }

  async listUserPosts(
    actor: any,
    userId: number,
    params: {
      page?: number;
      limit?: number;
      q?: string;
      privacy?: string;
      media?: string;
    },
  ) {
    if (!actor?.adminId) {
      throw new ForbiddenException('No admin data in request');
    }

    const targetUserId = Number(userId);
    if (!Number.isFinite(targetUserId) || Number.isNaN(targetUserId) || targetUserId <= 0) {
      throw new NotFoundException('User not found');
    }

    const exists = await this.userModel.findOne({
      where: { id: targetUserId, isAppUser: true },
      attributes: ['id'],
    });

    if (!exists) {
      throw new NotFoundException('User not found');
    }

    const page = Math.max(1, Number(params.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params.limit || 25)));
    const offset = (page - 1) * limit;

    const q = String(params.q || '').trim();
    const privacy = String(params.privacy || '').trim().toLowerCase();
    const media = String(params.media || '').trim().toLowerCase();

    const where: any = {
      createdBy: targetUserId,
      status: 1,
    };

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
            [Op.or]: [
              { postImage: null },
              { postImage: '' },
            ],
          },
          {
            [Op.or]: [
              { postVideo: null },
              { postVideo: '' },
            ],
          },
        ];
      }
    }

    const { rows, count } = await this.postModel.findAndCountAll({
      where,
      attributes: ['id', 'caption', 'postImage', 'postVideo', 'privacy', 'familyCode', 'status', 'createdBy', 'createdAt'],
      order: [['createdAt', 'DESC']],
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

  async getAppUserById(actor: any, id: number) {
    if (!actor?.adminId) {
      throw new ForbiddenException('No admin data in request');
    }

    const userId = Number(id);
    if (!Number.isFinite(userId) || Number.isNaN(userId) || userId <= 0) {
      throw new NotFoundException('User not found');
    }

    const user = await this.userModel.findOne({
      where: {
        id: userId,
        isAppUser: true,
      },
      include: [
        {
          model: this.userProfileModel,
          as: 'userProfile',
          required: false,
          attributes: [
            'id',
            'userId',
            'firstName',
            'lastName',
            'profile',
            'gender',
            'contactNumber',
            'familyCode',
            'isPrivate',
            'createdAt',
            'updatedAt',
          ],
        },
      ],
      attributes: [
        'id',
        'email',
        'countryCode',
        'mobile',
        'status',
        'role',
        'isAppUser',
        'hasAcceptedTerms',
        'termsVersion',
        'termsAcceptedAt',
        'lastLoginAt',
        'verifiedAt',
        'createdBy',
        'createdAt',
        'updatedAt',
      ],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const postsCount = await this.postModel.count({
      where: {
        createdBy: userId,
        status: 1,
      },
    });

    const galleriesCount = await this.galleryModel.count({
      where: {
        createdBy: userId,
        status: 1,
      },
    });

    const eventsCount = await this.eventModel.count({
      where: {
        userId: userId,
        status: 1,
      },
    });

    const familyCode = String((user as any)?.userProfile?.familyCode || '').trim() || null;
    const familyMembersCount = familyCode
      ? await this.familyMemberModel.count({
          where: {
            familyCode,
            approveStatus: 'approved',
          },
        })
      : 0;

    return {
      message: 'User fetched successfully',
      data: user,
      stats: {
        postsCount,
        galleriesCount,
        eventsCount,
        familyCode,
        familyMembersCount,
      },
    };
  }

  async listAppUsers(
    actor: any,
    params: {
      page?: number;
      limit?: number;
      q?: string;
      status?: number;
      role?: number;
    },
  ) {
    if (!actor?.adminId) {
      throw new ForbiddenException('No admin data in request');
    }

    const page = Math.max(1, Number(params.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params.limit || 25)));
    const offset = (page - 1) * limit;

    const q = (params.q || '').trim();
    const status = params.status !== undefined ? Number(params.status) : undefined;
    const role = params.role !== undefined ? Number(params.role) : undefined;

    const where: any = {
      isAppUser: true,
    };

    if (!Number.isNaN(status) && status !== undefined) {
      where.status = status;
    }

    if (!Number.isNaN(role) && role !== undefined) {
      where.role = role;
    }

    if (q) {
      const numericId = Number(q);
      const or: any[] = [
        { email: { [Op.iLike]: `%${q}%` } },
        { mobile: { [Op.iLike]: `%${q}%` } },
        { '$userProfile.firstName$': { [Op.iLike]: `%${q}%` } },
        { '$userProfile.lastName$': { [Op.iLike]: `%${q}%` } },
      ];

      if (!Number.isNaN(numericId) && Number.isFinite(numericId)) {
        or.unshift({ id: numericId });
      }

      where[Op.or] = or;
    }

    const { rows, count } = await this.userModel.findAndCountAll({
      where,
      include: [
        {
          model: this.userProfileModel,
          as: 'userProfile',
          required: false,
          attributes: [
            'id',
            'userId',
            'firstName',
            'lastName',
            'profile',
            'gender',
            'contactNumber',
            'familyCode',
            'isPrivate',
            'createdAt',
            'updatedAt',
          ],
        },
      ],
      attributes: [
        'id',
        'email',
        'countryCode',
        'mobile',
        'status',
        'role',
        'isAppUser',
        'hasAcceptedTerms',
        'termsVersion',
        'termsAcceptedAt',
        'lastLoginAt',
        'verifiedAt',
        'createdBy',
        'createdAt',
        'updatedAt',
      ],
      order: [['id', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    return {
      message: 'Users fetched successfully',
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit) || 1,
      },
    };
  }
}
