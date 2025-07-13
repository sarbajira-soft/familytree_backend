import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo,
  Unique,
} from 'sequelize-typescript';
import { Product } from '../../product/model/product.model';

// Enums for better type safety and consistency
export enum DeliveryStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  SHIPPED = 'shipped',
  IN_TRANSIT = 'in_transit',
  OUT_FOR_DELIVERY = 'out_for_delivery',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  RETURNED = 'returned'
}

export enum PaymentStatus {
  UNPAID = 'unpaid',
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  PARTIAL_REFUND = 'partial_refund'
}

@Table({ tableName: 'ft_order' })
export class Order extends Model<Order> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @Unique
  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  orderNumber: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  receiverId?: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  receiverName: string; // Added receiver name field

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  from: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  to: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: true, // Made optional
  })
  duration?: number; // Duration in days - now optional

  @ForeignKey(() => Product)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  productId: number;

  @BelongsTo(() => Product)
  product: Product;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
  })
  price: number;

  @Column({
    type: DataType.ENUM(...Object.values(DeliveryStatus)),
    allowNull: false,
    defaultValue: DeliveryStatus.PENDING,
  })
  deliveryStatus: DeliveryStatus;

  @Column({
    type: DataType.ENUM(...Object.values(PaymentStatus)),
    allowNull: false,
    defaultValue: PaymentStatus.UNPAID,
  })
  paymentStatus: PaymentStatus;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  createdBy: number;

  // New fields added
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 1,
  })
  quantity: number;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  deliveryInstructions?: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  giftMessage?: string;

  totalRevenue: number;
  averageOrderValue: number;
}