// src/common/upload/upload.service.ts
import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand, ObjectCannedACL  } from '@aws-sdk/client-s3';
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
    const fileName = `${uuid()}${fileExt}`; // Remove folder from the stored filename
    const s3Key = `${folder}/${fileName}`; // But keep folder in S3 path

    console.log('Uploading file to S3:', {
      originalName: file.originalname,
      fileName,
      s3Key,
      bucket: process.env.AWS_S3_BUCKET_NAME,
      folder
    });

    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: s3Key, // Use the full path with folder for S3
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    await this.s3.send(new PutObjectCommand(uploadParams));
    console.log('Successfully uploaded file to S3:', s3Key);

    // Return only the filename without the folder prefix
    return fileName;
  }

  getFileUrl(fileName: string, folder: string = 'profile'): string {
    if (!fileName) return '';
    // If it's already a full URL, return as is
    if (fileName.startsWith('http')) {
      return fileName;
    }
    // Add folder prefix if not already present
    const s3Key = fileName.includes('/') ? fileName : `${folder}/${fileName}`;
    // Construct the full URL
    return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
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
        bucket: process.env.AWS_S3_BUCKET_NAME,
        timestamp: new Date().toISOString()
      });
      
      const deleteParams = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
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
