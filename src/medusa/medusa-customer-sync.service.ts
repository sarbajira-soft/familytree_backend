import { Injectable } from '@nestjs/common';
import * as http from 'http';
import * as https from 'https';

type SyncResponse = {
  customer_id?: string;
  customer?: any;
  orders?: any[];
  order?: any;
  count?: number;
  page?: number;
  limit?: number;
  success?: boolean;
  message?: string;
};

@Injectable()
export class MedusaCustomerSyncService {
  private getBaseUrl(): string {
    const baseUrl = process.env.MEDUSA_RETAIL_URL;

    if (!baseUrl) {
      throw new Error('Missing MEDUSA_RETAIL_URL');
    }
    return baseUrl;
  }

  private async get(url: URL): Promise<SyncResponse> {
    const isHttps = url.protocol === 'https:';

    const requestOptions: https.RequestOptions = {
      method: 'GET',
      hostname: url.hostname,
      port: url.port ? Number(url.port) : isHttps ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      headers: {
        'x-customer-sync-secret': this.getSecret(),
      },
    };

    const transport = isHttps ? https : http;

    return await new Promise((resolve, reject) => {
      const req = transport.request(requestOptions, (res) => {
        res.setEncoding('utf8');

        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });

        res.on('end', () => {
          const status = res.statusCode || 0;

          let parsed: any = {};
          if (raw) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = { message: raw };
            }
          }

          if (status < 200 || status >= 300) {
            const err: any = new Error(
              parsed?.message || `Medusa request failed (${status})`,
            );
            err.statusCode = status;
            err.response = parsed;
            reject(err);
            return;
          }

          resolve(parsed);
        });
      });

      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy(new Error('Medusa request timed out'));
      });

      req.end();
    });
  }

  private getSecret(): string {
    const secret = process.env.MEDUSA_CUSTOMER_SYNC_SECRET;

    if (!secret) {
      throw new Error('Missing MEDUSA_CUSTOMER_SYNC_SECRET');
    }

    return secret;
  }

  async upsertCustomer(payload: Record<string, unknown>): Promise<SyncResponse> {
    return await this.post(payload);
  }

  async updatePassword(email: string, password: string): Promise<SyncResponse> {
    return await this.post({ type: 'password', email, password });
  }

  async retrieveCustomer(customerId: string): Promise<SyncResponse> {
    const id = String(customerId || '').trim();
    if (!id) {
      throw new Error('Missing customerId');
    }

    const url = new URL(
      `/admin/customer-sync/customer/${encodeURIComponent(id)}`,
      this.getBaseUrl(),
    );
    return await this.get(url);
  }

  async deleteCustomer(customerId: string): Promise<SyncResponse> {
    const id = String(customerId || '').trim();
    if (!id) {
      throw new Error('Missing customerId');
    }

    return await this.post({ type: 'delete_customer', customer_id: id });
  }

  async listAllOrders(params?: {
    page?: number;
    limit?: number;
    q?: string;
    status?: string;
    payment?: string;
    fulfillment?: string;
  }): Promise<SyncResponse> {
    const page = Math.max(1, Number(params?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params?.limit || 25)));

    const url = new URL('/admin/customer-sync/orders/all', this.getBaseUrl());
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(limit));

    if (params?.q) url.searchParams.set('q', String(params.q));
    if (params?.status) url.searchParams.set('status', String(params.status));
    if (params?.payment) url.searchParams.set('payment', String(params.payment));
    if (params?.fulfillment) url.searchParams.set('fulfillment', String(params.fulfillment));

    return await this.get(url);
  }

  async listOrdersByCustomerId(
    customerId: string,
    params?: { page?: number; limit?: number },
  ): Promise<SyncResponse> {
    const id = String(customerId || '').trim();
    if (!id) {
      throw new Error('Missing customerId');
    }

    const page = Math.max(1, Number(params?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params?.limit || 25)));

    const url = new URL('/admin/customer-sync/orders', this.getBaseUrl());
    url.searchParams.set('customer_id', id);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(limit));

    return await this.get(url);
  }

  async retrieveOrder(orderId: string): Promise<SyncResponse> {
    const id = String(orderId || '').trim();
    if (!id) {
      throw new Error('Missing orderId');
    }

    const url = new URL(
      `/admin/customer-sync/orders/${encodeURIComponent(id)}`,
      this.getBaseUrl(),
    );
    return await this.get(url);
  }

  private async post(body: Record<string, unknown>): Promise<SyncResponse> {
    const url = new URL('/admin/customer-sync', this.getBaseUrl());
    const isHttps = url.protocol === 'https:';

    const bodyString = JSON.stringify(body);

    const requestOptions: https.RequestOptions = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port
        ? Number(url.port)
        : isHttps
          ? 443
          : 80,
      path: `${url.pathname}${url.search}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString),
        'x-customer-sync-secret': this.getSecret(),
      },
    };

    const transport = isHttps ? https : http;

    return await new Promise((resolve, reject) => {
      const req = transport.request(requestOptions, (res) => {
        res.setEncoding('utf8');

        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });

        res.on('end', () => {
          const status = res.statusCode || 0;

          let parsed: any = {};
          if (raw) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = { message: raw };
            }
          }

          if (status < 200 || status >= 300) {
            const err: any = new Error(
              parsed?.message || `Medusa customer sync failed (${status})`,
            );
            err.statusCode = status;
            err.response = parsed;
            reject(err);
            return;
          }

          resolve(parsed);
        });
      });

      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy(new Error('Medusa customer sync request timed out'));
      });

      req.write(bodyString);
      req.end();
    });
  }
}
