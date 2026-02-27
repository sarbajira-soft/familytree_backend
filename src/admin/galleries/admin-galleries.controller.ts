import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminGalleriesService } from './admin-galleries.service';

@ApiTags('Admin')
@Controller('admin/galleries')
export class AdminGalleriesController {
  constructor(private readonly adminGalleriesService: AdminGalleriesService) {}

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get('stats')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get galleries stats for admin panel (admin/superadmin)' })
  galleriesStats(@Req() req) {
    return this.adminGalleriesService.getGalleriesStats(req.user);
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all galleries (admin/superadmin)' })
  listGalleries(
    @Req() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('privacy') privacy?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminGalleriesService.listGalleries(req.user, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      q,
      privacy,
      userId: userId ? Number(userId) : undefined,
      from,
      to,
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get gallery details for admin panel (admin/superadmin)' })
  galleryById(@Req() req, @Param('id') id: string) {
    return this.adminGalleriesService.getGalleryById(req.user, Number(id));
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id/likes')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List gallery likes for admin panel (admin/superadmin)' })
  galleryLikes(
    @Req() req,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminGalleriesService.listGalleryLikes(req.user, Number(id), {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id/comments')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List gallery comments for admin panel (admin/superadmin)' })
  galleryComments(
    @Req() req,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminGalleriesService.listGalleryComments(req.user, Number(id), {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
    });
  }
}
