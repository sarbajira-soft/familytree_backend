import { Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminPostsService } from './admin-posts.service';

@ApiTags('Admin')
@Controller('admin/posts')
export class AdminPostsController {
  constructor(private readonly adminPostsService: AdminPostsService) {}

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all posts (admin/superadmin)' })
  listPosts(
    @Req() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('privacy') privacy?: string,
    @Query('media') media?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminPostsService.listPosts(req.user, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      q,
      status,
      privacy,
      media,
      userId: userId ? Number(userId) : undefined,
      from,
      to,
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Patch(':id/delete')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft delete a post (admin/superadmin)' })
  softDelete(@Req() req, @Param('id') id: string) {
    return this.adminPostsService.softDeletePost(req.user, Number(id));
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Patch(':id/restore')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Restore a soft deleted post (admin/superadmin)' })
  restore(@Req() req, @Param('id') id: string) {
    return this.adminPostsService.restorePost(req.user, Number(id));
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get('stats')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get posts stats for admin panel (admin/superadmin)' })
  postsStats(@Req() req) {
    return this.adminPostsService.getPostsStats(req.user);
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get post details for admin panel (admin/superadmin)' })
  postById(@Req() req, @Param('id') id: string) {
    return this.adminPostsService.getPostById(req.user, Number(id));
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id/likes')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List post likes for admin panel (admin/superadmin)' })
  postLikes(
    @Req() req,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminPostsService.listPostLikes(req.user, Number(id), {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id/comments')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List post comments for admin panel (admin/superadmin)' })
  postComments(
    @Req() req,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminPostsService.listPostComments(req.user, Number(id), {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
    });
  }
}
