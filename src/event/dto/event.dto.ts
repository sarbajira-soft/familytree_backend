import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
  IsNumber,
  MaxLength,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
 
export class CreateEventDto {
  @ApiProperty({
    example: 1,
    description: 'User ID who is creating the event',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'User ID must be a number' })
  @IsNotEmpty()
  userId: number;

  @ApiProperty({
    example: 'Wedding Anniversary',
    description: 'Title of the event',
  })
  @IsString()
  @MaxLength(50, { message: 'Event title must be at most 50 characters' })
  @IsNotEmpty()
  eventTitle: string;

  @ApiProperty({
    example: 'Celebrating 25 years of togetherness',
    description: 'Description of the event',
  })
  @IsOptional()
  @IsString()
  eventDescription?: string;

  @ApiProperty({
    example: '2025-06-15',
    description: 'Date of the event in YYYY-MM-DD format',
  })
  @IsDateString()
  @IsNotEmpty()
  eventDate: string;

  @ApiPropertyOptional({
    example: '18:30',
    description: 'Time of the event in HH:MM format',
  })
  @IsOptional()
  @IsString()
  eventTime?: string;

  @ApiPropertyOptional({
    example: 'Grand Hotel, Chennai',
    description: 'Location of the event',
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({
    example: 'FAM001122',
    description: 'Family code associated with this event',
  })
  @IsString()
  @IsNotEmpty()
  familyCode: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'User ID who created the event (defaults to userId if not provided)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Created by must be a number' })
  createdBy?: number;

  @ApiPropertyOptional({
    description: 'Event image files (multiple images supported) or existing image URLs',
    type: 'string',
    format: 'binary',
    isArray: true,
  })
  @IsOptional()
  eventImages?: any;
}

export class UpdateEventDto {
  @ApiPropertyOptional({
    example: 'Wedding Anniversary',
    description: 'Title of the event',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'Event title must be at most 50 characters' })
  eventTitle?: string;

  @ApiPropertyOptional({
    example: 'Celebrating 25 years of togetherness',
    description: 'Description of the event',
  })
  @IsOptional()
  @IsString()
  eventDescription?: string;

  @ApiPropertyOptional({
    example: '2025-06-15',
    description: 'Date of the event in YYYY-MM-DD format',
  })
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  @ApiPropertyOptional({
    example: '18:30',
    description: 'Time of the event in HH:MM format',
  })
  @IsOptional()
  @IsString()
  eventTime?: string;

  @ApiPropertyOptional({
    example: 'Grand Hotel, Chennai',
    description: 'Location of the event',
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({
    example: 'FAM001122',
    description: 'Family code associated with this event',
  })
  @IsOptional()
  @IsString()
  familyCode?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Status of the event (1 = active, 0 = inactive)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Status must be a number' })
  status?: number;

  @ApiPropertyOptional({
    description: 'Event image files (multiple images supported) or existing image URLs',
    type: 'string',
    format: 'binary',
    isArray: true,
  })
  @IsOptional()
  eventImages?: any;

  @ApiPropertyOptional({
    description: 'Array of image IDs to remove from the event',
    example: [1, 2, 3],
    type: [Number],
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { each: true, message: 'Each image ID must be a number' })
  imagesToRemove?: number[];

  @ApiPropertyOptional({
    description: 'Clear all existing images for the event',
    example: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'clearImages must be a boolean value' })
  clearImages?: boolean;
}

export class CreateEventImageDto {
  @ApiProperty({ example: 1, description: 'Event ID' })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber({}, { message: 'Event ID must be a number' })
  eventId: number;

  @ApiProperty({ example: 'event-image.jpg', description: 'Image URL or filename' })
  @IsNotEmpty()
  @IsString()
  imageUrl: string;
}
