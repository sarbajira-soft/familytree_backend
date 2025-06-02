import { IsEmail, IsString, MinLength, IsOptional, IsIn, Matches, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Password123!', description: 'User password (min 8 characters)' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'John', description: 'User first name' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Doe', description: 'User last name' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({
    example: '+919876543210',
    description: 'User mobile number with country code (e.g. +91 for India)',
  })
  @IsString()
  @Matches(/^\+\d{1,4}\d{6,14}$/, {
    message: 'Mobile must start with country code (e.g. +91xxxxxxxxxx)'
  })
  mobile: string;

  @ApiProperty({
    example: 1,
    description: 'User role (1=member, 2=admin, 3=superadmin)',
    required: false,
    default: 1
  })
  @IsIn([1, 2, 3])
  @IsOptional()
  role?: number;
}