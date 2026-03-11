import { BadRequestException, Controller, Delete, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminS3Service } from './admin-s3.service';

@ApiTags('Admin')
@Controller('admin/s3')
export class AdminS3Controller {
  constructor(private readonly adminS3Service: AdminS3Service) {}

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get('folders')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List S3 folders (common prefixes) for admin panel' })
  listFolders(@Req() _req, @Query('prefix') prefix?: string) {
    return this.adminS3Service.listFolders(prefix);
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get('objects')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List S3 objects under a prefix for admin panel' })
  listObjects(
    @Req() _req,
    @Query('prefix') prefix?: string,
    @Query('maxKeys') maxKeys?: string,
    @Query('continuationToken') continuationToken?: string,
  ) {
    return this.adminS3Service.listObjects({
      prefix,
      maxKeys: maxKeys ? Number(maxKeys) : undefined,
      continuationToken,
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Delete('object')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a single S3 object by key (admin/superadmin)' })
  deleteObject(@Req() _req, @Query('key') key?: string) {
    const cleaned = String(key || '').trim().replace(/^\//, '');
    if (!cleaned) throw new BadRequestException('key is required');
    return this.adminS3Service.deleteObject(cleaned);
  }
}
