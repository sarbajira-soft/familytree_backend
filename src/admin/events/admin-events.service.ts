import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { Event } from '../../event/model/event.model';
import { EventImage } from '../../event/model/event-image.model';
import { User } from '../../user/model/user.model';
import { UserProfile } from '../../user/model/user-profile.model';
import { UploadService } from '../../uploads/upload.service';
import { AdminAuditLogService } from '../admin-audit-log.service';

@Injectable()
export class AdminEventsService {
  constructor(
    @InjectModel(Event)
    private readonly eventModel: typeof Event,
    @InjectModel(EventImage)
    private readonly eventImageModel: typeof EventImage,
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

  private normalizeId(value: any, label: string) {
    const id = Number(value);
    if (!Number.isFinite(id) || Number.isNaN(id) || id <= 0) {
      throw new NotFoundException(`${label} not found`);
    }
    return id;
  }

  async getEventsStats(actor: any) {
    this.assertActor(actor);

    const now = new Date();
    const todayDateOnly = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const last7Days = new Date(now);
    last7Days.setDate(last7Days.getDate() - 7);

    const [
      totalEvents,
      totalActiveEvents,
      totalInactiveEvents,
      eventsToday,
      activeUsersLast7Days,
      expiredEvents,
    ] = await Promise.all([
      this.eventModel.count(),
      this.eventModel.count({ where: { status: 1, eventDate: { [Op.gte]: todayDateOnly } } as any }),
      this.eventModel.count({ where: { status: 0 } as any }),
      this.eventModel.count({ where: { createdAt: { [Op.between]: [startOfToday, endOfToday] } } as any }),
      this.eventModel.count({ where: { status: 1, createdAt: { [Op.gte]: last7Days } } as any, distinct: true, col: 'createdBy' as any } as any),
      this.eventModel.count({ where: { status: 1, eventDate: { [Op.lt]: todayDateOnly } } as any }),
    ]);

    return {
      message: 'Events stats fetched successfully',
      data: {
        totalEvents,
        totalActiveEvents,
        totalInactiveEvents,
        eventsToday,
        activeUsersLast7Days,
        reportedEvents: 0,
        expiredEvents,
      },
    };
  }

  async listEvents(
    actor: any,
    params?: {
      page?: number;
      limit?: number;
      q?: string;
      status?: number;
      userId?: number;
      familyCode?: string;
      from?: string;
      to?: string;
      deleted?: 'only' | 'exclude' | 'all';
    },
  ) {
    this.assertActor(actor);

    const page = Math.max(1, Number(params?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params?.limit || 25)));
    const offset = (page - 1) * limit;

    const q = String(params?.q || '').trim();
    const familyCode = String(params?.familyCode || '').trim();
    const from = String(params?.from || '').trim();
    const to = String(params?.to || '').trim();

    const where: any = {};

    const deletedMode = params?.deleted || 'exclude';
    if (deletedMode === 'only') {
      where.deletedAt = { [Op.ne]: null };
    } else if (deletedMode === 'exclude') {
      where.deletedAt = null;
    } else {
      // all
    }

    if (params?.status === 0 || params?.status === 1) {
      where.status = params.status;
    }

    if (Number.isFinite(Number(params?.userId)) && Number(params?.userId) > 0) {
      where.createdBy = Number(params.userId);
    }

    if (familyCode) {
      where.familyCode = familyCode;
    }

    if (q) {
      const numericId = Number(q);
      const or: any[] = [{ eventTitle: { [Op.iLike]: `%${q}%` } }];
      if (!Number.isNaN(numericId) && Number.isFinite(numericId)) {
        or.unshift({ id: numericId });
      }
      where[Op.or] = or;
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

    const { rows, count } = await this.eventModel.findAndCountAll({
      where,
      attributes: [
        'id',
        'userId',
        'eventTitle',
        'eventDescription',
        'eventDate',
        'eventTime',
        'location',
        'familyCode',
        'createdBy',
        'status',
        'createdAt',
        'updatedAt',
        'deletedAt',
        'deletedByUserId',
        'deletedByAdminId',
      ] as any,
      order: [['createdAt', 'DESC']] as any,
      limit,
      offset,
    });

    const eventIds = rows
      .map((r: any) => Number(typeof r?.get === 'function' ? r.get('id') : r?.id))
      .filter((n) => Number.isFinite(n) && !Number.isNaN(n) && n > 0);

    const images = eventIds.length
      ? await this.eventImageModel.findAll({
          where: { eventId: eventIds } as any,
          attributes: ['id', 'eventId', 'imageUrl'] as any,
          order: [['id', 'ASC']] as any,
        })
      : [];

    const firstImageByEventId = new Map<number, any>();
    const countByEventId = new Map<number, number>();

    images.forEach((img: any) => {
      const json = typeof img?.toJSON === 'function' ? img.toJSON() : img;
      const eid = Number(json.eventId);
      if (!firstImageByEventId.has(eid)) {
        firstImageByEventId.set(eid, json);
      }
      countByEventId.set(eid, (countByEventId.get(eid) || 0) + 1);
    });

    const data = rows.map((r: any) => {
      const json = typeof r?.toJSON === 'function' ? r.toJSON() : r;
      const eid = Number(json.id);
      const first = firstImageByEventId.get(eid);

      const previewImage = first?.imageUrl ? this.uploadService.getFileUrl(String(first.imageUrl), 'events') : null;

      return {
        ...json,
        previewImage,
        imagesCount: countByEventId.get(eid) || 0,
      };
    });

    return {
      message: 'Events fetched successfully',
      data,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit) || 1,
      },
    };
  }

  async getEventById(actor: any, eventId: number) {
    this.assertActor(actor);

    const id = this.normalizeId(eventId, 'Event');

    const event = await this.eventModel.findOne({
      where: { id },
      attributes: [
        'id',
        'userId',
        'eventTitle',
        'eventDescription',
        'eventDate',
        'eventTime',
        'location',
        'familyCode',
        'createdBy',
        'status',
        'createdAt',
        'updatedAt',
        'deletedAt',
        'deletedByUserId',
        'deletedByAdminId',
      ] as any,
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const images = await this.eventImageModel.findAll({
      where: { eventId: id } as any,
      attributes: ['id', 'eventId', 'imageUrl', 'createdAt'] as any,
      order: [['id', 'ASC']] as any,
    });

    const eventJson: any = typeof (event as any)?.toJSON === 'function' ? (event as any).toJSON() : event;
    const createdBy = Number(eventJson?.createdBy);

    const album = (images || []).map((img: any) => {
      const json = typeof img?.toJSON === 'function' ? img.toJSON() : img;
      const url = json?.imageUrl ? this.uploadService.getFileUrl(String(json.imageUrl), 'events') : null;
      return {
        ...json,
        url,
      };
    });

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
      message: 'Event fetched successfully',
      data: {
        ...eventJson,
        album,
        imagesCount: album.length,
      },
      creator,
    };
  }

  async softDeleteEvent(actor: any, eventId: number) {
    this.assertActor(actor);
    const id = this.normalizeId(eventId, 'Event');

    const event = await this.eventModel.findOne({ where: { id } as any });
    if (!event) throw new NotFoundException('Event not found');

    if ((event as any).deletedAt) {
      return { message: 'Event already deleted' };
    }

    await (event as any).update({
      deletedAt: new Date(),
      deletedByAdminId: Number(actor?.adminId),
      deletedByUserId: null,
    } as any);

    await this.adminAuditLogService.log(Number(actor?.adminId), 'event_soft_delete', {
      targetType: 'event',
      targetId: id,
      metadata: {
        eventId: id,
        createdBy: Number((event as any)?.createdBy),
      },
    });

    return { message: 'Event deleted successfully' };
  }

  async restoreEvent(actor: any, eventId: number) {
    this.assertActor(actor);
    const id = this.normalizeId(eventId, 'Event');

    const event = await this.eventModel.findOne({ where: { id } as any });
    if (!event) throw new NotFoundException('Event not found');

    if (!(event as any).deletedAt) {
      return { message: 'Event is not deleted' };
    }

    await (event as any).update({ deletedAt: null, deletedByAdminId: null, deletedByUserId: null } as any);

    await this.adminAuditLogService.log(Number(actor?.adminId), 'event_restore', {
      targetType: 'event',
      targetId: id,
      metadata: {
        eventId: id,
        createdBy: Number((event as any)?.createdBy),
      },
    });

    return { message: 'Event restored successfully' };
  }

  async purgeEvent(actor: any, eventId: number) {
    this.assertActor(actor);
    const id = this.normalizeId(eventId, 'Event');

    const event = await this.eventModel.findOne({ where: { id } as any });
    if (!event) throw new NotFoundException('Event not found');

    if (!(event as any).deletedAt) {
      throw new ForbiddenException('Event must be soft deleted before it can be purged');
    }

    const createdBy = Number((event as any)?.createdBy);

    try {
      const imgs = await this.eventImageModel.findAll({
        where: { eventId: id } as any,
        attributes: ['id', 'imageUrl'] as any,
      });

      for (const img of imgs || []) {
        const json: any = typeof (img as any)?.toJSON === 'function' ? (img as any).toJSON() : img;
        if (!json?.imageUrl) continue;
        // eslint-disable-next-line no-await-in-loop
        await this.uploadService.deleteFile(String(json.imageUrl), 'events');
      }

      await this.eventImageModel.destroy({ where: { eventId: id } as any });
    } catch (_) {
      // ignore
    }

    await (event as any).destroy();

    await this.adminAuditLogService.log(Number(actor?.adminId), 'event_purge', {
      targetType: 'event',
      targetId: id,
      metadata: {
        eventId: id,
        createdBy,
      },
    });

    return { message: 'Event permanently deleted' };
  }
}
