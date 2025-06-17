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
} from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/order.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Order Module')
@Controller('order')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post('create')
  @ApiOperation({ summary: 'Create a new order' })
  @ApiResponse({ status: 201, description: 'Order created successfully' })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateOrderDto) {
    return this.orderService.create(body);
  }

  @Get()
  @ApiOperation({ summary: 'Get all orders' })
  @ApiResponse({ status: 200, description: 'List of orders' })
  async findAll() {
    return this.orderService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by ID' })
  @ApiResponse({ status: 200, description: 'Order found' })
  async findOne(@Param('id') id: number) {
    return this.orderService.findById(id);
  }

  @Put(':id')
  async update(@Param('id') id: number, @Body() body: CreateOrderDto) {
    return this.orderService.update(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete order by ID' })
  @ApiResponse({ status: 200, description: 'Order deleted' })
  async delete(@Param('id') id: number) {
    return this.orderService.delete(id);
  }
}
