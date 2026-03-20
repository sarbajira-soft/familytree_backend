import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAdminPostDto {
  @ApiPropertyOptional({ example: 'Updated caption' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  caption?: string;

  @ApiPropertyOptional({ example: 'true', description: 'Set to true to remove existing post image' })
  @IsOptional()
  @IsBooleanString()
  removeImage?: string;
}
