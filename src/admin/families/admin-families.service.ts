import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { AdminAuditLogService } from '../admin-audit-log.service';
import { Family } from '../../family/model/family.model';
import { FamilyMember } from '../../family/model/family-member.model';
import { FamilyTree } from '../../family/model/family-tree.model';
import { Event } from '../../event/model/event.model';
import { Gallery } from '../../gallery/model/gallery.model';
import { Post } from '../../post/model/post.model';
import { User } from '../../user/model/user.model';
import { UserProfile } from '../../user/model/user-profile.model';
import { UploadService } from '../../uploads/upload.service';

@Injectable()
export class AdminFamiliesService {
  constructor(
    @InjectModel(Family)
    private readonly familyModel: typeof Family,
    @InjectModel(FamilyMember)
    private readonly familyMemberModel: typeof FamilyMember,
    @InjectModel(FamilyTree)
    private readonly familyTreeModel: typeof FamilyTree,
    @InjectModel(Post)
    private readonly postModel: typeof Post,
    @InjectModel(Gallery)
    private readonly galleryModel: typeof Gallery,
    @InjectModel(Event)
    private readonly eventModel: typeof Event,
    @InjectModel(User)
    private readonly userModel: typeof User,
    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,
    private readonly uploadService: UploadService,
    private readonly sequelize: Sequelize,
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

  async getFamiliesStats(actor: any) {
    this.assertActor(actor);

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const last7Days = new Date(now);
    last7Days.setDate(last7Days.getDate() - 7);

    const [totalFamilies, totalActiveFamilies, totalInactiveFamilies, familiesToday, familiesLast7Days] = await Promise.all([
      this.familyModel.count(),
      this.familyModel.count({ where: { status: 1 } as any }),
      this.familyModel.count({ where: { status: 0 } as any }),
      this.familyModel.count({ where: { createdAt: { [Op.between]: [startOfToday, endOfToday] } } as any }),
      this.familyModel.count({ where: { createdAt: { [Op.gte]: last7Days } } as any }),
    ]);

    return {
      message: 'Families stats fetched successfully',
      data: {
        totalFamilies,
        totalActiveFamilies,
        totalInactiveFamilies,
        familiesToday,
        familiesLast7Days,
        reportedFamilies: 0,
      },
    };
  }

  async listFamilies(
    actor: any,
    params?: {
      page?: number;
      limit?: number;
      q?: string;
      status?: number;
      createdBy?: number;
      from?: string;
      to?: string;
    },
  ) {
    this.assertActor(actor);

    const page = Math.max(1, Number(params?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params?.limit || 25)));
    const offset = (page - 1) * limit;

    const q = String(params?.q || '').trim();
    const from = String(params?.from || '').trim();
    const to = String(params?.to || '').trim();

    const where: any = {};

    if (params?.status === 0 || params?.status === 1) {
      where.status = params.status;
    }

    if (Number.isFinite(Number(params?.createdBy)) && Number(params?.createdBy) > 0) {
      where.createdBy = Number(params.createdBy);
    }

    if (q) {
      const numericId = Number(q);
      const upper = q.toUpperCase();
      const or: any[] = [
        { familyName: { [Op.iLike]: `%${q}%` } },
        { familyCode: { [Op.iLike]: `%${upper}%` } },
      ];
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

    const { rows, count } = await this.familyModel.findAndCountAll({
      where,
      attributes: ['id', 'familyName', 'familyBio', 'familyPhoto', 'familyCode', 'status', 'createdBy', 'createdAt', 'updatedAt'] as any,
      order: [['createdAt', 'DESC']] as any,
      limit,
      offset,
    });

    const codes = rows
      .map((r: any) => String(typeof r?.get === 'function' ? r.get('familyCode') : r?.familyCode))
      .filter(Boolean);

    const members = codes.length
      ? await this.familyMemberModel.findAll({
          where: { familyCode: { [Op.in]: codes } } as any,
          attributes: ['familyCode', 'memberId', 'approveStatus'] as any,
        })
      : [];

    const memberCounts = new Map<string, number>();
    for (const m of members as any[]) {
      const json = typeof (m as any)?.toJSON === 'function' ? (m as any).toJSON() : m;
      const code = String(json.familyCode || '').trim();
      if (!code) continue;
      memberCounts.set(code, (memberCounts.get(code) || 0) + 1);
    }

    const data = rows.map((r: any) => {
      const json = typeof r?.toJSON === 'function' ? r.toJSON() : r;
      return {
        ...json,
        familyPhoto: json?.familyPhoto ? this.uploadService.getFileUrl(String(json.familyPhoto), 'family') : null,
        membersCount: memberCounts.get(String(json?.familyCode || '').trim()) || 0,
      };
    });

    return {
      message: 'Families fetched successfully',
      data,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit) || 1,
      },
    };
  }

  async getFamilyById(actor: any, familyId: number) {
    this.assertActor(actor);

    const id = this.normalizeId(familyId, 'Family');

    const family = await this.familyModel.findOne({
      where: { id },
      attributes: ['id', 'familyName', 'familyBio', 'familyPhoto', 'familyCode', 'status', 'createdBy', 'createdAt', 'updatedAt'] as any,
    });

    if (!family) {
      throw new NotFoundException('Family not found');
    }

    const familyJson: any = typeof (family as any)?.toJSON === 'function' ? (family as any).toJSON() : family;
    const createdBy = Number(familyJson?.createdBy);

    const membersCount = await this.familyMemberModel.count({ where: { familyCode: familyJson.familyCode } as any });

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
      message: 'Family fetched successfully',
      data: {
        ...familyJson,
        familyPhoto: familyJson?.familyPhoto ? this.uploadService.getFileUrl(String(familyJson.familyPhoto), 'family') : null,
        membersCount,
      },
      creator,
    };
  }

  async getFamilyMembers(actor: any, familyId: number) {
    this.assertActor(actor);

    const id = this.normalizeId(familyId, 'Family');

    const family = await this.familyModel.findOne({
      where: { id },
      attributes: ['id', 'familyCode'] as any,
    });

    if (!family) {
      throw new NotFoundException('Family not found');
    }

    const familyJson: any = typeof (family as any)?.toJSON === 'function' ? (family as any).toJSON() : family;
    const familyCode = String(familyJson?.familyCode || '').trim();
    if (!familyCode) {
      return { message: 'Family members fetched successfully', data: [] };
    }

    const memberLinks = await this.familyMemberModel.findAll({
      where: { familyCode } as any,
      attributes: ['memberId', 'approveStatus', 'isLinkedUsed', 'creatorId', 'familyCode', 'createdAt', 'updatedAt'] as any,
      order: [['createdAt', 'DESC']] as any,
    });

    const memberIds = (memberLinks as any[])
      .map((m: any) => {
        const json = typeof m?.toJSON === 'function' ? m.toJSON() : m;
        return Number(json?.memberId);
      })
      .filter((v: number) => Number.isFinite(v) && !Number.isNaN(v) && v > 0);

    const users = memberIds.length
      ? await this.userModel.findAll({
          where: { id: { [Op.in]: memberIds } } as any,
          include: [
            {
              model: this.userProfileModel,
              as: 'userProfile',
              required: false,
              attributes: ['id', 'userId', 'firstName', 'lastName', 'profile', 'familyCode'] as any,
            },
          ],
          attributes: ['id', 'email', 'countryCode', 'mobile', 'status', 'role', 'isAppUser', 'createdAt', 'updatedAt'] as any,
        })
      : [];

    const userById = new Map<number, any>();
    for (const u of users as any[]) {
      const json = typeof u?.toJSON === 'function' ? u.toJSON() : u;
      const uid = Number(json?.id);
      if (Number.isFinite(uid) && !Number.isNaN(uid) && uid > 0) userById.set(uid, json);
    }

    const data = (memberLinks as any[]).map((m: any) => {
      const json = typeof m?.toJSON === 'function' ? m.toJSON() : m;
      const uid = Number(json?.memberId);
      return {
        ...json,
        user: userById.get(uid) || null,
      };
    });

    return {
      message: 'Family members fetched successfully',
      data,
    };
  }

  async deleteFamily(actor: any, familyId: number) {
    this.assertActor(actor);
    const id = this.normalizeId(familyId, 'Family');

    const family = await this.familyModel.findOne({
      where: { id } as any,
      attributes: ['id', 'familyName', 'familyPhoto', 'familyCode', 'createdBy'] as any,
    });
    if (!family) {
      throw new NotFoundException('Family not found');
    }

    const familyJson: any = typeof (family as any)?.toJSON === 'function' ? (family as any).toJSON() : family;
    const familyCode = String(familyJson?.familyCode || '').trim();
    if (!familyCode) {
      throw new NotFoundException('Family not found');
    }

    const transaction = await this.sequelize.transaction();
    try {
      const now = new Date();

      const memberLinks = await this.familyMemberModel.findAll({
        where: { familyCode } as any,
        attributes: ['memberId', 'approveStatus'] as any,
        transaction,
      });
      const memberIds = Array.from(
        new Set(
          (memberLinks as any[])
            .map((m: any) => Number(typeof m?.get === 'function' ? m.get('memberId') : m?.memberId))
            .filter((v: number) => Number.isFinite(v) && !Number.isNaN(v) && v > 0),
        ),
      );

      const users = memberIds.length
        ? await this.userModel.findAll({
            where: { id: { [Op.in]: memberIds } } as any,
            attributes: ['id', 'isAppUser'] as any,
            transaction,
          })
        : [];
      const isAppUserById = new Map<number, boolean>();
      (users as any[]).forEach((u: any) => {
        const json = typeof u?.toJSON === 'function' ? u.toJSON() : u;
        isAppUserById.set(Number(json?.id), Boolean(json?.isAppUser));
      });

      const treeDummyRows = await this.familyTreeModel.findAll({
        where: { familyCode, userId: { [Op.ne]: null } } as any,
        attributes: ['userId'] as any,
        include: [
          {
            model: this.userModel,
            as: 'user',
            required: true,
            where: { isAppUser: false } as any,
            attributes: ['id', 'isAppUser'] as any,
          },
        ] as any,
        transaction,
      });
      const dummyUserIds = Array.from(
        new Set(
          (treeDummyRows as any[])
            .map((r: any) => Number(typeof r?.get === 'function' ? r.get('userId') : r?.userId))
            .filter((v: number) => Number.isFinite(v) && !Number.isNaN(v) && v > 0),
        ),
      );

      if (memberIds.length > 0) {
        await this.familyMemberModel.update(
          {
            approveStatus: 'removed',
            removedAt: now,
            removedBy: null,
          } as any,
          { where: { familyCode } as any, transaction },
        );

        const profiles = await this.userProfileModel.findAll({
          where: { userId: { [Op.in]: memberIds } } as any,
          attributes: ['userId', 'familyCode', 'associatedFamilyCodes'] as any,
          transaction,
        });

        for (const p of profiles as any[]) {
          const json = typeof p?.toJSON === 'function' ? p.toJSON() : p;
          const uid = Number(json?.userId);
          const isApp = isAppUserById.get(uid);
          if (!isApp) continue;

          const associated = Array.isArray(json?.associatedFamilyCodes) ? json.associatedFamilyCodes : [];
          const nextAssociated = associated.filter((code: any) => code && String(code).trim() !== familyCode);
          const shouldClearPrimary = String(json?.familyCode || '').trim() === familyCode;
          if (shouldClearPrimary || nextAssociated.length !== associated.length) {
            await this.userProfileModel.update(
              {
                ...(shouldClearPrimary ? { familyCode: null } : {}),
                associatedFamilyCodes: nextAssociated,
              } as any,
              { where: { userId: uid } as any, transaction },
            );
          }
        }
      }

      await this.postModel.update(
        { deletedAt: now, deletedByAdminId: Number(actor?.adminId), deletedByUserId: null } as any,
        { where: { familyCode, deletedAt: null } as any, transaction },
      );
      await this.galleryModel.update(
        { deletedAt: now, deletedByAdminId: Number(actor?.adminId), deletedByUserId: null } as any,
        { where: { familyCode, deletedAt: null } as any, transaction },
      );
      await this.eventModel.update(
        { deletedAt: now, deletedByAdminId: Number(actor?.adminId), deletedByUserId: null } as any,
        { where: { familyCode, deletedAt: null } as any, transaction },
      );

      await this.familyTreeModel.destroy({ where: { familyCode } as any, transaction });
      await this.familyMemberModel.destroy({ where: { familyCode } as any, transaction });

      for (const dummyId of dummyUserIds) {
        const stillUsed = await this.familyTreeModel.count({
          where: { userId: dummyId } as any,
          transaction,
        });
        if (stillUsed > 0) continue;

        await this.userProfileModel.destroy({ where: { userId: dummyId } as any, transaction });
        await this.userModel.destroy({ where: { id: dummyId, isAppUser: false } as any, transaction });
      }

      await (family as any).destroy({ transaction } as any);

      await transaction.commit();

      if (familyJson?.familyPhoto) {
        try {
          await this.uploadService.deleteFile(String(familyJson.familyPhoto), 'family');
        } catch (_) {
          // ignore
        }
      }

      await this.adminAuditLogService.log(Number(actor?.adminId), 'family_delete', {
        targetType: 'family',
        targetId: id,
        metadata: {
          familyId: id,
          familyCode,
          createdBy: Number(familyJson?.createdBy),
          appUsersUnlinked: memberIds.filter((uid) => Boolean(isAppUserById.get(uid))).length,
          dummyUsersDeleted: dummyUserIds.length,
        },
      });

      return {
        message: 'Family deleted successfully',
        data: {
          familyId: id,
          familyCode,
          dummyUsersDeleted: dummyUserIds.length,
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}
