import { IsEnum, IsInt, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRelationshipTranslationDto {
  @ApiProperty({
    example: 'ta',
    description: 'Language code (e.g., "ta" for Tamil, "en" for English)',
  })
  @IsString()
  languageCode: string;

  @ApiProperty({
    example: 3,
    description: 'The level of the logged-in user (from)',
  })
  @IsInt()
  fromLevel: number;

  @ApiProperty({
    example: 2,
    description: 'The level of the related user (to)',
  })
  @IsInt()
  toLevel: number;

  @ApiProperty({
    example: 'male',
    enum: ['male', 'female', 'other'],
    description: 'Gender of the logged-in user',
  })
  @IsEnum(['male', 'female', 'other'])
  fromGender: string;

  @ApiProperty({
    example: 'female',
    enum: ['male', 'female', 'other'],
    description: 'Gender of the related user',
  })
  @IsEnum(['male', 'female', 'other'])
  toGender: string;

  @ApiProperty({
    example: 'grandmother_father_side',
    description: 'Internal key used to identify the relationship',
  })
  @IsString()
  relationKey: string;

  @ApiProperty({
    example: 'பாட்டி',
    description: 'Localized name of the relationship',
  })
  @IsString()
  relationName: string;

  @ApiProperty({
    example: '-- Mothers younger sister (often also சின்னம்மா)',
    description: 'Relationship name description',
  })
  @IsString()
  notes: string;
}
