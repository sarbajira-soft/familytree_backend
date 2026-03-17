import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
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
  @Get('stats')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get app users stats for admin panel (admin/superadmin)' })
  usersStats(@Req() req) {
    return this.adminUsersService.getUsersStats(req.user);
  }

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
  @Get('non-app')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List non-app users for admin panel (admin/superadmin)' })
  nonAppUsers(
    @Req() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('role') role?: string,
  ) {
    return this.adminUsersService.listNonAppUsers(req.user, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      q,
      status: status !== undefined ? Number(status) : undefined,
      role: role !== undefined ? Number(role) : undefined,
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get('non-app/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get non-app user details for admin panel (admin/superadmin)' })
  nonAppUserById(@Req() req, @Param('id') id: string) {
    return this.adminUsersService.getNonAppUserById(req.user, Number(id));
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
  @Get(':id/galleries')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List galleries created by an app user (admin/superadmin)' })
  userGalleries(
    @Req() req,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('privacy') privacy?: string,
  ) {
    return this.adminUsersService.listUserGalleries(req.user, Number(id), {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      q,
      privacy,
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id/events')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List events created by an app user (admin/superadmin)' })
  userEvents(
    @Req() req,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('familyCode') familyCode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminUsersService.listUserEvents(req.user, Number(id), {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      q,
      status: status !== undefined && status !== null && status !== '' ? Number(status) : undefined,
      familyCode,
      from,
      to,
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id/family')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get an app user's family (by userProfile.familyCode) for admin panel (admin/superadmin)" })
  userFamily(@Req() req, @Param('id') id: string) {
    return this.adminUsersService.getUserFamily(req.user, Number(id));
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id/medusa-customer')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Medusa customer details for an app user (admin/superadmin)' })
  medusaCustomer(@Req() req, @Param('id') id: string) {
    return this.adminUsersService.getUserMedusaCustomer(req.user, Number(id));
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Post(':id/medusa-resync')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resync / create Medusa customer for an app user (admin/superadmin)' })
  resyncMedusaCustomer(@Req() req, @Param('id') id: string) {
    return this.adminUsersService.resyncUserMedusaCustomer(req.user, Number(id));
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id/medusa-orders')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List Medusa orders for an app user (admin/superadmin)' })
  medusaOrders(
    @Req() req,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminUsersService.listUserMedusaOrders(req.user, Number(id), {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id/medusa-orders/:orderId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Medusa order details for an app user (admin/superadmin)' })
  medusaOrderById(
    @Req() req,
    @Param('id') id: string,
    @Param('orderId') orderId: string,
  ) {
    return this.adminUsersService.getUserMedusaOrder(req.user, Number(id), orderId);
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
