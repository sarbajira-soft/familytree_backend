// src/common/upload/upload.service.ts
import { Injectable } from '@nestjs/common';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  ListPartsCommand,
  S3Client,
  PutObjectCommand,
  UploadPartCommand,
  type CompletedPart,
  type ListPartsCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';

@Injectable()
export class UploadService {
  private s3: S3Client;

  constructor() {
    this.s3 = new S3Client({
      region: process.env.REGION,
      credentials: {
        accessKeyId: process.env.ACCESS_KEY_ID,
        secretAccessKey: process.env.SECRET_ACCESS_KEY,
      },
    });
  }

  async createMultipartUpload(
    originalFileName: string,
    contentType: string,
    folder: string,
  ): Promise<{ uploadId: string; key: string; fileName: string }> {
    const fileExt = extname(originalFileName);
    const fileName = `${uuid()}${fileExt}`;
    const key = `${folder}/${fileName}`;

    const res = await this.s3.send(
      new CreateMultipartUploadCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
      }),
    );

    return {
      uploadId: res.UploadId,
      key,
      fileName,
    };
  }

  async getPresignedUploadPartUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds: number = 60 * 10,
  ): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    return getSignedUrl(this.s3, command, {
      expiresIn: expiresInSeconds,
    });
  }

  async listMultipartUploadParts(
    key: string,
    uploadId: string,
  ): Promise<{
    uploadId: string;
    key: string;
    parts: { PartNumber: number; ETag: string; Size?: number }[];
  }> {
    const res: ListPartsCommandOutput = await this.s3.send(
      new ListPartsCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
      }),
    );

    return {
      uploadId,
      key,
      parts:
        res.Parts?.map((p) => ({
          PartNumber: p.PartNumber,
          ETag: p.ETag,
          Size: p.Size,
        })) || [],
    };
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { PartNumber: number; ETag: string }[],
  ): Promise<{ key: string; fileName: string; location?: string }> {
    const completed: CompletedPart[] = parts
      .slice()
      .sort((a, b) => a.PartNumber - b.PartNumber)
      .map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag }));

    const res = await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: completed,
        },
      }),
    );

    return {
      key,
      fileName: key.split('/').pop() || key,
      location: res.Location,
    };
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<boolean> {
    await this.s3.send(
      new AbortMultipartUploadCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
      }),
    );
    return true;
  }

  async uploadFile(file: Express.Multer.File, folder: string): Promise<string> {
    const fileExt = extname(file.originalname);
    const fileName = `${uuid()}${fileExt}`;
    const s3Key = `${folder}/${fileName}`;

    console.log('Uploading file to S3:', {
      originalName: file.originalname,
      fileName,
      s3Key,
      bucket: process.env.S3_BUCKET_NAME,
      folder
    });

    const uploadParams = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    await this.s3.send(new PutObjectCommand(uploadParams));
    console.log('Successfully uploaded file to S3:', s3Key);

    // Return only the filename without any path
    return fileName.split('/').pop() || fileName;
  }

  getFileUrl(fileName: string, folder: string = 'profile'): string {
    if (!fileName) return '';
    // If it's already a full URL, return as is
    if (fileName.startsWith('http')) {
      // Clean up any duplicate path segments
      const url = new URL(fileName);
      const pathParts = url.pathname.split('/').filter(part => part && part !== folder);
      url.pathname = `${folder}/${pathParts.pop()}`;
      return url.toString();
    }
    
    // Remove any existing folder prefix from the filename
    const cleanFileName = fileName.includes('/') 
      ? fileName.split('/').pop() 
      : fileName;
      
    // Construct the clean URL
    return `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.REGION}.amazonaws.com/${folder}/${cleanFileName}`;
  }

  async deleteFile(fileName: string, folder: string = 'profile'): Promise<boolean> {
    if (!fileName || fileName.trim() === '') {
      console.log('No filename provided for deletion');
      return false;
    }

    try {
      let key: string;

      // If it's a full URL, extract the key
      if (fileName.startsWith('http')) {
        const url = new URL(fileName);
        // Remove the leading '/' and any query parameters
        key = url.pathname.substring(1).split('?')[0];
        console.log('Extracted key from URL:', { original: fileName, extractedKey: key });
      } else {
        // If it's just a filename, add the folder prefix if not already present
        key = fileName.includes('/') ? fileName : `${folder}/${fileName}`;
        // Ensure we don't have double slashes
        key = key.replace(/\/\//g, '/');
      }

      console.log('Attempting to delete S3 object with key:', {
        originalFileName: fileName,
        folder,
        finalKey: key,
        bucket: process.env.S3_BUCKET_NAME,
        timestamp: new Date().toISOString()
      });
      
      const deleteParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
      };

      try {
        const command = new DeleteObjectCommand(deleteParams);
        const response = await this.s3.send(command);
        
        // Check if the delete was successful
        const success = response.DeleteMarker || response.VersionId;
        
        console.log('S3 delete response:', {
          key,
          success,
          response,
          timestamp: new Date().toISOString()
        });
        
        return !!success;
      } catch (s3Error) {
        if (s3Error.name === 'NoSuchKey') {
          console.log('File not found in S3, nothing to delete:', key);
          return true; // Consider it successful if the file doesn't exist
        }
        throw s3Error; // Re-throw other S3 errors
      }
      
    } catch (error) {
      console.error('Error deleting file from S3:', {
        fileName,
        folder,
        error: error.message,
        name: error.name,
        code: error.code,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      return false;
    }
  }
}
