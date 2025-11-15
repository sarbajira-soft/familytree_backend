import { IsEmail, IsString, MinLength, IsOptional, IsIn, Matches, IsNotEmpty, Length, IsBoolean } from 'class-validator';
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
    example: '+91',
    description: 'Country code including + sign (e.g. +91 for India)',
  })
  @IsString()
  @Matches(/^\+\d{1,4}$/, {
    message: 'Country code must start with + and contain 1 to 4 digits',
  })
  countryCode: string;

  @ApiProperty({
    example: '9876543210',
    description: 'User mobile number without country code',
  })
  @IsString()
  @Length(6, 14, { message: 'Mobile number must be between 6 and 14 digits' })
  @Matches(/^\d+$/, { message: 'Mobile number must contain digits only' })
  mobile: string;

  @ApiProperty({
    example: 1,
    description: 'User role (1=member, 2=admin, 3=superadmin)',
    required: false,
    default: 1,
  })
  @IsIn([1, 2, 3])
  @IsOptional()
  role?: number;

  @ApiProperty({
    example: true,
    description: 'Flag indicating that the user has read and agreed to the Terms & Conditions',
  })
  @IsBoolean()
  hasAcceptedTerms: boolean;

  @ApiProperty({
    example: 'v1.0.0',
    description: 'Version of the Terms & Conditions accepted by the user',
    required: false,
    default: 'v1.0.0',
  })
  @IsOptional()
  @IsString()
  termsVersion?: string;
}
