import { Body, Controller, Delete, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminEventsService } from './admin-events.service';
import { UpdateAdminEventDto } from './dto/update-admin-event.dto';

@ApiTags('Admin')
@Controller('admin/events')
export class AdminEventsController {
  constructor(private readonly adminEventsService: AdminEventsService) {}

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get('stats')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get events stats for admin panel (admin/superadmin)' })
  eventsStats(@Req() req) {
    return this.adminEventsService.getEventsStats(req.user);
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all events (admin/superadmin)' })
  listEvents(
    @Req() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('familyCode') familyCode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('deleted') deleted?: string,
  ) {
    return this.adminEventsService.listEvents(req.user, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      q,
      status: status !== undefined && status !== null && status !== '' ? Number(status) : undefined,
      userId: userId ? Number(userId) : undefined,
      familyCode,
      from,
      to,
      deleted: deleted === 'only' || deleted === 'exclude' || deleted === 'all' ? (deleted as any) : 'exclude',
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Patch(':id/delete')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft delete an event (admin/superadmin)' })
  softDelete(@Req() req, @Param('id') id: string) {
    return this.adminEventsService.softDeleteEvent(req.user, Number(id));
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Patch(':id/restore')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Restore a soft deleted event (admin/superadmin)' })
  restore(@Req() req, @Param('id') id: string) {
    return this.adminEventsService.restoreEvent(req.user, Number(id));
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Delete(':id/purge')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Permanently delete a soft deleted event (admin/superadmin)' })
  purge(@Req() req, @Param('id') id: string) {
    return this.adminEventsService.purgeEvent(req.user, Number(id));
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an event (admin/superadmin)' })
  updateEvent(@Req() req, @Param('id') id: string, @Body() dto: UpdateAdminEventDto) {
    return this.adminEventsService.updateEvent(req.user, Number(id), dto);
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get event details for admin panel (admin/superadmin)' })
  eventById(@Req() req, @Param('id') id: string) {
    return this.adminEventsService.getEventById(req.user, Number(id));
  }
}
