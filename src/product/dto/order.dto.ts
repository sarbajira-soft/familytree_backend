import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsNumber,
  Min,
  IsOptional,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOrderDto {
  @ApiProperty({
    example: 'ORD-20250617-0001',
    description: 'Unique order number',
  })
  @IsString()
  @IsNotEmpty({ message: 'Order number is required' })
  orderNumber: string;

  @ApiProperty({
    example: 101,
    description: 'ID of the user who placed the order',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'User ID must be a number' })
  userId: number;

  @ApiProperty({
    example: 202,
    description: 'ID of the receiver of the order',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Receiver ID must be a number' })
  receiverId: number;

  @ApiProperty({
    example: 'Chennai',
    description: 'Source location of the order',
  })
  @IsString()
  @IsNotEmpty({ message: 'From location is required' })
  from: string;

  @ApiProperty({
    example: 'Bangalore',
    description: 'Destination location of the order',
  })
  @IsString()
  @IsNotEmpty({ message: 'To location is required' })
  to: string;

  @ApiProperty({
    example: 3,
    description: 'Duration in days',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Duration must be a number' })
  @Min(1, { message: 'Duration must be at least 1 day' })
  duration: number;

  @ApiProperty({
    example: 101,
    description: 'ID of the user who created the order',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'CreatedBy must be a number' })
  createdBy: number;

  @ApiProperty({
    example: 1,
    description: 'ID of the product being ordered',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Product ID must be a number' })
  productId: number;

  @ApiProperty({
    example: 799.99,
    description: 'Price of the product at time of order',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Price must be a number' })
  @Min(0, { message: 'Price cannot be negative' })
  price: number;

  @ApiProperty({
    example: 'pending',
    description: 'Status of the delivery',
    enum: ['pending', 'shipped', 'delivered', 'cancelled'],
  })
  @IsString()
  @IsIn(['pending', 'shipped', 'delivered', 'cancelled'], {
    message:
      'Delivery status must be one of: pending, shipped, delivered, cancelled',
  })
  deliveryStatus: string;

  @ApiProperty({
    example: 'unpaid',
    description: 'Status of the payment',
    enum: ['unpaid', 'paid', 'refunded'],
  })
  @IsString()
  @IsIn(['unpaid', 'paid', 'refunded'], {
    message: 'Payment status must be one of: unpaid, paid, refunded',
  })
  paymentStatus: string;
}
