import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from '../auth/public.decorator';
import { AdminService } from './admin.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { AdminJwtAuthGuard } from './auth/admin-jwt-auth.guard';
import { AdminRolesGuard } from './auth/admin-roles.guard';
import { AdminRoles } from './auth/admin-roles.decorator';
import { AdminAuditLogService } from './admin-audit-log.service';

@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminAuditLogService: AdminAuditLogService,
  ) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Admin login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 400, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'Admin inactive' })
  @ApiBody({ type: AdminLoginDto })
  @ApiBearerAuth()
  async login(@Body() dto: AdminLoginDto) {
    return this.adminService.login(dto);
  }

  @UseGuards(AdminJwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current admin profile' })
  me(@Req() req) {
    return this.adminService.me(req.user);
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('superadmin')
  @Get('accounts')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List admin accounts (superadmin only)' })
  listAdmins(@Req() req) {
    return this.adminService.listAdmins(req.user);
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('superadmin')
  @Post('accounts')
  @ApiBearerAuth()
  @ApiBody({ type: CreateAdminDto })
  @ApiOperation({ summary: 'Create a new admin account (superadmin only)' })
  createAdmin(@Req() req, @Body() dto: CreateAdminDto) {
    return this.adminService.createAdmin(req.user, dto);
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('superadmin')
  @Patch('accounts/:id')
  @ApiBearerAuth()
  @ApiBody({ type: UpdateAdminDto })
  @ApiOperation({ summary: 'Update an admin account (superadmin only)' })
  updateAdmin(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAdminDto,
  ) {
    return this.adminService.updateAdmin(req.user, id, dto);
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('superadmin')
  @Delete('accounts/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete an admin account (superadmin only)' })
  deleteAdmin(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.adminService.deleteAdmin(req.user, id);
  }

  @UseGuards(AdminJwtAuthGuard)
  @Get('audit-logs')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Fetch current admin audit logs' })
  auditLogs(
    @Req() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminAuditLogService.fetchOwnLogs(
      Number(req.user?.adminId),
      page ? Number(page) : 1,
      limit ? Number(limit) : 25,
    );
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('superadmin')
  @Get('audit-logs/all')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Fetch all admins audit logs (superadmin only)' })
  auditLogsAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminAuditLogService.fetchAllLogs(
      page ? Number(page) : 1,
      limit ? Number(limit) : 25,
    );
  }
}
