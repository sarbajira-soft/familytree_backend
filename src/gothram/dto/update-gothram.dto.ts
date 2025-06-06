import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateGothramDto {
  @ApiPropertyOptional({ description: 'Gothram name', example: 'Bharadwaja' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Status (1=active, 0=inactive)', example: 1 })
  @IsIn([0, 1])
  @IsOptional()
  status?: number;
}
