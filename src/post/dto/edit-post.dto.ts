import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsNotEmpty, ValidateIf } from 'class-validator';

export class EditPostDto {
  @ApiPropertyOptional({ example: 'My updated post' })
  @IsString()
  @IsOptional()
  caption?: string;

  @ApiPropertyOptional({ 
    example: 'FAM123',
    description: 'Family code is required when privacy is "private" or "family"'
  })
  @IsString()
  @IsOptional()
  @ValidateIf((o) => o.privacy === 'private' || o.privacy === 'family')
  @IsNotEmpty({ message: 'Family code is required when privacy is private or family' })
  familyCode?: string;

  @ApiPropertyOptional({ example: 'public', enum: ['public', 'private', 'family'] })
  @IsIn(['public', 'private', 'family'])
  @IsOptional()
  privacy?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  status?: number;

  @ApiPropertyOptional({
    description: 'Post image (file)',
    type: 'string',
    format: 'binary',
  })
  @IsOptional()
  postImage?: string;
}
