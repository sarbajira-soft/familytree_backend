import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class CreateFamilyDto {
  @ApiProperty({ example: 'The Singhs', description: 'Family name' })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'familyName should not be empty' })
  familyName: string;

  @ApiProperty({ example: 'A united and respected family from Chennai.', description: 'Family bio' })
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'familyBio should not be empty' })
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
