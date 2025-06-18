import { IsString, IsOptional, ValidateIf, IsEmail, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiProperty({
    example: 'user@example.com or +919876543210',
    description: 'User email address mobile is required',
    required: false,
  })
  @IsString()
  userName?: string;

  @ApiProperty({
    example: '123456',
    description: 'OTP code received by user',
    required: true,
  })
  @IsString()
  otp: string;
}