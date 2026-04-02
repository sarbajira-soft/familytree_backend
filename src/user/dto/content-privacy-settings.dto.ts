import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ContentPrivacyEntryDto {
  @ApiPropertyOptional({
    description: 'Visibility mode for this content type',
    enum: ['ALL_MEMBERS', 'SPECIFIC_FAMILIES'],
    default: 'ALL_MEMBERS',
  })
  @IsOptional()
  @IsString()
  @IsIn(['ALL_MEMBERS', 'SPECIFIC_FAMILIES'])
  visibility?: 'ALL_MEMBERS' | 'SPECIFIC_FAMILIES';

  @ApiPropertyOptional({
    description: 'Allowed family codes when visibility is SPECIFIC_FAMILIES',
    type: [String],
    default: [],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  familyCodes?: string[];
}

export class UpdateContentPrivacySettingsDto {
  @ApiPropertyOptional({ type: ContentPrivacyEntryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContentPrivacyEntryDto)
  posts?: ContentPrivacyEntryDto;

  @ApiPropertyOptional({ type: ContentPrivacyEntryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContentPrivacyEntryDto)
  albums?: ContentPrivacyEntryDto;

  @ApiPropertyOptional({ type: ContentPrivacyEntryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContentPrivacyEntryDto)
  events?: ContentPrivacyEntryDto;
}
