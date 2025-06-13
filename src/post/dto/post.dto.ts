import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePostDto {
  @ApiProperty({ example: 'First Birthday Celebration', description: 'Post title or name' })
  @IsString()
  @IsNotEmpty()
  postName: string;

  @ApiProperty({ example: 'We celebrated our baby\'s first birthday with great joy.', description: 'Post description' })
  @IsOptional()
  @IsString()
  postDescription?: string;

  @ApiPropertyOptional({
    description: 'Post image file (only filename stored)',
    type: 'string',
    format: 'binary',
  })
  @IsOptional()
  @IsString()
  postImage?: string;

  @ApiProperty({ example: 'FAM001122', description: 'Family code associated with this post' })
  @IsString()
  @IsNotEmpty()
  familyCode: string;
}
