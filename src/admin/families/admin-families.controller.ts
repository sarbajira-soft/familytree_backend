import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminFamiliesService } from './admin-families.service';

@ApiTags('Admin')
@Controller('admin/families')
export class AdminFamiliesController {
  constructor(private readonly adminFamiliesService: AdminFamiliesService) {}

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get('stats')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get families stats for admin panel (admin/superadmin)' })
  familiesStats(@Req() req) {
    return this.adminFamiliesService.getFamiliesStats(req.user);
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all families (admin/superadmin)' })
  listFamilies(
    @Req() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('createdBy') createdBy?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminFamiliesService.listFamilies(req.user, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      q,
      status: status !== undefined && status !== null && status !== '' ? Number(status) : undefined,
      createdBy: createdBy ? Number(createdBy) : undefined,
      from,
      to,
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id/members')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get family members for admin panel (admin/superadmin)' })
  familyMembers(@Req() req, @Param('id') id: string) {
    return this.adminFamiliesService.getFamilyMembers(req.user, Number(id));
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get family details for admin panel (admin/superadmin)' })
  familyById(@Req() req, @Param('id') id: string) {
    return this.adminFamiliesService.getFamilyById(req.user, Number(id));
  }
}
