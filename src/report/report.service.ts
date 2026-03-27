import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { Post } from '../post/model/post.model';
import { Gallery } from '../gallery/model/gallery.model';
import { Event } from '../event/model/event.model';

import { ContentReport, ContentReportTargetType } from './model/content-report.model';

@Injectable()
export class ReportService {
  constructor(
    @InjectModel(ContentReport)
    private readonly contentReportModel: typeof ContentReport,
    @InjectModel(Post)
    private readonly postModel: typeof Post,
    @InjectModel(Gallery)
    private readonly galleryModel: typeof Gallery,
    @InjectModel(Event)
    private readonly eventModel: typeof Event,
  ) {}

  private normalizeTargetType(value: any): ContentReportTargetType {
    const raw =
      value && typeof value === 'object'
        ? (value as any)?.targetType ?? (value as any)?.type ?? value
        : value;

    const t = String(raw || '').trim().toLowerCase();
    if (t === 'post' || t === 'gallery' || t === 'event') return t;
    if (t === 'posts') return 'post';
    if (t === 'galleries') return 'gallery';
    if (t === 'events') return 'event';
    if (t.startsWith('post')) return 'post';
    if (t.startsWith('gallery')) return 'gallery';
    if (t.startsWith('event')) return 'event';
    throw new BadRequestException(`Invalid targetType (received: ${String(raw)} | normalized: ${t})`);
  }

  private normalizeTargetId(value: any): number {
    const id = Number(value);
    if (!Number.isFinite(id) || Number.isNaN(id) || id <= 0) {
      throw new BadRequestException('Invalid targetId');
    }
    return id;
  }

  private async assertTargetExists(targetType: ContentReportTargetType, targetId: number) {
    if (targetType === 'post') {
      const exists = await this.postModel.findOne({ where: { id: targetId } as any, attributes: ['id'] as any });
      if (!exists) throw new NotFoundException('Post not found');
      return;
    }

    if (targetType === 'gallery') {
      const exists = await this.galleryModel.findOne({ where: { id: targetId } as any, attributes: ['id'] as any });
      if (!exists) throw new NotFoundException('Gallery not found');
      return;
    }

    const exists = await this.eventModel.findOne({ where: { id: targetId } as any, attributes: ['id'] as any });
    if (!exists) throw new NotFoundException('Event not found');
  }

  async createReport(params: {
    reportedByUserId: number;
    targetType: any;
    targetId: any;
    reason: any;
    description?: any;
  }) {
    const reportedByUserId = Number(params.reportedByUserId);
    if (!Number.isFinite(reportedByUserId) || reportedByUserId <= 0) {
      throw new BadRequestException('Invalid reporter');
    }

    const targetType = this.normalizeTargetType(params.targetType);
    const targetId = this.normalizeTargetId(params.targetId);
    const reason = String(params.reason || '').trim();
    const description = params.description !== undefined && params.description !== null ? String(params.description).trim() : null;

    if (!reason) {
      throw new BadRequestException('Reason is required');
    }

    await this.assertTargetExists(targetType, targetId);

    const existing = await this.contentReportModel.findOne({
      where: {
        targetType,
        targetId,
        reportedByUserId,
        status: 'open',
      } as any,
      attributes: ['id'] as any,
    });

    if (existing) {
      return {
        message: 'Report already submitted',
        data: { reportId: Number((existing as any)?.id) },
        alreadyReported: true,
      };
    }

    try {
      const row = await this.contentReportModel.create(
        {
          targetType,
          targetId,
          reportedByUserId,
          reason,
          description,
          status: 'open',
        } as any,
      );

      return {
        message: 'Report submitted successfully',
        data: { reportId: Number((row as any)?.id) },
        alreadyReported: false,
      };
    } catch (error) {
      const msg = String(error?.message || '');
      if (msg.toLowerCase().includes('uniq_ft_content_report_open') || msg.toLowerCase().includes('duplicate')) {
        return {
          message: 'Report already submitted',
          data: null,
          alreadyReported: true,
        };
      }
      throw error;
    }
  }
}
