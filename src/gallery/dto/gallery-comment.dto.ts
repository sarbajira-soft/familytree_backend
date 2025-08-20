import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateGalleryCommentDto {
  @ApiProperty({ example: 1, description: 'Gallery ID' })
  @IsNumber()
  galleryId: number;

  @ApiProperty({ example: 'Beautiful photo!', description: 'Comment text' })
  @IsString()
  @IsNotEmpty()
  comments: string;
} 
