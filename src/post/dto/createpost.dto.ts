import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreatePostDto {
  @ApiPropertyOptional({ example: 'My new post' })
  @IsString()
  @IsOptional()
  caption?: string;

  @ApiPropertyOptional({
    example: 'FAM123',
    description:
      'Optional. If omitted, backend derives from creator’s profile when privacy is "private" or "family".',
  })
  @IsString()
  @IsOptional()
  familyCode?: string;

  @ApiProperty({ example: 'public', enum: ['public', 'private', 'family'] })
  @IsIn(['public', 'private', 'family'])
  privacy: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  status?: number;

  @ApiPropertyOptional({
    description: 'Post image (file)',
    type: 'string',
    format: 'binary',
  })
  @IsOptional()
  postImage?: string;

  @ApiPropertyOptional({
    description: 'Post video (mp4). Provide a filename or URL after multipart upload',
    type: 'string',
  })
  @IsOptional()
  postVideo?: string;
} 
