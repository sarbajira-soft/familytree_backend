import { IsString, IsOptional, ValidateIf, IsEmail, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'User email address (required if mobile is not provided)',
    required: false,
  })
  @ValidateIf(o => !o.mobile)
  @IsEmail()
  email?: string;

  @ApiProperty({
    example: '+919876543210',
    description: 'User mobile number with country code (required if email is not provided)',
    required: false,
  })
  @ValidateIf(o => !o.email)
  @IsString()
  @Matches(/^\+\d{1,4}\d{6,14}$/, {
    message: 'Mobile must start with country code (e.g. +91xxxxxxxxxx)'
  })
  mobile?: string;

  @ApiProperty({
    example: '123456',
    description: 'OTP code received by user',
    required: true,
  })
  @IsString()
  otp: string;
}