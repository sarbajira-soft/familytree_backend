// reset-password.dto.ts
import { IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';
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
  @MinLength(8)
  @Matches(/(?=.*[A-Z])/, {
    message: 'Password must contain at least 1 uppercase letter',
  })
  @Matches(/(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/, {
    message: 'Password must contain at least 1 special character',
  })
  newPassword: string;

  @ApiProperty({ description: 'Confirm new password' })
  @IsString()
  @MinLength(8)
  confirmPassword: string;
}
