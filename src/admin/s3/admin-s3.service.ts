import { Injectable } from '@nestjs/common';
import { UploadService } from '../../uploads/upload.service';

@Injectable()
export class AdminS3Service {
  constructor(private readonly uploadService: UploadService) {}

  listFolders(prefix?: string) {
    return this.uploadService.listFolders(prefix || '');
  }

  listObjects(params?: { prefix?: string; maxKeys?: number; continuationToken?: string }) {
    return this.uploadService.listObjects(params);
  }

  async deleteObject(key: string) {
    const cleaned = String(key || '').trim().replace(/^\//, '');
    // Pass full key so UploadService does not add a folder prefix
    const ok = await this.uploadService.deleteFile(cleaned, '__raw__');
    return { message: ok ? 'Object deleted' : 'Delete failed', key: cleaned, success: !!ok };
  }
}
