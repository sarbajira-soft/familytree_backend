import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsDefined, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class MergeUserDto {
  @ApiProperty({ example: 1, description: 'The existing user ID to keep' })
  @IsNumber()
  @IsDefined()
  @Type(() => Number)
  existingId: number;

  @ApiProperty({ example: 2, description: 'The current user ID to merge and delete' })
  @IsNumber()
  @IsDefined()
  @Type(() => Number)
  currentId: number;

  @ApiPropertyOptional({ example: 123, description: 'Notification ID to update after merge' })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  notificationId?: number;
} 