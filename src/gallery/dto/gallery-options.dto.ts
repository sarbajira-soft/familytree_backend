import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsIn, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class GetGalleryByOptionsDto {
  @ApiPropertyOptional({ enum: ['public', 'private', 'family'], default: 'public' })
  @IsOptional()
  @IsIn(['public', 'private', 'family'])
  privacy?: string;

  @ApiPropertyOptional({ description: 'Family code for private/family galleries' })
  @IsOptional()
  @IsString()
  familyCode?: string;
   
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  createdBy?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  galleryId?: number;

  @ApiPropertyOptional({ description: 'Search Gallery Title' })
  @IsOptional()
  @IsString()
  galleryTitle?: string;

}
