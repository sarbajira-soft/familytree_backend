import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateFamilyDto {
  @ApiProperty({ example: 'The Singhs', description: 'Family name' })
  @IsString()
  @IsNotEmpty()
  familyName: string;

  @ApiProperty({ example: 'A united and respected family from Chennai.', description: 'Family bio' })
  @IsOptional()
  @IsString()
  familyBio?: string;

  @ApiPropertyOptional({
    description: 'Family image file (only filename stored)',
    type: 'string',
    format: 'binary'
  })
  @IsOptional()
  @IsString()
  familyPhoto?: string;

  @ApiProperty({ example: 'FAM001122', description: 'Unique family code' })
  @IsString()
  @IsNotEmpty()
  familyCode: string;
}
