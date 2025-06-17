import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  ParseIntPipe,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiParam,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import {
  DashboardNotificationResponseDTO,
  NotificationStatsResponseDTO,
  CleanupResponseDTO,
  MarkReadResponseDTO,
  WeeklyNotificationResponseDTO,
  CreateEventNotificationDTO,
  CreateSystemNotificationDTO,
} from './notification.dto';

@ApiTags('Notification')
@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('/trigger')
  @ApiOperation({ summary: 'Trigger birthday push notifications manually' })
  @ApiResponse({
    status: 200,
    description: 'Birthday push notifications processed successfully',
    type: NotificationStatsResponseDTO,
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to process birthday notifications',
  })
  async triggerNotifications(): Promise<NotificationStatsResponseDTO> {
    return await this.notificationService.sendBirthdayNotifications();
  }

  @Post('/weekly')
  @ApiOperation({ summary: 'Generate weekly family notifications' })
  @ApiResponse({
    status: 200,
    description: 'Weekly notifications created successfully',
    type: WeeklyNotificationResponseDTO,
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to create weekly notifications',
  })
  async triggerWeeklyNotifications(): Promise<WeeklyNotificationResponseDTO> {
    return await this.notificationService.sendWeeklyNotifications();
  }

  @Post('/event')
  @ApiOperation({ summary: 'Create event notification' })
  @ApiBody({ type: CreateEventNotificationDTO })
  @ApiResponse({
    status: 200,
    description: 'Event notification created successfully',
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to create event notification',
  })
  async createEventNotification(
    @Body() createEventDto: CreateEventNotificationDTO,
  ) {
    return await this.notificationService.createEventNotification(
      createEventDto.userId,
      createEventDto.eventTitle,
      new Date(createEventDto.eventDate),
      createEventDto.eventDescription,
    );
  }

  @Post('/system')
  @ApiOperation({ summary: 'Create system notification for multiple users' })
  @ApiBody({ type: CreateSystemNotificationDTO })
  @ApiResponse({
    status: 200,
    description: 'System notifications created successfully',
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to create system notifications',
  })
  async createSystemNotification(
    @Body() createSystemDto: CreateSystemNotificationDTO,
  ) {
    return await this.notificationService.createSystemNotification(
      createSystemDto.userIds,
      createSystemDto.message,
    );
  }

  @Get('/dashboard/:userId')
  @ApiOperation({ summary: 'Get dashboard notifications for a user' })
  @ApiParam({ name: 'userId', description: 'User ID', type: 'number' })
  @ApiQuery({
    name: 'limit',
    description: 'Number of notifications to fetch',
    required: false,
    type: 'number',
  })
  @ApiResponse({
    status: 200,
    description: 'Dashboard notifications retrieved successfully',
    type: [DashboardNotificationResponseDTO],
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async getDashboardNotifications(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('limit') limit?: number,
  ) {
    return await this.notificationService.getDashboardNotifications(
      userId,
      limit || 10,
    );
  }

  @Post('/cleanup')
  @ApiOperation({ summary: 'Cleanup old notifications' })
  @ApiQuery({
    name: 'days',
    description: 'Delete notifications older than specified days',
    required: false,
    type: 'number',
  })
  @ApiResponse({
    status: 200,
    description: 'Cleanup completed successfully',
    type: CleanupResponseDTO,
  })
  async cleanupNotifications(
    @Query('days') days?: number,
  ): Promise<CleanupResponseDTO> {
    return await this.notificationService.cleanupOldNotifications(days || 30);
  }

  @Post('/mark-read/:notificationId/:userId')
  @ApiOperation({ summary: 'Mark notification as read' })
  @ApiParam({
    name: 'notificationId',
    description: 'Notification ID',
    type: 'number',
  })
  @ApiParam({ name: 'userId', description: 'User ID', type: 'number' })
  @ApiResponse({
    status: 200,
    description: 'Notification marked as read successfully',
    type: MarkReadResponseDTO,
  })
  @ApiResponse({
    status: 404,
    description: 'Notification not found',
  })
  async markAsRead(
    @Param('notificationId', ParseIntPipe) notificationId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<MarkReadResponseDTO> {
    return await this.notificationService.markNotificationAsRead(
      notificationId,
      userId,
    );
  }
}
