import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, IsEnum } from 'class-validator';

export class AssociationRequestDto {
  @ApiProperty({ description: 'Target user ID to associate with' })
  @IsNumber()
  @IsNotEmpty()
  targetUserId: number;

  @ApiProperty({ description: 'Relationship type', required: false })
  @IsString()
  @IsOptional()
  relationshipType?: string;

  @ApiProperty({ description: 'Additional message', required: false })
  @IsString()
  @IsOptional()
  message?: string;
}

export class AssociationResponseDto {
  @ApiProperty({ description: 'Notification ID to respond to' })
  @IsNumber()
  @IsNotEmpty()
  notificationId: number;

  @ApiProperty({ description: 'Response action', enum: ['accept', 'reject'] })
  @IsEnum(['accept', 'reject'])
  @IsNotEmpty()
  action: 'accept' | 'reject';

  @ApiProperty({ description: 'Response message', required: false })
  @IsString()
  @IsOptional()
  message?: string;
}

export class AssociatedTreeQueryDto {
  @ApiProperty({ description: 'Family code to get associated tree for', required: false })
  @IsString()
  @IsOptional()
  familyCode?: string;

  @ApiProperty({ description: 'User ID to get all associated trees for', required: false })
  @IsNumber()
  @IsOptional()
  userId?: number;

  @ApiProperty({ description: 'Include cross-family relationships', required: false, default: true })
  @IsOptional()
  includeCrossFamily?: boolean = true;

  @ApiProperty({ description: 'Maximum depth for relationship traversal', required: false, default: 3 })
  @IsNumber()
  @IsOptional()
  maxDepth?: number = 3;
}
