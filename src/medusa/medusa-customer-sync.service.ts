import { Injectable } from '@nestjs/common';
import * as http from 'http';
import * as https from 'https';

type SyncResponse = {
  customer_id?: string;
  customer?: any;
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
