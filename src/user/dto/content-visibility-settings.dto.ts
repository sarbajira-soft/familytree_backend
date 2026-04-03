import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';

class ContentVisibilityEntryDto {
  @ApiPropertyOptional({ enum: ['all-members', 'specific-family'], example: 'all-members' })
  @IsOptional()
  @IsIn(['all-members', 'specific-family'])
  visibility?: 'all-members' | 'specific-family';

  @ApiPropertyOptional({ type: [String], example: ['FAM578841', 'FAM270084'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  familyCodes?: string[];
}

export class ContentVisibilitySettingsDto {
  @ApiPropertyOptional({ type: () => ContentVisibilityEntryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContentVisibilityEntryDto)
  posts?: ContentVisibilityEntryDto;

  @ApiPropertyOptional({ type: () => ContentVisibilityEntryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContentVisibilityEntryDto)
  albums?: ContentVisibilityEntryDto;

  @ApiPropertyOptional({ type: () => ContentVisibilityEntryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContentVisibilityEntryDto)
  events?: ContentVisibilityEntryDto;
}
