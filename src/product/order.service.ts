import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Order, DeliveryStatus, PaymentStatus } from './model/order.model';
import { Product } from '../product/model/product.model';
import { CreateOrderDto, UpdateOrderDto, UpdateOrderStatusDto } from './dto/order.dto';

interface FilterOptions {
  userId?: number;
  deliveryStatus?: DeliveryStatus;
  paymentStatus?: PaymentStatus;
}

@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order)
    private orderModel: typeof Order,
  ) {}

  // Create new order
  async create(createOrderDto: CreateOrderDto) {
    try {
      // Validate quantity
      if (createOrderDto.quantity && createOrderDto.quantity < 1) {
        throw new BadRequestException('Quantity must be at least 1');
      }

      // Generate order number if not provided
      if (!createOrderDto.orderNumber) {
        createOrderDto.orderNumber = await this.generateOrderNumber();
      }

      const order = await this.orderModel.create({
        ...createOrderDto,
        deliveryStatus: createOrderDto.deliveryStatus || DeliveryStatus.PENDING,
        paymentStatus: createOrderDto.paymentStatus || PaymentStatus.UNPAID,
        quantity: createOrderDto.quantity || 1, // Ensure quantity has a default value
      }, {
        include: [Product] // Include product details in response
      });

      // Fetch the created order with product relation
      const createdOrder = await this.findById(order.id);

      return {
        success: true,
        message: 'Order created successfully',
        data: createdOrder.data,
      };
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        throw new BadRequestException('Order number already exists');
      }
      throw new BadRequestException(`Failed to create order: ${error.message}`);
    }
  }

  // Generate unique order number
  private async generateOrderNumber(): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD format
    
    // Get the latest order number for today
    const latestOrder = await this.orderModel.findOne({
      where: {
        orderNumber: {
          [Op.like]: `ORD-${dateStr}-%`
        }
      },
      order: [['orderNumber', 'DESC']]
    });

    let nextSequence = 1;
    
    if (latestOrder) {
      // Extract sequence number from the latest order number
      const lastSequence = parseInt(latestOrder.orderNumber.split('-')[2]);
      nextSequence = lastSequence + 1;
    }

    // Generate new order number with 4-digit sequence
    return `ORD-${dateStr}-${nextSequence.toString().padStart(4, '0')}`;
  }

  // Get all orders with optional filters
  async findAll(filters: FilterOptions = {}) {
    try {
      const whereClause: any = {};

      // Apply filters
      if (filters.userId) {
        whereClause.userId = filters.userId;
      }
      if (filters.deliveryStatus) {
        whereClause.deliveryStatus = filters.deliveryStatus;
      }
      if (filters.paymentStatus) {
        whereClause.paymentStatus = filters.paymentStatus;
      }

      const orders = await this.orderModel.findAll({
        where: whereClause,
        include: [Product],
        order: [['createdAt', 'DESC']],
      });

      return {
        success: true,
        message: 'Orders retrieved successfully',
        data: orders,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to retrieve orders: ${error.message}`);
    }
  }

  // Get order by ID
  async findById(id: number) {
    try {
      const order = await this.orderModel.findByPk(id, {
        include: [Product],
      });

      if (!order) {
        throw new NotFoundException(`Order with ID ${id} not found`);
      }

      return {
        success: true,
        message: 'Order retrieved successfully',
        data: order,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to retrieve order: ${error.message}`);
    }
  }

  // Get orders by user ID
  async findByUserId(userId: number) {
    try {
      const orders = await this.orderModel.findAll({
        where: { userId },
        include: [Product],
        order: [['createdAt', 'DESC']],
      });

      return {
        success: true,
        message: 'User orders retrieved successfully',
        data: orders,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to retrieve user orders: ${error.message}`);
    }
  }

  // Get orders by receiver ID
  async findByReceiverId(receiverId: number) {
    try {
      const orders = await this.orderModel.findAll({
        where: { receiverId },
        include: [Product],
        order: [['createdAt', 'DESC']],
      });

      return {
        success: true,
        message: 'Receiver orders retrieved successfully',
        data: orders,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to retrieve receiver orders: ${error.message}`);
    }
  }

  // Get orders by delivery status
  async findByDeliveryStatus(deliveryStatus: DeliveryStatus) {
    try {
      const orders = await this.orderModel.findAll({
        where: { deliveryStatus },
        include: [Product],
        order: [['createdAt', 'DESC']],
      });

      return {
        success: true,
        message: 'Orders by delivery status retrieved successfully',
        data: orders,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to retrieve orders by delivery status: ${error.message}`);
    }
  }

  // Get orders by payment status
  async findByPaymentStatus(paymentStatus: PaymentStatus) {
    try {
      const orders = await this.orderModel.findAll({
        where: { paymentStatus },
        include: [Product],
        order: [['createdAt', 'DESC']],
      });

      return {
        success: true,
        message: 'Orders by payment status retrieved successfully',
        data: orders,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to retrieve orders by payment status: ${error.message}`);
    }
  }

  // Find order by order number
  async findByOrderNumber(orderNumber: string) {
    try {
      const order = await this.orderModel.findOne({
        where: { orderNumber },
        include: [Product],
      });

      if (!order) {
        throw new NotFoundException(`Order with number ${orderNumber} not found`);
      }

      return {
        success: true,
        message: 'Order found successfully',
        data: order,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to find order: ${error.message}`);
    }
  }

  // Update order completely
  async update(id: number, createOrderDto: CreateOrderDto) {
    try {
      const order = await this.orderModel.findByPk(id);

      if (!order) {
        throw new NotFoundException(`Order with ID ${id} not found`);
      }

      // Validate quantity if provided
      if (createOrderDto.quantity && createOrderDto.quantity < 1) {
        throw new BadRequestException('Quantity must be at least 1');
      }

      // Don't allow updating orderNumber through this method
      const { orderNumber, ...updateData } = createOrderDto;

      await order.update(updateData);

      const updatedOrder = await this.findById(id);

      return {
        success: true,
        message: 'Order updated successfully',
        data: updatedOrder.data,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to update order: ${error.message}`);
    }
  }

  // Partial update order
  async partialUpdate(id: number, updateOrderDto: UpdateOrderDto) {
    try {
      const order = await this.orderModel.findByPk(id);

      if (!order) {
        throw new NotFoundException(`Order with ID ${id} not found`);
      }

      // Validate quantity if provided
      if (updateOrderDto.quantity && updateOrderDto.quantity < 1) {
        throw new BadRequestException('Quantity must be at least 1');
      }

      await order.update(updateOrderDto);

      const updatedOrder = await this.findById(id);

      return {
        success: true,
        message: 'Order updated successfully',
        data: updatedOrder.data,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to update order: ${error.message}`);
    }
  }

  // Update delivery status only
  async updateDeliveryStatus(id: number, deliveryStatus: DeliveryStatus) {
    try {
      const order = await this.orderModel.findByPk(id);

      if (!order) {
        throw new NotFoundException(`Order with ID ${id} not found`);
      }

      await order.update({ deliveryStatus });

      return {
        success: true,
        message: 'Delivery status updated successfully',
        data: { id, deliveryStatus },
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to update delivery status: ${error.message}`);
    }
  }

  // Update payment status only
  async updatePaymentStatus(id: number, paymentStatus: PaymentStatus) {
    try {
      const order = await this.orderModel.findByPk(id);

      if (!order) {
        throw new NotFoundException(`Order with ID ${id} not found`);
      }

      await order.update({ paymentStatus });

      return {
        success: true,
        message: 'Payment status updated successfully',
        data: { id, paymentStatus },
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to update payment status: ${error.message}`);
    }
  }

  // Update order status (delivery and payment)
  async updateOrderStatus(id: number, dto: UpdateOrderStatusDto) {
    const order = await this.orderModel.findByPk(id);
    if (!order) throw new NotFoundException('Order not found');
    if (dto.deliveryStatus) order.deliveryStatus = dto.deliveryStatus;
    if (dto.paymentStatus) order.paymentStatus = dto.paymentStatus;
    await order.save();
    return { success: true, message: 'Order status updated', data: order };
  }

  // Delete order permanently
  async delete(id: number) {
    try {
      const order = await this.orderModel.findByPk(id);

      if (!order) {
        throw new NotFoundException(`Order with ID ${id} not found`);
      }

      await order.destroy();

      return {
        success: true,
        message: 'Order deleted successfully',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to delete order: ${error.message}`);
    }
  }

  // Soft delete order (if you implement paranoid mode)
  async softDelete(id: number) {
    try {
      const order = await this.orderModel.findByPk(id);

      if (!order) {
        throw new NotFoundException(`Order with ID ${id} not found`);
      }

      // If using paranoid mode, this will soft delete
      await order.destroy();

      return {
        success: true,
        message: 'Order soft deleted successfully',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(`Failed to soft delete order: ${error.message}`);
    }
  }

  // Get order analytics for dashboard
  async getOrderAnalytics() {
    try {
      const totalOrders = await this.orderModel.count();
      
      const ordersByStatus = await this.orderModel.findAll({
        attributes: [
          'deliveryStatus',
          [this.orderModel.sequelize.fn('COUNT', this.orderModel.sequelize.col('id')), 'count']
        ],
        group: ['deliveryStatus'],
        raw: true,
      });

      const paymentStats = await this.orderModel.findAll({
        attributes: [
          'paymentStatus',
          [this.orderModel.sequelize.fn('COUNT', this.orderModel.sequelize.col('id')), 'count']
        ],
        group: ['paymentStatus'],
        raw: true,
      });

      const revenueData = await this.orderModel.findAll({
        attributes: [
          [this.orderModel.sequelize.fn('SUM', this.orderModel.sequelize.col('price')), 'totalRevenue'],
          [this.orderModel.sequelize.fn('AVG', this.orderModel.sequelize.col('price')), 'averageOrderValue']
        ],
        where: {
          paymentStatus: PaymentStatus.PAID
        },
        raw: true,
      });

      // Today's orders
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todaysOrders = await this.orderModel.count({
        where: {
          createdAt: {
            [Op.gte]: today
          }
        }
      });

      return {
        success: true,
        message: 'Analytics retrieved successfully',
        data: {
          totalOrders,
          ordersByDeliveryStatus: ordersByStatus,
          ordersByPaymentStatus: paymentStats,
          totalRevenue: revenueData[0]?.totalRevenue || 0,
          averageOrderValue: revenueData[0]?.averageOrderValue || 0,
          todaysOrders,
        },
      };
    } catch (error) {
      throw new BadRequestException(`Failed to retrieve analytics: ${error.message}`);
    }
  }
}