import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Put,
  Delete,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Query,
  Patch,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto, UpdateOrderDto, UpdateOrderStatusDto } from './dto/order.dto';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { DeliveryStatus, PaymentStatus } from './model/order.model';

@ApiTags('Order Module')
@Controller('order')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  

  @Post('create')
  @ApiOperation({ summary: 'Create a new order' })
  @ApiResponse({ status: 201, description: 'Order created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid input data' })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createOrderDto: CreateOrderDto) {
    return this.orderService.create(createOrderDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all orders with optional filters' })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by user ID' })
  @ApiQuery({ name: 'deliveryStatus', required: false, enum: DeliveryStatus, description: 'Filter by delivery status' })
  @ApiQuery({ name: 'paymentStatus', required: false, enum: PaymentStatus, description: 'Filter by payment status' })
  @ApiResponse({ status: 200, description: 'List of orders retrieved successfully' })
  async findAll(
    @Query('userId') userId?: number,
    @Query('deliveryStatus') deliveryStatus?: DeliveryStatus,
    @Query('paymentStatus') paymentStatus?: PaymentStatus,
  ) {
    return this.orderService.findAll({
      userId,
      deliveryStatus,
      paymentStatus,
    });
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get orders by user ID' })
  @ApiParam({ name: 'userId', description: 'User ID to fetch orders for' })
  @ApiResponse({ status: 200, description: 'User orders retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found or no orders' })
  async findByUserId(@Param('userId', ParseIntPipe) userId: number) {
    return this.orderService.findByUserId(userId);
  }

  @Get('receiver/:receiverId')
  @ApiOperation({ summary: 'Get orders by receiver ID' })
  @ApiParam({ name: 'receiverId', description: 'Receiver ID to fetch orders for' })
  @ApiResponse({ status: 200, description: 'Receiver orders retrieved successfully' })
  async findByReceiverId(@Param('receiverId', ParseIntPipe) receiverId: number) {
    return this.orderService.findByReceiverId(receiverId);
  }

  @Get('receiver/null')
  @ApiOperation({ summary: 'Get orders with null receiver ID' })
  @ApiResponse({ status: 200, description: 'Orders with null receiver ID retrieved successfully' })
  async findOrdersWithNullReceiver() {
    return this.orderService.findOrdersWithNullReceiver();
  }

  @Get('status/delivery/:status')
  @ApiOperation({ summary: 'Get orders by delivery status' })
  @ApiParam({ name: 'status', enum: DeliveryStatus, description: 'Delivery status to filter by' })
  @ApiResponse({ status: 200, description: 'Orders by delivery status retrieved successfully' })
  async findByDeliveryStatus(@Param('status') status: DeliveryStatus) {
    return this.orderService.findByDeliveryStatus(status);
  }

  @Get('status/payment/:status')
  @ApiOperation({ summary: 'Get orders by payment status' })
  @ApiParam({ name: 'status', enum: PaymentStatus, description: 'Payment status to filter by' })
  @ApiResponse({ status: 200, description: 'Orders by payment status retrieved successfully' })
  async findByPaymentStatus(@Param('status') status: PaymentStatus) {
    return this.orderService.findByPaymentStatus(status);
  }

  @Get('search/:orderNumber')
  @ApiOperation({ summary: 'Search order by order number' })
  @ApiParam({ name: 'orderNumber', description: 'Order number to search for' })
  @ApiResponse({ status: 200, description: 'Order found successfully' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async findByOrderNumber(@Param('orderNumber') orderNumber: string) {
    return this.orderService.findByOrderNumber(orderNumber);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by ID' })
  @ApiParam({ name: 'id', description: 'Order ID' })
  @ApiResponse({ status: 200, description: 'Order found successfully' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.orderService.findById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update order completely' })
  @ApiParam({ name: 'id', description: 'Order ID to update' })
  @ApiResponse({ status: 200, description: 'Order updated successfully' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid input data' })
  async update(
    @Param('id', ParseIntPipe) id: number, 
    @Body() createOrderDto: CreateOrderDto
  ) {
    return this.orderService.update(id, createOrderDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update order partially' })
  @ApiParam({ name: 'id', description: 'Order ID to update' })
  @ApiResponse({ status: 200, description: 'Order updated successfully' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async partialUpdate(
    @Param('id', ParseIntPipe) id: number, 
    @Body() updateOrderDto: UpdateOrderDto
  ) {
    return this.orderService.partialUpdate(id, updateOrderDto);
  }

  @Patch(':id/delivery-status')
  @ApiOperation({ summary: 'Update delivery status only' })
  @ApiParam({ name: 'id', description: 'Order ID' })
  @ApiResponse({ status: 200, description: 'Delivery status updated successfully' })
  async updateDeliveryStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('deliveryStatus') deliveryStatus: DeliveryStatus
  ) {
    return this.orderService.updateDeliveryStatus(id, deliveryStatus);
  }

  @Patch(':id/payment-status')
  @ApiOperation({ summary: 'Update payment status only' })
  @ApiParam({ name: 'id', description: 'Order ID' })
  @ApiResponse({ status: 200, description: 'Payment status updated successfully' })
  async updatePaymentStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('paymentStatus') paymentStatus: PaymentStatus
  ) {
    return this.orderService.updatePaymentStatus(id, paymentStatus);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update only paymentStatus and deliveryStatus for an order' })
  @ApiBody({
    description: `Allowed values:\n\n- deliveryStatus: pending, confirmed, shipped, in_transit, out_for_delivery, delivered, cancelled, returned\n- paymentStatus: unpaid, pending, paid, failed, refunded, partial_refund`,
    schema: {
      type: 'object',
      properties: {
        deliveryStatus: {
          type: 'string',
          enum: Object.values(DeliveryStatus),
          example: 'pending',
        },
        paymentStatus: {
          type: 'string',
          enum: Object.values(PaymentStatus),
          example: 'unpaid',
        },
      },
    },
  })
  async updateOrderStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto
  ) {
    return this.orderService.updateOrderStatus(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete order by ID' })
  @ApiParam({ name: 'id', description: 'Order ID to delete' })
  @ApiResponse({ 
    status: 200, 
    description: 'Order deleted successfully',
    schema: {
      example: {
        success: true,
        message: 'Order deleted successfully'
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async delete(@Param('id', ParseIntPipe) id: number) {
    return this.orderService.delete(id);
  }

  @Delete('soft/:id')
  @ApiOperation({ summary: 'Soft delete order by ID' })
  @ApiParam({ name: 'id', description: 'Order ID to soft delete' })
  @ApiResponse({ status: 200, description: 'Order soft deleted successfully' })
  async softDelete(@Param('id', ParseIntPipe) id: number) {
    return this.orderService.softDelete(id);
  }

  // Dashboard/Analytics endpoints
  @Get('analytics/summary')
  @ApiOperation({ summary: 'Get order analytics summary' })
  @ApiResponse({ 
    status: 200, 
    description: 'Order analytics retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          totalOrders: 150,
          pendingOrders: 25,
          completedOrders: 100,
          cancelledOrders: 25,
          totalRevenue: 75000.00,
          averageOrderValue: 500.00
        }
      }
    }
  })
  async getOrderAnalytics() {
    return this.orderService.getOrderAnalytics();
  }
}