import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { ContentReport } from '../../report/model/content-report.model';
import { User } from '../../user/model/user.model';
import { UserProfile } from '../../user/model/user-profile.model';
import { Post } from '../../post/model/post.model';
import { Gallery } from '../../gallery/model/gallery.model';
import { Event } from '../../event/model/event.model';
import { AdminAuditLogService } from '../admin-audit-log.service';

@Injectable()
export class AdminReportsService {
  constructor(
    @InjectModel(ContentReport)
    private readonly contentReportModel: typeof ContentReport,
    @InjectModel(User)
    private readonly userModel: typeof User,
    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,
    @InjectModel(Post)
    private readonly postModel: typeof Post,
    @InjectModel(Gallery)
    private readonly galleryModel: typeof Gallery,
    @InjectModel(Event)
    private readonly eventModel: typeof Event,
    private readonly adminAuditLogService: AdminAuditLogService,
  ) {}

  private assertActor(actor: any) {
    if (!actor?.adminId) {
      throw new ForbiddenException('No admin data in request');
    }
  }

  private normalizeStatus(value: any) {
    if (value === undefined || value === null || String(value).trim() === '') return undefined;
    const s = String(value).trim().toLowerCase();
    if (s === 'open' || s === 'reviewed' || s === 'dismissed' || s === 'action_taken') return s;
    throw new BadRequestException('Invalid status');
  }

  private normalizeTargetType(value: any) {
    if (value === undefined || value === null || String(value).trim() === '') return undefined;
    const s = String(value).trim().toLowerCase();
    if (s === 'post' || s === 'gallery' || s === 'event') return s;
    throw new BadRequestException('Invalid targetType');
  }

  private normalizeId(value: any, label: string) {
    if (value === undefined || value === null || String(value).trim() === '') return undefined;
    const id = Number(value);
    if (!Number.isFinite(id) || Number.isNaN(id) || id <= 0) throw new BadRequestException(`Invalid ${label}`);
    return id;
  }

  async listReports(
    actor: any,
    params: {
      page?: number;
      limit?: number;
      status?: string;
      targetType?: string;
      targetId?: string | number;
      reporterUserId?: string | number;
      q?: string;
      from?: string;
      to?: string;
    },
  ) {
    this.assertActor(actor);

    const page = Math.max(1, Number(params?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params?.limit || 25)));
    const offset = (page - 1) * limit;

    const status = this.normalizeStatus(params?.status);
    const targetType = this.normalizeTargetType(params?.targetType);
    const targetId = this.normalizeId(params?.targetId, 'targetId');
    const reporterUserId = this.normalizeId(params?.reporterUserId, 'reporterUserId');
    const q = String(params?.q || '').trim();

    const where: any = {};
    if (status) where.status = status;
    if (targetType) where.targetType = targetType;
    if (targetId) where.targetId = targetId;
    if (reporterUserId) where.reportedByUserId = reporterUserId;

