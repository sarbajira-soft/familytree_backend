import { IsEnum, IsNumber, IsString } from 'class-validator';

export class NotificationResponseDto {
  @IsNumber()
  notificationId: number;

  @IsString()
  @IsEnum(['accept', 'reject'])
  action: 'accept' | 'reject';
}
