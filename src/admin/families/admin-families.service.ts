import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { Family } from '../../family/model/family.model';
import { FamilyMember } from '../../family/model/family-member.model';
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
}
