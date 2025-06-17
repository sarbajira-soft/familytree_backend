import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
} from 'class-validator';

export class CreateEventDto {
  @ApiProperty({
    example: 'Wedding Anniversary',
    description: 'Name of the event',
  })
  @IsString()
  @IsNotEmpty()
  eventName: string;

  @ApiProperty({
    example: 'Celebrating 25 years of togetherness',
    description: 'Description of the event',
  })
  @IsOptional()
  @IsString()
  eventDescription?: string;

  @ApiPropertyOptional({
    description: 'Event image file (only filename stored)',
    type: 'string',
    format: 'binary',
  })
  @IsOptional()
  @IsString()
  eventImage?: string;

  @ApiProperty({
    example: '2025-06-15',
    description: 'Start date of the event in YYYY-MM-DD format',
  })
  @IsDateString()
  @IsNotEmpty()
  eventStartDate: string;

  @ApiPropertyOptional({
    example: '2025-06-16',
    description: 'End date of the event in YYYY-MM-DD format (optional)',
  })
  @IsOptional()
  @IsDateString()
  eventEndDate?: string;

  @ApiProperty({
    example: 'FAM001122',
    description: 'Family code associated with this event',
  })
  @IsString()
  @IsNotEmpty()
  familyCode: string;
}
