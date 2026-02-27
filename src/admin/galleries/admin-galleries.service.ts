import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { Gallery } from '../../gallery/model/gallery.model';
import { GalleryAlbum } from '../../gallery/model/gallery-album.model';
import { GalleryLike } from '../../gallery/model/gallery-like.model';
import { GalleryComment } from '../../gallery/model/gallery-comment.model';
import { UserProfile } from '../../user/model/user-profile.model';
import { UploadService } from '../../uploads/upload.service';

@Injectable()
export class AdminGalleriesService {
  constructor(
    @InjectModel(Gallery)
    private readonly galleryModel: typeof Gallery,
    @InjectModel(GalleryAlbum)
    private readonly galleryAlbumModel: typeof GalleryAlbum,
    @InjectModel(GalleryLike)
    private readonly galleryLikeModel: typeof GalleryLike,
    @InjectModel(GalleryComment)
    private readonly galleryCommentModel: typeof GalleryComment,
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

  async getGalleriesStats(actor: any) {
    this.assertActor(actor);

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const last7Days = new Date(now);
    last7Days.setDate(last7Days.getDate() - 7);

    const [
      totalGalleries,
      totalActiveGalleries,
      totalInactiveGalleries,
      galleriesToday,
      publicGalleries,
      privateGalleries,
      totalLikes,
      totalComments,
      activeUsersLast7Days,
    ] = await Promise.all([
      this.galleryModel.count(),
      this.galleryModel.count({ where: { status: 1 } as any }),
      this.galleryModel.count({ where: { status: 0 } as any }),
      this.galleryModel.count({ where: { createdAt: { [Op.between]: [startOfToday, endOfToday] } } as any }),
      this.galleryModel.count({ where: { status: 1, privacy: 'public' } as any }),
      this.galleryModel.count({ where: { status: 1, privacy: 'private' } as any }),
      this.galleryLikeModel.count(),
      this.galleryCommentModel.count(),
      this.galleryModel.count({ where: { status: 1, createdAt: { [Op.gte]: last7Days } } as any, distinct: true, col: 'createdBy' as any } as any),
    ]);

    const avgLikesPerGallery = totalGalleries > 0 ? Number(totalLikes || 0) / Number(totalGalleries || 1) : 0;
    const avgCommentsPerGallery = totalGalleries > 0 ? Number(totalComments || 0) / Number(totalGalleries || 1) : 0;

    return {
      message: 'Galleries stats fetched successfully',
      data: {
        totalGalleries,
        totalActiveGalleries,
        totalInactiveGalleries,
        galleriesToday,
        publicGalleries,
        privateGalleries,
        totalLikes,
        totalComments,
        avgLikesPerGallery,
        avgCommentsPerGallery,
        activeUsersLast7Days,
        reportedGalleries: 0,
        deletedGalleries: totalInactiveGalleries,
      },
    };
  }

  async listGalleries(
    actor: any,
    params?: {
      page?: number;
      limit?: number;
      q?: string;
      privacy?: string;
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
    const privacy = String(params?.privacy || '').trim().toLowerCase();
    const userId = params?.userId;
    const from = String(params?.from || '').trim();
    const to = String(params?.to || '').trim();

    const where: any = {
      status: 1,
    };

    if (Number.isFinite(Number(userId)) && Number(userId) > 0) {
      where.createdBy = Number(userId);
    }

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

    const { rows, count } = await this.galleryModel.findAndCountAll({
      where,
      attributes: ['id', 'galleryTitle', 'galleryDescription', 'coverPhoto', 'privacy', 'familyCode', 'status', 'createdBy', 'createdAt'] as any,
      order: [['createdAt', 'DESC']] as any,
      limit,
      offset,
    });

    const galleryIds = rows
      .map((r: any) => Number(typeof r?.get === 'function' ? r.get('id') : r?.id))
      .filter((n) => Number.isFinite(n) && !Number.isNaN(n) && n > 0);

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

  async getGalleryById(actor: any, galleryId: number) {
    this.assertActor(actor);

    const id = this.normalizeId(galleryId, 'Gallery');

    const gallery = await this.galleryModel.findOne({
      where: { id },
      attributes: [
        'id',
        'galleryTitle',
        'galleryDescription',
        'coverPhoto',
        'privacy',
        'familyCode',
        'status',
        'createdBy',
        'createdAt',
        'updatedAt',
      ] as any,
    });

    if (!gallery) {
      throw new NotFoundException('Gallery not found');
    }

    const albums = await this.galleryAlbumModel.findAll({
      where: { galleryId: id } as any,
      attributes: ['id', 'galleryId', 'album', 'createdAt'] as any,
      order: [['id', 'ASC']] as any,
    });

    const galleryJson: any = typeof (gallery as any)?.toJSON === 'function' ? (gallery as any).toJSON() : gallery;

    const albumImages = albums.map((a: any) => {
      const json = typeof a?.toJSON === 'function' ? a.toJSON() : a;
      return {
        ...json,
        url: json?.album ? this.uploadService.getFileUrl(String(json.album), 'gallery') : null,
      };
    });

    const [likeCount, commentCount] = await Promise.all([
      this.galleryLikeModel.count({ where: { galleryId: id } as any }),
      this.galleryCommentModel.count({ where: { galleryId: id } as any }),
    ]);

    const cover = galleryJson?.coverPhoto ? this.uploadService.getFileUrl(String(galleryJson.coverPhoto), 'gallery/cover') : null;
    const effectiveCover = cover || (albumImages[0]?.url || null);

    return {
      message: 'Gallery fetched successfully',
      data: {
        ...galleryJson,
        coverPhoto: effectiveCover,
        album: albumImages,
        totalImages: albumImages.length,
        likeCount,
        commentCount,
      },
    };
  }

  async listGalleryLikes(
    actor: any,
    galleryId: number,
    params?: {
      page?: number;
      limit?: number;
    },
  ) {
    this.assertActor(actor);
    const id = this.normalizeId(galleryId, 'Gallery');

    const gallery = await this.galleryModel.findOne({ where: { id }, attributes: ['id'] as any });
    if (!gallery) throw new NotFoundException('Gallery not found');

    const page = Math.max(1, Number(params?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params?.limit || 25)));
    const offset = (page - 1) * limit;

    const { rows: likes, count: total } = await this.galleryLikeModel.findAndCountAll({
      where: { galleryId: id } as any,
      order: [['createdAt', 'DESC']] as any,
      attributes: ['id', 'galleryId', 'userId', 'createdAt'] as any,
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
      where: { userId: userIds } as any,
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
        galleryId: json.galleryId,
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
      message: 'Gallery likes fetched successfully',
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

  async listGalleryComments(
    actor: any,
    galleryId: number,
    params?: {
      page?: number;
      limit?: number;
    },
  ) {
    this.assertActor(actor);
    const id = this.normalizeId(galleryId, 'Gallery');

    const gallery = await this.galleryModel.findOne({ where: { id }, attributes: ['id'] as any });
    if (!gallery) throw new NotFoundException('Gallery not found');

    const page = Math.max(1, Number(params?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params?.limit || 25)));
    const offset = (page - 1) * limit;

    const { rows: comments, count: total } = await this.galleryCommentModel.findAndCountAll({
      where: { galleryId: id } as any,
      order: [['createdAt', 'DESC']] as any,
      attributes: ['id', 'galleryId', 'userId', 'comments', 'parentCommentId', 'createdAt', 'updatedAt'] as any,
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
      where: { userId: userIds } as any,
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
        galleryId: json.galleryId,
        userId: uid,
        content: json.comments,
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
      message: 'Gallery comments fetched successfully',
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
}
