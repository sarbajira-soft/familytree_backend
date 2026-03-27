import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateReportDto {
  @ApiProperty({ enum: ['post', 'gallery', 'event'], example: 'post' })
  @IsString()
  @IsIn(['post', 'gallery', 'event'])
  targetType: 'post' | 'gallery' | 'event';

  @ApiProperty({ example: 123 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetId: number;

  @ApiProperty({ example: 'spam' })
  @IsString()
  reason: string;

  @ApiPropertyOptional({ example: 'Additional context...' })
  @IsOptional()
  @IsString()
  description?: string;
}
