import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsNumber } from 'class-validator';

export class EditCommentDto {
  @ApiProperty({ example: 'Updated comment text', description: 'New comment text' })
  @IsString()
  @IsNotEmpty()
  comment: string;
}

export class ReplyCommentDto {
  @ApiProperty({ example: 'This is a reply', description: 'Reply text' })
  @IsString()
  @IsNotEmpty()
  comment: string;

  @ApiProperty({ example: 1, description: 'Parent comment ID' })
  @IsNumber()
  parentCommentId: number;
}
