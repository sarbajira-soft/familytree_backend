import { IsNotEmpty, IsString, IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReligionDto {
  @ApiProperty({ description: 'Religion name', example: 'Hindu' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Status (1=active, 0=inactive)', example: 1 })
  @IsIn([0, 1])
  @IsOptional()
  status?: number;

}
