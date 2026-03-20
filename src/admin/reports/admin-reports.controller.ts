import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminReportsService } from './admin-reports.service';
import { UpdateContentReportDto } from './dto/update-content-report.dto';

@ApiTags('Admin')
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly adminReportsService: AdminReportsService) {}

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List content reports (admin/superadmin)' })
  listReports(
    @Req() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('reporterUserId') reporterUserId?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminReportsService.listReports(req.user, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      status,
      targetType,
      targetId,
      reporterUserId,
      q,
      from,
      to,
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Patch(':id')
  @ApiBearerAuth()
  @ApiBody({ type: UpdateContentReportDto })
  @ApiOperation({ summary: 'Update content report status/note (admin/superadmin)' })
  updateReport(@Req() req, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateContentReportDto) {
    return this.adminReportsService.updateReport(req.user, id, {
      status: dto?.status,
      adminNote: dto?.adminNote,
    });
  }
}
