import { extname } from 'path';
import { BadRequestException } from '@nestjs/common';

export const generateFileName = (originalName: string): string => {
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const ext = extname(originalName);
  return `FT-${uniqueSuffix}${ext}`;
};

export const imageFileFilter = (req, file, callback) => {
  if (!file.mimetype.match(/^image\/(jpeg|png|jpg)$/)) {
    return callback(new BadRequestException('Only image files are allowed'), false);
  }
  callback(null, true);
};
