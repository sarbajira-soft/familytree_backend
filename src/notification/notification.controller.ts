import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationService } from './notification.service';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { CreateNotificationDto } from './dto/create-notification.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new notification and assign recipients' })
  async createNotification(
    @Body() dto: CreateNotificationDto,
    @Req() req,
  ) {
    return this.notificationService.createNotification(dto, req.user.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all notifications for logged-in user' })
  async getMyNotifications(@Req() req) {
    return this.notificationService.getNotificationsForUser(req.user.userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a specific notification as read' })
  async markAsRead(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ) {
    return this.notificationService.markNotificationAsRead(id, req.user.userId);
  }

  @Get('unread/count')
  @ApiOperation({ summary: 'Get count of unread notifications' })
  async getUnreadCount(@Req() req) {
    return this.notificationService.getUnreadCount(req.user.userId);
  }
}
