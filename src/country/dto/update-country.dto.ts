import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCountryDto {
  @ApiPropertyOptional({ description: 'Country name', example: 'India' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Country code', example: 'IN' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ description: 'Status (1=active, 0=inactive)', example: 1 })
  @IsIn([0, 1])
  @IsOptional()
  status?: number;
}
