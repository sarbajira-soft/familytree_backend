import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, IsIn } from 'class-validator';

export class CreateFamilyMemberDto {
  @ApiProperty({
    example: 42,
    description: 'User ID of the member to add to the family',
  })
  @IsNumber()
  @IsNotEmpty()
  memberId: number;

  @ApiProperty({
    example: 'FAM123456',
    description: 'Unique code representing the family group',
  })
  @IsString()
  @IsNotEmpty()
  familyCode: string;

  @ApiPropertyOptional({
    example: 88,
    description: 'User ID of the creator who is adding the member (optional)',
  })
  @IsNumber()
  @IsOptional()
  creatorId?: number;

  @ApiPropertyOptional({
    example: 'pending',
    description: 'Approval status of the membership request (optional, defaults to pending)',
    enum: ['pending', 'approved', 'rejected'],
  })
  @IsIn(['pending', 'approved', 'rejected'])
  @IsOptional()
  approveStatus?: 'pending' | 'approved' | 'rejected';
}
