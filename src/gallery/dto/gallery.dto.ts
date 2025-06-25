import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateGalleryDto {
  @ApiProperty({
    example: 'Summer Vacation',
    description: 'Title of the gallery',
  })
  @IsString()
  @IsNotEmpty()
  galleryTitle: string;

  @ApiPropertyOptional({
    example: 'Trip to Goa with family',
    description: 'Optional description of the gallery',
  })
  @IsOptional()
  @IsString()
  galleryDescription?: string;

  @ApiPropertyOptional({
    description: 'Cover photo for the gallery (single file)',
    type: 'string',
    format: 'binary',
  })
  @IsOptional()
  coverPhoto?: Express.Multer.File;

  @ApiProperty({
    example: 'FAM123456',
    description: 'Family code to associate this gallery with',
  })
  @IsString()
  @IsNotEmpty()
  familyCode: string;

  @ApiProperty({
    example: 42,
    description: 'User ID of the creator',
  })
  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  createdBy: number;

  @ApiPropertyOptional({
    example: 'private',
    description: 'Privacy setting for the gallery',
    enum: ['public', 'private', 'family'],
    default: 'public',
  })
  @IsOptional()
  @IsIn(['public', 'private', 'family'])
  privacy?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Status of the gallery (1 = active, 0 = inactive)',
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  status?: number;

  @ApiPropertyOptional({
    description: 'Album images (multiple files)',
    type: 'array',
    items: {
      type: 'string',
      format: 'binary',
    },
  })
  @IsOptional()
  images?: Express.Multer.File[];
}
