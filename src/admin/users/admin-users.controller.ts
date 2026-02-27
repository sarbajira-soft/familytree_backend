import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminUsersService } from './admin-users.service';

@ApiTags('Admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List app users for admin panel (admin/superadmin)' })
  users(
    @Req() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('role') role?: string,
  ) {
    return this.adminUsersService.listAppUsers(req.user, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      q,
      status: status !== undefined ? Number(status) : undefined,
      role: role !== undefined ? Number(role) : undefined,
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id/posts')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List posts created by an app user (admin/superadmin)' })
  userPosts(
    @Req() req,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('privacy') privacy?: string,
    @Query('media') media?: string,
  ) {
    return this.adminUsersService.listUserPosts(req.user, Number(id), {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      q,
      privacy,
      media,
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get app user details for admin panel (admin/superadmin)' })
  userById(@Req() req, @Param('id') id: string) {
    return this.adminUsersService.getAppUserById(req.user, Number(id));
  }
}
