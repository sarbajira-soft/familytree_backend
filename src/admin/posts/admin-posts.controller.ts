import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
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
  postLikes(@Req() req, @Param('id') id: string) {
    return this.adminPostsService.listPostLikes(req.user, Number(id));
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get(':id/comments')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List post comments for admin panel (admin/superadmin)' })
  postComments(@Req() req, @Param('id') id: string) {
    return this.adminPostsService.listPostComments(req.user, Number(id));
  }
}
