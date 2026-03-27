import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAdminGalleryDto {
  @ApiPropertyOptional({ example: 'Updated gallery title' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  galleryTitle?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  galleryDescription?: string;

  @ApiPropertyOptional({ example: 'true', description: 'Set to true to remove existing cover photo' })
  @IsOptional()
  @IsBooleanString()
  removeCover?: string;

  @ApiPropertyOptional({
    description: 'Array of gallery album image IDs to remove (multipart form-data; can be repeated fields)',
    type: [Number],
    example: [1, 2, 3],
  })
  @IsOptional()
  removedImageIds?: any;
}
