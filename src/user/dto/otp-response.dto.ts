import { ApiProperty } from '@nestjs/swagger';

export class OtpResponseDto {
  @ApiProperty({
    example: 'New OTP sent successfully',
    description: 'Operation result message',
  })
  message: string;

  @ApiProperty({
    example: '15 minutes',
    description: 'OTP expiration time',
  })
  expiresIn: string;

  @ApiProperty({
    example: 'email',
    description: 'Channel through which OTP was sent',
    enum: ['email', 'sms']
  })
  via: string;
}