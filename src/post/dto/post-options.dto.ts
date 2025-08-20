import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsIn, IsNumber, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class GetPostByOptionsDto {
  @ApiPropertyOptional({ enum: ['public', 'private', 'family'] })
  @IsOptional()
  @IsIn(['public', 'private', 'family'])
  privacy?: 'public' | 'private' | 'family';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  familyCode?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  createdBy?: number;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  postId?: number;

  @ApiPropertyOptional({ description: 'Search by caption (partial match)' })
  @IsOptional()
  @IsString()
  caption?: string;
} 
