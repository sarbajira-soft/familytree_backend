import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminGalleriesService } from './admin-galleries.service';
import { GalleryRetentionService } from '../../gallery/gallery-retention.service';
import { imageFileFilter } from '../../utils/upload.utils';
import { UpdateAdminGalleryDto } from './dto/update-admin-gallery.dto';

@ApiTags('Admin')
@Controller('admin/galleries')
export class AdminGalleriesController {
  constructor(
    private readonly adminGalleriesService: AdminGalleriesService,
    private readonly galleryRetentionService: GalleryRetentionService,
  ) {}

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Post('purge-retention')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Manually trigger retention purge for soft deleted galleries older than 60 days (admin/superadmin)' })
  triggerPurgeRetention(@Req() req) {
    return this.galleryRetentionService.purgeSoftDeletedGalleriesOlderThan(60);
  }

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
    @Query('status') status?: string,
  ) {
    return this.adminGalleriesService.listGalleries(req.user, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      q,
      privacy,
      userId: userId ? Number(userId) : undefined,
      from,
      to,
      status,
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Post(':id/soft-delete')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft delete gallery (admin/superadmin)' })
  softDeleteGallery(@Req() req, @Param('id') id: string) {
    return this.adminGalleriesService.softDeleteGallery(req.user, Number(id));
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Post(':id/restore')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Restore soft deleted gallery (admin/superadmin)' })
  restoreGallery(@Req() req, @Param('id') id: string) {
    return this.adminGalleriesService.restoreGallery(req.user, Number(id));
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Delete(':id/purge')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Permanently delete (purge) soft deleted gallery (admin/superadmin)' })
  purgeGallery(@Req() req, @Param('id') id: string) {
    return this.adminGalleriesService.purgeGallery(req.user, Number(id));
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
  @Patch(':id')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'coverPhoto', maxCount: 1 },
        { name: 'images', maxCount: 20 },
      ],
      {
        storage: memoryStorage(),
        fileFilter: imageFileFilter,
        limits: { fileSize: 5 * 1024 * 1024 },
      },
    ),
  )
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update gallery (admin/superadmin)' })
  updateGallery(
    @Req() req,
    @Param('id') id: string,
    @UploadedFiles() files: { coverPhoto?: Express.Multer.File[]; images?: Express.Multer.File[] },
    @Body() dto: UpdateAdminGalleryDto,
  ) {
    return this.adminGalleriesService.updateGallery(req.user, Number(id), dto, files?.coverPhoto?.[0] || null, files?.images || []);
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

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Post('comments/:commentId/delete')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft delete a gallery comment (admin/superadmin)' })
  softDeleteGalleryComment(@Req() req, @Param('commentId') commentId: string) {
    return this.adminGalleriesService.softDeleteGalleryComment(req.user, Number(commentId));
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get('comments/deleted')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List deleted gallery comments for trash bin (admin/superadmin)' })
  listDeletedGalleryComments(@Req() req, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminGalleriesService.listDeletedGalleryComments(req.user, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Post('comments/:commentId/restore')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Restore a deleted gallery comment (admin/superadmin)' })
  restoreGalleryComment(@Req() req, @Param('commentId') commentId: string) {
    return this.adminGalleriesService.restoreGalleryComment(req.user, Number(commentId));
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Delete('comments/:commentId/purge')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Permanently delete (purge) a deleted gallery comment (admin/superadmin)' })
  purgeGalleryComment(@Req() req, @Param('commentId') commentId: string) {
    return this.adminGalleriesService.purgeGalleryComment(req.user, Number(commentId));
  }
}
