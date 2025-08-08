// src/common/upload/upload.service.ts
import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, ObjectCannedACL  } from '@aws-sdk/client-s3';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';

@Injectable()
export class UploadService {
  private s3: S3Client;

  constructor() {
    this.s3 = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }

  async uploadFile(file: Express.Multer.File, folder: string): Promise<string> {
    const fileExt = extname(file.originalname);
    const fileName = `${folder}/${uuid()}${fileExt}`;

    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    await this.s3.send(new PutObjectCommand(uploadParams));

    return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
  }
}
