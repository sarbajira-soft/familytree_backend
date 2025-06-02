// reset-password.dto.ts
import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Email or mobile number' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ description: 'OTP sent to email or mobile' })
  @IsString()
  @IsNotEmpty()
  otp: string;

  @ApiProperty({ description: 'New password' })
  @IsString()
  @MinLength(6)
  newPassword: string;

  @ApiProperty({ description: 'Confirm new password' })
  @IsString()
  @MinLength(6)
  confirmPassword: string;
}
