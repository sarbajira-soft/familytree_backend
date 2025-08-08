import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

export class CreatePostDto {
  @ApiProperty({ example: 'My new post' })
  @IsString()
  @IsNotEmpty()
  caption: string;

  @ApiProperty({ 
    example: 'FAM123',
    description: 'Family code is required when privacy is "private" or "family", optional for "public" posts'
  })
  @IsString()
  @IsOptional()
  @ValidateIf((o) => o.privacy === 'private' || o.privacy === 'family')
  @IsNotEmpty({ message: 'Family code is required when privacy is private or family' })
    familyCode: string;

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
  @ApiPropertyOptional({ type: String, description: 'S3 file URL' })
  postImage?: string;
}
