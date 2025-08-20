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
  Patch,
  Query,
  BadRequestException,
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
  @ApiOperation({ summary: 'Get notifications for logged-in user' })
  async getMyNotifications(@Req() req, @Query('all') all: boolean) {
    const showAll = all === true;
    return this.notificationService.getNotificationsForUser(req.user.userId, showAll);
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

  @Patch('mark-all-read')
  @ApiOperation({ summary: 'Mark all notifications as read for the logged-in user' })
  async markAllAsRead(@Req() req) {
    return this.notificationService.markAllAsRead(req.user.userId);
  }

  @Get(':familyCode/admins')
  @ApiOperation({ summary: 'Get admin user IDs for a family' })
  async getAdminsForFamily(@Param('familyCode') familyCode: string) {
    const adminUserIds = await this.notificationService.getAdminsForFamily(familyCode);
    return { message: 'Admin user IDs fetched successfully', data: adminUserIds };
  }

  @Get(':familyCode/join-requests')
  @ApiOperation({ summary: 'Get FAMILY_JOIN_REQUEST notifications for a family by familyCode' })
  async getFamilyJoinRequestNotifications(@Param('familyCode') familyCode: string) {
    const data = await this.notificationService.getFamilyJoinRequestNotifications(familyCode);
    return { message: 'FAMILY_JOIN_REQUEST notifications fetched successfully', data };
  }

  @Post('respond')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Respond to a notification (accept/reject)' })
  async respondToNotification(
    @Body() body: { notificationId: number; action: 'accept' | 'reject' },
    @Req() req,
  ) {
    if (!body.notificationId || !body.action) {
      throw new BadRequestException('notificationId and action are required');
    }
    
    if (!['accept', 'reject'].includes(body.action)) {
      throw new BadRequestException('Action must be either "accept" or "reject"');
    }

    return this.notificationService.respondToNotification(
      body.notificationId,
      body.action as 'accept' | 'reject',
      req.user.userId,
    );
  }
}
