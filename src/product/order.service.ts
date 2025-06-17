import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Order } from './model/order.model';
import { CreateOrderDto } from './dto/order.dto';

@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order)
    private readonly orderModel: typeof Order,
  ) {}

  async create(dto: CreateOrderDto) {
    const order = await this.orderModel.create(dto);
    return {
      message: 'Order created successfully',
      data: order,
    };
  }

  async findAll() {
    const orders = await this.orderModel.findAll();
    return orders;
  }

  async findById(id: number) {
    const order = await this.orderModel.findByPk(id);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  async update(id: number, dto: CreateOrderDto) {
    const order = await this.orderModel.findByPk(id);
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    await order.update(dto);
    return {
      message: 'Order updated successfully',
      data: order,
    };
  }

  async delete(id: number) {
    const order = await this.orderModel.findByPk(id);
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    await order.destroy();
    return {
      message: 'Order deleted successfully',
    };
  }
}
