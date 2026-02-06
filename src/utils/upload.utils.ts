import { extname, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { BadRequestException } from '@nestjs/common';

export const generateFileName = (originalName: string): string => {
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const ext = extname(originalName);
  return `FT-${uniqueSuffix}${ext}`;
};

export const imageFileFilter = (req, file, callback) => {
  if (file.mimetype.match(/^image\/(jpeg|png|jpg|gif)$/)) {
    callback(null, true);
  } else {
    return callback(
      new BadRequestException('Only image files (jpeg, png, jpg, gif) are allowed'),
      false,
    );
  }
};

export const saveBase64Image = async (base64Data: string, uploadPath: string): Promise<string> => {
  try {
    // Check if it's a valid base64 image
    if (!base64Data.startsWith('data:image/')) {
      throw new Error('Invalid base64 image format');
    }

    // Extract mime type and base64 data
    const matches = base64Data.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (matches?.length !== 3) {
      throw new Error('Invalid base64 image format');
    }

    const mimeType = matches[1];
    const base64String = matches[2];
    const buffer = Buffer.from(base64String, 'base64');

    // Determine file extension
    let extension = '.jpg';
    if (mimeType.includes('png')) extension = '.png';
    else if (mimeType.includes('gif')) extension = '.gif';
    else if (mimeType.includes('webp')) extension = '.webp';

    // Generate filename
    const filename = generateFileName(`profile${extension}`);

    // Ensure upload directory exists
    if (!existsSync(uploadPath)) {
      mkdirSync(uploadPath, { recursive: true });
    }

    // Save file
    const filePath = join(uploadPath, filename);
    writeFileSync(filePath, buffer);

    return filename;
  } catch (error) {
    throw new BadRequestException(`Failed to save base64 image: ${error.message}`);
  }
};
