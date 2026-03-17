import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { MedusaCustomerSyncService } from '../../medusa/medusa-customer-sync.service';
import { User } from '../../user/model/user.model';

@Injectable()
export class AdminRetailService {
  constructor(
    private readonly medusaCustomerSyncService: MedusaCustomerSyncService,
    @InjectModel(User)
    private readonly userModel: typeof User,
  ) {}

  private assertActor(actor: any) {
    if (!actor) {
      throw new NotFoundException('Unauthorized');
    }
  }

  async listOrders(
    actor: any,
    params: {
      page?: number;
      limit?: number;
      q?: string;
      status?: string;
      payment?: string;
      fulfillment?: string;
    },
  ) {
    this.assertActor(actor);

    const page = Math.max(1, Number(params?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params?.limit || 25)));

    try {
      const res: any = await this.medusaCustomerSyncService.listAllOrders({
        page,
        limit,
        q: params?.q,
        status: params?.status,
        payment: params?.payment,
        fulfillment: params?.fulfillment,
      });

      const orders = Array.isArray(res?.orders) ? [...res.orders] : [];
      orders.sort((a, b) => {
        const da = a?.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b?.created_at ? new Date(b.created_at).getTime() : 0;
        return db - da;
      });

      const total = typeof res?.count === 'number' ? Number(res.count) : orders.length;

      return {
        message: 'Medusa orders fetched successfully',
        data: orders,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      };
    } catch (e: any) {
      const msg = String(e?.message || '').trim();
      return {
        message: msg || 'Failed to fetch Medusa orders',
        data: [],
        pagination: { page, limit, total: 0, totalPages: 1 },
      };
    }
  }

  async getOrder(actor: any, orderId: string) {
    this.assertActor(actor);

    const oid = String(orderId || '').trim();
    if (!oid) {
      throw new NotFoundException('Order not found');
    }

    try {
      const res = await this.medusaCustomerSyncService.retrieveOrder(oid);
      const order = (res as any)?.order || null;

      let familyssUserId: number | null = null;
      try {
        const medusaCustomerId = String(order?.customer_id || '').trim();
        if (medusaCustomerId) {
          const user = await this.userModel.findOne({
            where: { medusaCustomerId } as any,
            attributes: ['id'] as any,
          });
          familyssUserId = user ? Number((user as any).id) : null;
        }
      } catch {
        familyssUserId = null;
      }

      return {
        message: 'Medusa order fetched successfully',
        data: order ? { ...order, familyss_user_id: familyssUserId } : null,
      };
    } catch (e: any) {
      const status = Number(e?.statusCode || e?.status || 0);
      const msg = String(e?.message || '').trim();

      if (status === 404 || msg.toLowerCase().includes('not found')) {
        return {
          message: 'Medusa order not found',
          data: null,
          notFound: true,
        } as any;
      }

      return {
        message: msg || 'Failed to fetch Medusa order',
        data: null,
      };
    }
  }
}
