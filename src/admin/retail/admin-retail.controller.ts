import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminRetailService } from './admin-retail.service';

@ApiTags('Admin')
@Controller('admin/retail')
export class AdminRetailController {
  constructor(private readonly adminRetailService: AdminRetailService) {}

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get('orders')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all retail (Medusa) orders for admin panel (admin/superadmin)' })
  listOrders(
    @Req() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('payment') payment?: string,
    @Query('fulfillment') fulfillment?: string,
  ) {
    return this.adminRetailService.listOrders(req.user, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      q,
      status,
      payment,
      fulfillment,
    });
  }

  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles('admin', 'superadmin')
  @Get('orders/:orderId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get retail (Medusa) order details for admin panel (admin/superadmin)' })
  orderById(@Req() req, @Param('orderId') orderId: string) {
    return this.adminRetailService.getOrder(req.user, orderId);
  }
}
