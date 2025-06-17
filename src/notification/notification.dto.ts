import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  IsNotEmpty,
  IsNumber,
  IsArray,
  IsOptional,
  IsDateString,
} from 'class-validator';

export class NotificationDTO {
  @ApiProperty({
    description: 'Email address to send notification to',
    example: 'user@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'Notification message content',
    example:
      "🎉 Today is John's birthday! Don't forget to wish them a happy birthday! 🎂",
  })
  @IsString()
  @IsNotEmpty()
  message: string;
}

export class DashboardNotificationResponseDTO {
  @ApiProperty({
    description: 'Notification ID',
    example: 1,
  })
  id: number;

  @ApiProperty({
    description: 'User ID who receives the notification',
    example: 123,
  })
  userId: number;

  @ApiProperty({
    description: 'Notification message',
    example:
      "🎉 Today is John's birthday! Don't forget to wish them a happy birthday! 🎂",
  })
  message: string;

  @ApiProperty({
    description: 'Whether the notification has been read',
    example: false,
  })
  read: boolean;

  @ApiProperty({
    description: 'Type of notification',
    example: 'birthday',
    enum: ['birthday', 'reminder', 'system', 'family'],
  })
  notificationType: string;

  @ApiProperty({
    description: 'When the notification was created',
    example: '2025-06-16T10:30:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'When the notification was last updated',
    example: '2025-06-16T10:30:00Z',
  })
  updatedAt: Date;
}

export class NotificationStatsResponseDTO {
  @ApiProperty({
    description: 'Status message',
    example: 'Push notifications created successfully',
  })
  status: string;

  @ApiProperty({
    description: 'Number of emails sent (deprecated - always 0)',
    example: 0,
  })
  emailsSent: number;

  @ApiProperty({
    description: 'Number of dashboard notifications created',
    example: 12,
  })
  dashboardNotifications: number;

  @ApiProperty({
    description: 'Total number of users processed',
    example: 25,
  })
  usersProcessed: number;
}

export class WeeklyNotificationResponseDTO {
  @ApiProperty({
    description: 'Status message',
    example: 'Weekly notifications created successfully',
  })
  status: string;

  @ApiProperty({
    description: 'Number of notifications created',
    example: 15,
  })
  notificationsCreated: number;

  @ApiProperty({
    description: 'Number of families processed',
    example: 5,
  })
  familiesProcessed: number;

  @ApiProperty({
    description: 'Week start date',
    example: '2025-06-16T00:00:00Z',
  })
  weekStartDate: string;

  @ApiProperty({
    description: 'Week end date',
    example: '2025-06-23T00:00:00Z',
  })
  weekEndDate: string;
}

export class CreateEventNotificationDTO {
  @ApiProperty({
    description: 'User ID to send notification to',
    example: 123,
  })
  @IsNumber()
  @IsNotEmpty()
  userId: number;

  @ApiProperty({
    description: 'Event title',
    example: 'Family Reunion',
  })
  @IsString()
  @IsNotEmpty()
  eventTitle: string;

  @ApiProperty({
    description: 'Event date',
    example: '2025-07-15T18:00:00Z',
  })
  @IsDateString()
  @IsNotEmpty()
  eventDate: string;

  @ApiProperty({
    description: 'Optional event description',
    example: 'Annual family gathering at grandparents house',
    required: false,
  })
  @IsString()
  @IsOptional()
  eventDescription?: string;
}

export class CreateSystemNotificationDTO {
  @ApiProperty({
    description: 'Array of user IDs to send notification to',
    example: [123, 456, 789],
    type: [Number],
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @IsNotEmpty()
  userIds: number[];

  @ApiProperty({
    description: 'System notification message',
    example: 'App maintenance scheduled for tonight at 11 PM',
  })
  @IsString()
  @IsNotEmpty()
  message: string;
}

export class CleanupResponseDTO {
  @ApiProperty({
    description: 'Cleanup status',
    example: 'Cleanup completed',
  })
  status: string;

  @ApiProperty({
    description: 'Number of notifications deleted',
    example: 15,
  })
  deletedNotifications: number;
}

export class MarkReadResponseDTO {
  @ApiProperty({
    description: 'Operation status',
    example: 'Notification marked as read',
  })
  status: string;
}
