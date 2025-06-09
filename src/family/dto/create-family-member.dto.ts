import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsIn,
  Matches,
  IsNotEmpty,
  IsDateString,
  IsInt,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateFamilyMemberDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email address' })
  @IsEmail()
  @IsOptional()
  email: string;

  @ApiProperty({
    example: '+919876543210',
    description: 'User mobile number with country code (e.g. +91 for India)',
  })
  @IsString()
  @IsOptional()
  @Matches(/^\+\d{1,4}\d{6,14}$/, {
    message: 'Mobile must start with country code (e.g. +91xxxxxxxxxx)'
  })
  mobile: string;

  @ApiProperty({ example: 'John', description: 'User first name' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Password123!', description: 'User password (min 8 characters)' })
  @IsString()
  @IsOptional()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: 'Doe', description: 'User last name' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'User role (1=member, 2=admin, 3=superadmin)',
    default: 1
  })
  @IsIn([1, 2, 3])
  @IsOptional()
  @Type(() => Number)
  role?: number;

  @ApiPropertyOptional({
    description: 'Profile image file (only filename stored)',
    type: 'string',
    format: 'binary'
  })
  @IsOptional()
  @IsString()
  profile?: string;

  @ApiPropertyOptional({ description: 'Gender', example: 'Male' })
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional({ description: 'Date of Birth', example: '1990-01-01' })
  @IsOptional()
  @IsDateString()
  dob?: Date;

  @ApiPropertyOptional({ description: 'Age', example: 34 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  age?: number;

  @ApiPropertyOptional({ description: 'Marital Status', example: 'Married' })
  @IsOptional()
  @IsString()
  maritalStatus?: string;

  @ApiPropertyOptional({ description: 'Spouse Name', example: 'Wife/Husband' })
  @IsOptional()
  @IsString()
  spouseName?: string;

  @ApiPropertyOptional({ description: 'Children Names (JSON array)', example: '["Son", "Daughter"]' })
  @IsOptional()
  @IsString()
  childrenNames?: string;

  @ApiPropertyOptional({ description: 'Father Name', example: 'Father' })
  @IsOptional()
  @IsString()
  fatherName?: string;

  @ApiPropertyOptional({ description: 'Mother Name', example: 'Mother' })
  @IsOptional()
  @IsString()
  motherName?: string;

  @ApiPropertyOptional({ description: 'Religion ID', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  religionId?: number;

  @ApiPropertyOptional({ description: 'Language ID', example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  languageId?: number;

  @ApiPropertyOptional({ description: 'Caste', example: 'Hindu' })
  @IsOptional()
  @IsString()
  caste?: string;

  @ApiPropertyOptional({ description: 'Gothram ID', example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  gothramId?: number;

  @ApiPropertyOptional({ description: 'Kuladevata', example: 'Murugan' })
  @IsOptional()
  @IsString()
  kuladevata?: string;

  @ApiPropertyOptional({ description: 'Region', example: 'South Tamil Nadu' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: 'Hobbies', example: 'Reading, Traveling' })
  @IsOptional()
  @IsString()
  hobbies?: string;

  @ApiPropertyOptional({ description: 'Likes/Dislikes', example: 'Likes: Nature, Dislikes: Noise' })
  @IsOptional()
  @IsString()
  likesDislikes?: string;

  @ApiPropertyOptional({ description: 'Favorite Foods', example: 'Dosa, Biryani' })
  @IsOptional()
  @IsString()
  favoriteFoods?: string;

  @ApiPropertyOptional({ description: 'Contact Number', example: '+91-9876543210' })
  @IsOptional()
  @IsString()
  contactNumber?: string;

  @ApiPropertyOptional({ description: 'Country ID', example: 101 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  countryId?: number;

  @ApiPropertyOptional({ description: 'Address', example: '123, Gandhi Street, Chennai' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: 'Bio', example: 'Software engineer from Chennai.' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ description: 'Family Code', example: 'FAM000123' })
  @IsOptional()
  @IsString()
  familyCode?: string;
}
