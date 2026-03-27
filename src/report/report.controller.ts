import { Body, Controller, HttpCode, HttpStatus, Post as HttpPost, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';

import { CreateReportDto } from './dto/create-report.dto';
import { ReportService } from './report.service';

@ApiTags('Reports')
@Controller('report')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpPost()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Report content (post/gallery/event)' })
  @ApiResponse({ status: 201, description: 'Report created (or already exists)' })
  async create(@Body() dto: CreateReportDto, @Req() req) {
    const userId = req.user?.userId;
    return this.reportService.createReport({
      reportedByUserId: userId,
      targetType: dto?.targetType,
      targetId: dto?.targetId,
      reason: dto?.reason,
      description: dto?.description,
    });
  }
}
