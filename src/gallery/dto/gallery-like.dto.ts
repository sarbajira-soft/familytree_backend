import { ApiProperty } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';

export class ToggleLikeDto {
  @ApiProperty({ example: 1, description: 'Gallery ID to like/unlike' })
  @IsNumber()
  galleryId: number;
} 