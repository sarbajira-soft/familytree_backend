import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class TogglePrivacyDto {
  @ApiPropertyOptional({ description: 'Set to true to make account private' })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @ApiPropertyOptional({ description: 'Email visibility scope', example: 'FAMILY', enum: ['PRIVATE', 'FAMILY'] })
  @IsOptional()
  @IsString()
  @IsIn(['PRIVATE', 'FAMILY'])
  emailPrivacy?: string;

  @ApiPropertyOptional({ description: 'Address visibility scope', example: 'FAMILY', enum: ['PRIVATE', 'FAMILY'] })
  @IsOptional()
  @IsString()
  @IsIn(['PRIVATE', 'FAMILY'])
  addressPrivacy?: string;

  @ApiPropertyOptional({ description: 'Phone visibility scope', example: 'FAMILY', enum: ['PRIVATE', 'FAMILY'] })
  @IsOptional()
  @IsString()
  @IsIn(['PRIVATE', 'FAMILY'])
  phonePrivacy?: string;
}
