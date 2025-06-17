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
    allowNull: false,
  })
  receiverId: number;

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
    allowNull: false,
  })
  duration: number; // Duration in days

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  createdBy: number;

  @ForeignKey(() => Product)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  productId: number;

  @BelongsTo(() => Product)
  product: Product;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: 'pending',
  })
  deliveryStatus: string; // e.g., 'pending', 'shipped', 'delivered', 'cancelled'

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: 'unpaid',
  })
  paymentStatus: string; // e.g., 'unpaid', 'paid', 'refunded'
}
