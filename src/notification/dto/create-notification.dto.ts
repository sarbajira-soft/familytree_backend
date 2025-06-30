import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsArray } from 'class-validator';

export class CreateNotificationDto {
  @ApiProperty({
    example: 'FAMILY_JOIN_REQUEST',
    description: 'Type of the notification (system-defined types)',
  })
  @IsString()
  type: string;

  @ApiProperty({
    example: 'New Family Join Request',
    description: 'Title of the notification shown to users',
  })
  @IsString()
  title: string;

  @ApiProperty({
    example: 'John has requested to join your family using the code FAM001234.',
    description: 'Detailed message explaining the notification',
  })
  @IsString()
  message: string;

  @ApiPropertyOptional({
    example: 'FAM001234',
    description: 'Associated family code (if applicable)',
  })
  @IsOptional()
  @IsString()
  familyCode?: string;

  @ApiPropertyOptional({
    example: 101,
    description: 'Reference ID for related entity (e.g., userId, postId, etc.)',
  })
  @IsOptional()
  @IsNumber()
  referenceId?: number;

  @ApiProperty({
    example: [11, 14, 18],
    description: 'User IDs of notification recipients',
    type: [Number],
  })
  @IsArray()
  userIds: number[];
}
