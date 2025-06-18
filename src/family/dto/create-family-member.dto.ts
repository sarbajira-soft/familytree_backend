import {
  IsString,
  IsEmail,
  IsOptional,
  IsDateString,
  IsNumber,
  MinLength,
  MaxLength,
  Matches,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFamilyMemberDto {
  // --- User table fields ---
  @ApiProperty({ example: 'john.doe@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: '+91',
    description: 'Country code including + sign (e.g. +91 for India)',
  })
  @IsString()
  @Matches(/^\+\d{1,4}$/, {
    message: 'Country code must start with + and contain 1 to 4 digits',
  })
  countryCode: string;

  @ApiProperty({ example: '9876543210' })
  @IsOptional()
  @IsString()
  mobile?: string;

  @ApiProperty({ example: 'password123' })
  @MinLength(6)
  @MaxLength(32)
  password: string;

  // --- UserProfile table fields ---
  @ApiProperty({ example: 'John' })
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  lastName: string;

  @ApiPropertyOptional({
    description: 'Profile image file (only filename stored)',
    type: 'string',
    format: 'binary'
  })
  @IsOptional()
  @IsString()
  profile?: string;

  @ApiProperty({ example: 'male', enum: ['male', 'female'] })
  @IsIn(['male', 'female'])
  gender: string;

  @ApiProperty({ example: '1990-05-15' })
  @IsOptional()
  @IsDateString()
  dob?: string;

  @ApiProperty({ example: 'single', enum: ['single', 'married', 'divorced', 'widowed'] })
  @IsOptional()
  @IsString()
  maritalStatus?: string;

  @ApiProperty({ example: 'Jane Doe' })
  @IsOptional()
  @IsString()
  spouseName?: string;

  @ApiProperty({ example: 'Tom, Jerry' })
  @IsOptional()
  @IsString()
  childrenNames?: string;

  @ApiProperty({ example: 'Michael Doe' })
  @IsOptional()
  @IsString()
  fatherName?: string;

  @ApiProperty({ example: 'Mary Doe' })
  @IsOptional()
  @IsString()
  motherName?: string;

  @ApiProperty({ example: 1 })
  @IsOptional()
  @IsNumber()
  religionId?: number;

  @ApiProperty({ example: 1 })
  @IsOptional()
  @IsNumber()
  languageId?: number;

  @ApiProperty({ example: 'Brahmin' })
  @IsOptional()
  @IsString()
  caste?: string;

  @ApiProperty({ example: 2 })
  @IsOptional()
  @IsNumber()
  gothramId?: number;

  @ApiProperty({ example: 'Lord Vishnu' })
  @IsOptional()
  @IsString()
  kuladevata?: string;

  @ApiProperty({ example: 'South Tamil Nadu' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiProperty({ example: 'Reading, Gardening' })
  @IsOptional()
  @IsString()
  hobbies?: string;

  @ApiProperty({ example: 'Likes dogs, hates noise' })
  @IsOptional()
  @IsString()
  likesDislikes?: string;

  @ApiProperty({ example: 'Dosa, Biryani' })
  @IsOptional()
  @IsString()
  favoriteFoods?: string;

  @ApiProperty({ example: '9123456789' })
  @IsOptional()
  @IsString()
  contactNumber?: string;

  @ApiProperty({ example: 91 })
  @IsOptional()
  @IsNumber()
  countryId?: number;

  @ApiProperty({ example: '123 Street, City, State' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ example: 'Short family intro or background' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiProperty({ example: 'FAM12345' })
  @IsOptional()
  @IsString()
  familyCode?: string;
}
