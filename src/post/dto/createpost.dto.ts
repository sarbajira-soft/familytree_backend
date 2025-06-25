import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePostDto {
  @ApiProperty({ example: 'My new post' })
  @IsString()
  @IsNotEmpty()
  caption: string;

  @ApiProperty({ example: 'FAM123' })
  @IsString()
  @IsNotEmpty()
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
  @IsOptional()
  postImage?: Express.Multer.File;
}
