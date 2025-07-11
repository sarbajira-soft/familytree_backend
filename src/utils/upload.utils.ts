import { extname } from 'path';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export const generateFileName = (originalName: string): string => {
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const ext = extname(originalName);
  return `FT-${uniqueSuffix}${ext}`;
};

export const imageFileFilter = (req, file, callback) => {
  if (
    file.mimetype.match(/^image\/(jpeg|png|jpg)$/) ||
    file.mimetype === 'application/pdf'
  ) {
    callback(null, true);
  } else {
    return callback(new BadRequestException('Only image (jpeg, png, jpg) or PDF files are allowed'), false);
  }
};

export const saveBase64Image = async (base64Data: string, uploadPath: string): Promise<string> => {
  try {
    // Check if it's a valid base64 image
    if (!base64Data.startsWith('data:image/')) {
      throw new Error('Invalid base64 image format');
    }

    // Extract mime type and base64 data
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid base64 image format');
    }

    const mimeType = matches[1];
    const base64String = matches[2];
    const buffer = Buffer.from(base64String, 'base64');

    // Determine file extension
    let extension = '.jpg';
    if (mimeType.includes('png')) extension = '.png';
    else if (mimeType.includes('jpeg')) extension = '.jpg';
    else if (mimeType.includes('gif')) extension = '.gif';
    else if (mimeType.includes('webp')) extension = '.webp';

    // Generate filename
    const filename = generateFileName(`profile${extension}`);

    // Ensure upload directory exists
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    // Save file
    const filePath = path.join(uploadPath, filename);
    fs.writeFileSync(filePath, buffer);

    return filename;
  } catch (error) {
    throw new BadRequestException(`Failed to save base64 image: ${error.message}`);
  }
};