    const from = params?.from ? new Date(String(params.from)) : null;
    const to = params?.to ? new Date(String(params.to)) : null;
    if (from && !Number.isNaN(from.getTime()) && to && !Number.isNaN(to.getTime())) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      where.createdAt = { [Op.between]: [from, end] };
    } else if (from && !Number.isNaN(from.getTime())) {
      where.createdAt = { [Op.gte]: from };
    } else if (to && !Number.isNaN(to.getTime())) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      where.createdAt = { [Op.lte]: end };
    }

    if (q) {
      where[Op.or] = [
        { reason: { [Op.iLike]: `%${q}%` } },
        { description: { [Op.iLike]: `%${q}%` } },
      ];
    }

    const { rows, count } = await this.contentReportModel.findAndCountAll({
      where,
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ] as any,
      limit,
      offset,
      include: [
        {
          model: this.userModel,
          as: 'reporter',
          required: false,
          attributes: ['id', 'email', 'mobile', 'countryCode'] as any,
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
              required: false,
              attributes: ['firstName', 'lastName', 'profile'] as any,
            },
          ],
        },
      ] as any,
    });

    const postIds: number[] = [];
    const galleryIds: number[] = [];
    const eventIds: number[] = [];

    for (const r of rows as any[]) {
      const t = String(r?.targetType || '').toLowerCase();
      const id = Number(r?.targetId);
      if (!Number.isFinite(id) || id <= 0) continue;
      if (t === 'post') postIds.push(id);
      else if (t === 'gallery') galleryIds.push(id);
      else if (t === 'event') eventIds.push(id);
    }

    const [posts, galleries, events] = await Promise.all([
      postIds.length
        ? this.postModel.findAll({ where: { id: { [Op.in]: postIds } } as any, attributes: ['id', 'caption', 'createdBy', 'privacy', 'deletedAt'] as any })
        : Promise.resolve([] as any),
      galleryIds.length
        ? this.galleryModel.findAll({ where: { id: { [Op.in]: galleryIds } } as any, attributes: ['id', 'galleryTitle', 'createdBy', 'privacy', 'deletedAt', 'coverPhoto'] as any })
        : Promise.resolve([] as any),
      eventIds.length
        ? this.eventModel.findAll({ where: { id: { [Op.in]: eventIds } } as any, attributes: ['id', 'eventTitle', 'createdBy', 'familyCode', 'deletedAt'] as any })
        : Promise.resolve([] as any),
    ]);

    const postMap = new Map<number, any>();
    for (const p of posts as any[]) postMap.set(Number(p.id), p);
    const galleryMap = new Map<number, any>();
    for (const g of galleries as any[]) galleryMap.set(Number(g.id), g);
    const eventMap = new Map<number, any>();
    for (const e of events as any[]) eventMap.set(Number(e.id), e);

    const data = (rows as any[]).map((r) => {
      const t = String(r?.targetType || '').toLowerCase();
      const id = Number(r?.targetId);

      let target: any = null;
      if (t === 'post') {
        const p = postMap.get(id);
        if (p) {
          target = {
            id: Number(p.id),
            title: p.caption,
            createdBy: p.createdBy,
            privacy: p.privacy,
            deletedAt: p.deletedAt,
          };
        }
      } else if (t === 'gallery') {
        const g = galleryMap.get(id);
        if (g) {
          target = {
            id: Number(g.id),
            title: g.galleryTitle,
            createdBy: g.createdBy,
            privacy: g.privacy,
            deletedAt: g.deletedAt,
            coverPhoto: g.coverPhoto,
          };
        }
      } else if (t === 'event') {
        const e = eventMap.get(id);
        if (e) {
          target = {
            id: Number(e.id),
            title: e.eventTitle,
            createdBy: e.createdBy,
            familyCode: e.familyCode,
            deletedAt: e.deletedAt,
          };
        }
      }

      return {
        id: Number(r?.id),
        targetType: r?.targetType,
        targetId: Number(r?.targetId),
        reason: r?.reason,
        description: r?.description,
        status: r?.status,
        reviewedByAdminId: r?.reviewedByAdminId,
        reviewedAt: r?.reviewedAt,
        adminNote: r?.adminNote,
        createdAt: r?.createdAt,
        updatedAt: r?.updatedAt,
        reporter: r?.reporter
          ? {
              id: Number(r.reporter.id),
              email: r.reporter.email,
              mobile: r.reporter.mobile,
              countryCode: r.reporter.countryCode,
              profile: r.reporter.userProfile
                ? {
                    firstName: r.reporter.userProfile.firstName,
                    lastName: r.reporter.userProfile.lastName,
                    profile: r.reporter.userProfile.profile,
                  }
                : null,
            }
          : null,
        target,
      };
    });

    const totalPages = Math.max(1, Math.ceil(count / limit));

    return {
      data,
      pagination: {
        total: count,
        page,
        limit,
        totalPages,
      },
    };
  }

  async updateReport(actor: any, reportId: number, patch: { status?: string; adminNote?: string }) {
    this.assertActor(actor);

    const id = Number(reportId);
    if (!Number.isFinite(id) || Number.isNaN(id) || id <= 0) throw new BadRequestException('Invalid reportId');

    const target = await this.contentReportModel.findOne({ where: { id } as any });
    if (!target) throw new NotFoundException('Report not found');

    const before = {
      status: target?.status ?? null,
      adminNote: target?.adminNote ?? null,
      reviewedByAdminId: target?.reviewedByAdminId ?? null,
      reviewedAt: target?.reviewedAt ?? null,
    };

    const status = patch?.status !== undefined ? this.normalizeStatus(patch.status) : undefined;
    const adminNote = patch?.adminNote !== undefined && patch?.adminNote !== null ? String(patch.adminNote).trim() : undefined;

    if (status === undefined && adminNote === undefined) {
      throw new BadRequestException('No changes');
    }

    const update: any = {};
    if (status !== undefined) {
      update.status = status;
      update.reviewedByAdminId = Number(actor.adminId);
      update.reviewedAt = new Date();
    }
    if (adminNote !== undefined) {
      update.adminNote = adminNote || null;
    }

    await this.contentReportModel.update(update, { where: { id } as any });

    const updated = await this.contentReportModel.findOne({ where: { id } as any, attributes: ['id', 'status', 'reviewedByAdminId', 'reviewedAt', 'adminNote', 'updatedAt'] as any });

    await this.adminAuditLogService.log(Number(actor.adminId), 'content_report_update', {
      targetType: 'content_report',
      targetId: id,
      metadata: {
        reportId: id,
        reportTargetType: target?.targetType,
        reportTargetId: target?.targetId,
        before,
        after: {
          status: updated?.status ?? null,
          adminNote: updated?.adminNote ?? null,
          reviewedByAdminId: updated?.reviewedByAdminId ?? null,
          reviewedAt: updated?.reviewedAt ?? null,
        },
      },
    });

    return {
      message: 'Report updated',
      data: updated,
    };
  }
}
