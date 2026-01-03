import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, Min } from 'class-validator';
import { BlockType } from '../model/user-block.model';

export class BlockUserDto {
  @ApiProperty({ example: 123 })
  @IsInt()
  @Min(1)
  blockedUserId: number;

  @ApiProperty({ enum: BlockType, example: BlockType.USER })
  @IsEnum(BlockType)
  blockType: BlockType;
}

export class UserBlockResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 10 })
  blockerUserId: number;

  @ApiProperty({ example: 20 })
  blockedUserId: number;

  @ApiProperty({ enum: BlockType, example: BlockType.USER })
  blockType: BlockType;

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  createdAt: Date;
}
