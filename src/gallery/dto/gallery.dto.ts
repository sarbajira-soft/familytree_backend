import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsArray } from 'class-validator';

export class CreateGalleryDto {
  @ApiPropertyOptional({
    description: 'Gallery images (multiple files)',
    type: 'array',
    items: {
      type: 'string',
      format: 'binary',
    },
  })
  @IsOptional()
  @IsArray()
  images?: string[];

  @ApiProperty({
    example: 'FAM001122',
    description: 'Family code associated with this gallery',
  })
  @IsString()
  @IsNotEmpty()
  familyCode: string;
}
