import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { AdminAuditLog } from './model/admin-audit-log.model';

export type AdminAuditTargetType =
  | 'admin_account'
  | 'admin_auth'
  | 'system'
  | string;

@Injectable()
export class AdminAuditLogService {
  constructor(
    @InjectModel(AdminAuditLog)
    private readonly adminAuditLogModel: typeof AdminAuditLog,
  ) {}

  async fetchOwnLogs(adminId: number, page = 1, limit = 25) {
    const safePage = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
    const safeLimit = Number.isFinite(Number(limit)) ? Math.min(100, Math.max(1, Number(limit))) : 25;
    const offset = (safePage - 1) * safeLimit;

    const { rows, count } = await this.adminAuditLogModel.findAndCountAll({
      where: { adminId },
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit: safeLimit,
      offset,
    });

    return {
      total: count,
      page: safePage,
      limit: safeLimit,
      data: rows,
    };
  }

  async fetchAllLogs(page = 1, limit = 25) {
    const safePage = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
    const safeLimit = Number.isFinite(Number(limit)) ? Math.min(100, Math.max(1, Number(limit))) : 25;
    const offset = (safePage - 1) * safeLimit;

    const { rows, count } = await this.adminAuditLogModel.findAndCountAll({
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit: safeLimit,
      offset,
    });

    return {
      total: count,
      page: safePage,
      limit: safeLimit,
      data: rows,
    };
  }

  async log(
    actorAdminId: number,
    action: string,
    options?: {
      targetType?: AdminAuditTargetType;
      targetId?: number;
      metadata?: any;
    },
  ) {
    if (!actorAdminId || !action) return;

    try {
      await this.adminAuditLogModel.create({
        adminId: actorAdminId,
        action,
        targetType: options?.targetType,
        targetId: options?.targetId,
        metadata: options?.metadata,
      } as any);
    } catch (_) {
      // Intentionally swallow audit log errors
      // to avoid blocking the primary admin action.
    }
  }
}
