import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AddPostCommentDto {
  @ApiProperty({ example: 'Nice photo!', description: 'Comment text' })
  @IsString()
  @IsNotEmpty()
  comment: string;
}
