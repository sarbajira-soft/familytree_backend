import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/public.decorator';
import { AdminService } from './admin.service';
import { AdminLoginDto } from './dto/admin-login.dto';

@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

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
}
