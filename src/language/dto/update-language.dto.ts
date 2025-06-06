import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateLanguageDto {
  @ApiPropertyOptional({ description: 'Language name', example: 'Tamil' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'ISO code', example: 'ta' })
  @IsString()
  @IsOptional()
  isoCode?: string;

  @ApiPropertyOptional({ description: 'Status (1=active, 0=inactive)', example: 1 })
  @IsIn([0, 1])
  @IsOptional()
  status?: number;
}
