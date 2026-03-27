import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAdminEventDto {
  @ApiPropertyOptional({ description: 'Title of the event', example: 'Wedding Anniversary' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  eventTitle?: string;

  @ApiPropertyOptional({ description: 'Description of the event' })
  @IsOptional()
  @IsString()
  eventDescription?: string;

  @ApiPropertyOptional({ description: 'Date of the event (YYYY-MM-DD)', example: '2026-06-15' })
  @IsOptional()
  @IsString()
  eventDate?: string;

  @ApiPropertyOptional({ description: 'Time of the event (HH:mm)', example: '18:30' })
  @IsOptional()
  @IsString()
  eventTime?: string;

  @ApiPropertyOptional({ description: 'Location of the event', example: 'Chennai' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: 'Family code', example: 'FAM001122' })
  @IsOptional()
  @IsString()
  familyCode?: string;

  @ApiPropertyOptional({ description: 'Status (1 = active, 0 = inactive)', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsIn([0, 1])
  status?: number;
}
