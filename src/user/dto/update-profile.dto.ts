import {
  IsOptional,
  IsString,
  IsDateString,
  IsInt,
  IsJSON,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'Profile image file (only filename stored)',
    type: 'string',
    format: 'binary'
  })
  @IsOptional()
  @IsString()
  profile?: string;

  @ApiPropertyOptional({ description: 'Email address', example: 'user@example.com' })
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: 'Country code for phone', example: '+91' })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({ description: 'Mobile phone number', example: '9876543210' })
  @IsOptional()
  @IsString()
  mobile?: string;

  @ApiPropertyOptional({ description: 'Password (hashed or raw)', example: 'secret123' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({ description: 'User role ID', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  role?: number;

  @ApiPropertyOptional({ description: 'User status', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  status?: number;

  @ApiPropertyOptional({ description: 'First Name', example: 'John' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ description: 'Last Name', example: 'David' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ description: 'Gender of the user', example: 'Male' })
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional({ 
    description: 'Date of Birth in YYYY-MM-DD format', 
    example: '1990-01-01' 
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value ? new Date(value).toISOString() : null)
  dob?: string;

  @ApiPropertyOptional({ description: 'Age', example: 34 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  age?: number;

  @ApiPropertyOptional({ description: 'Marital Status', example: 'Married' })
  @IsOptional()
  @IsString()
  maritalStatus?: string;

  @ApiPropertyOptional({ 
    description: 'Date of Marriage in YYYY-MM-DD format', 
    example: '2024-01-01' 
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value ? new Date(value).toISOString() : null)
  marriageDate?: string;

  @ApiPropertyOptional({ description: 'Name of the spouse', example: 'Wife/Husband' })
  @IsOptional()
  @IsString()
  spouseName?: string;

  @ApiPropertyOptional({ description: 'Names of children as JSON array string', example: '["Son", "Daugther"]' })
  @IsOptional()
  @IsString()
  childrenNames?: string;

  @ApiPropertyOptional({ description: 'Father’s Name', example: 'Father' })
  @IsOptional()
  @IsString()
  fatherName?: string;

  @ApiPropertyOptional({ description: 'Mother’s Name', example: 'Mother' })
  @IsOptional()
  @IsString()
  motherName?: string;

  @ApiPropertyOptional({ description: 'Religion ID (refer to Religion table)', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  religionId?: number;

  @ApiPropertyOptional({ description: 'Language ID (refer to Language table)', example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  languageId?: number;

  @ApiPropertyOptional({ description: 'Caste', example: 'Hindu' })
  @IsOptional()
  @IsString()
  caste?: string;

  @ApiPropertyOptional({ description: 'Gothram ID (refer to Gothram table)', example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  gothramId?: number;

  @ApiPropertyOptional({ description: 'Family deity / Kuladevata', example: 'Murugan' })
  @IsOptional()
  @IsString()
  kuladevata?: string;

  @ApiPropertyOptional({ description: 'Region (Nadu)', example: 'South Tamil Nadu' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: 'User hobbies', example: 'Reading, Traveling, Music, Playing Cricket' })
  @IsOptional()
  @IsString()
  hobbies?: string;

  @ApiPropertyOptional({ description: 'Likes', example: 'Likes: Nature' })
  @IsOptional()
  @IsString()
  likes?: string;

  @ApiPropertyOptional({ description: 'Dislikes', example: 'Dislikes: Noise' })
  @IsOptional()
  @IsString()
  dislikes?: string;

  @ApiPropertyOptional({ description: 'Favorite foods', example: 'Dosa, Briyani' })
  @IsOptional()
  @IsString()
  favoriteFoods?: string;

  @ApiPropertyOptional({ description: 'Contact number', example: '+91-9876543210' })
  @IsOptional()
  @IsString()
  contactNumber?: string;

  @ApiPropertyOptional({ description: 'Country ID (refer to Country table)', example: 101 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  countryId?: number;

  @ApiPropertyOptional({ description: 'Full address of the user', example: '123, Gandhi Street, Chennai' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: 'User bio or short life story', example: 'Software engineer from Chennai with a passion for culture and travel.' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ description: 'System generated Family Code or Root ID', example: 'FAM000123' })
  @IsOptional()
  @IsString()
  familyCode?: string;
  
}
