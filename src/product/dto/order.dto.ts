import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsNumber,
  Min,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryStatus, PaymentStatus } from '../model/order.model';

export class CreateOrderDto {
  @ApiProperty({
    example: 'ORD-20250626-0001',
    description: 'Unique order number (auto-generated if not provided)',
    required: false,
  })
  @IsString()
  @IsOptional()
  orderNumber?: string; // Made optional since it's auto-generated

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
    example: 'John Doe',
    description: 'Name of the receiver',
  })
  @IsString()
  @IsNotEmpty({ message: 'Receiver name is required' })
  receiverName: string; // Added receiver name field

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
    description: 'Duration in days (optional)',
    required: false,
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Duration must be a number' })
  @Min(1, { message: 'Duration must be at least 1 day' })
  @IsOptional() // Made optional as per your request
  duration?: number;

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
    example: 1500.00,
    description: 'Price of the product at time of order',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Price must be a number' })
  @Min(0, { message: 'Price cannot be negative' })
  price: number;

  @ApiProperty({
    example: DeliveryStatus.PENDING,
    description: 'Status of the delivery',
    enum: DeliveryStatus,
    default: DeliveryStatus.PENDING,
    required: false,
  })
  @IsEnum(DeliveryStatus, {
    message: `Delivery status must be one of: ${Object.values(DeliveryStatus).join(', ')}`,
  })
  @IsOptional() // Optional with default value
  deliveryStatus?: DeliveryStatus;

  @ApiProperty({
    example: PaymentStatus.UNPAID,
    description: 'Status of the payment',
    enum: PaymentStatus,
    default: PaymentStatus.UNPAID,
    required: false,
  })
  @IsEnum(PaymentStatus, {
    message: `Payment status must be one of: ${Object.values(PaymentStatus).join(', ')}`,
  })
  @IsOptional() // Optional with default value
  paymentStatus?: PaymentStatus;

  // New fields added
  @ApiProperty({
    example: 1,
    description: 'Quantity of the product being ordered',
    default: 1,
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Quantity must be a number' })
  @Min(1, { message: 'Quantity must be at least 1' })
  quantity: number;

  @ApiProperty({
    example: 'Please deliver to the back door',
    description: 'Special delivery instructions (optional)',
    required: false,
  })
  @IsString()
  @IsOptional()
  deliveryInstructions?: string;

  @ApiProperty({
    example: 'Happy Birthday! Hope you enjoy this gift',
    description: 'Gift message to include with the order (optional)',
    required: false,
  })
  @IsString()
  @IsOptional()
  giftMessage?: string;
}

// Update Order DTO for partial updates
export class UpdateOrderDto {
  @ApiProperty({
    example: 'John Smith',
    description: 'Name of the receiver',
    required: false,
  })
  @IsString()
  @IsOptional()
  receiverName?: string;

  @ApiProperty({
    example: 'Coimbatore',
    description: 'Source location of the order',
    required: false,
  })
  @IsString()
  @IsOptional()
  from?: string;

  @ApiProperty({
    example: 'Mumbai',
    description: 'Destination location of the order',
    required: false,
  })
  @IsString()
  @IsOptional()
  to?: string;

  @ApiProperty({
    example: 5,
    description: 'Duration in days',
    required: false,
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Duration must be a number' })
  @Min(1, { message: 'Duration must be at least 1 day' })
  @IsOptional()
  duration?: number;

  @ApiProperty({
    example: 1299.99,
    description: 'Updated price of the product',
    required: false,
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Price must be a number' })
  @Min(0, { message: 'Price cannot be negative' })
  @IsOptional()
  price?: number;

  @ApiProperty({
    example: DeliveryStatus.SHIPPED,
    description: 'Updated delivery status',
    enum: DeliveryStatus,
    required: false,
  })
  @IsEnum(DeliveryStatus, {
    message: `Delivery status must be one of: ${Object.values(DeliveryStatus).join(', ')}`,
  })
  @IsOptional()
  deliveryStatus?: DeliveryStatus;

  @ApiProperty({
    example: PaymentStatus.PAID,
    description: 'Updated payment status',
    enum: PaymentStatus,
    required: false,
  })
  @IsEnum(PaymentStatus, {
    message: `Payment status must be one of: ${Object.values(PaymentStatus).join(', ')}`,
  })
  @IsOptional()
  paymentStatus?: PaymentStatus;

  // New fields added for update
  @ApiProperty({
    example: 2,
    description: 'Updated quantity of the product',
    required: false,
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Quantity must be a number' })
  @Min(1, { message: 'Quantity must be at least 1' })
  @IsOptional()
  quantity?: number;

  @ApiProperty({
    example: 'Please ring the doorbell twice',
    description: 'Updated delivery instructions',
    required: false,
  })
  @IsString()
  @IsOptional()
  deliveryInstructions?: string;

  @ApiProperty({
    example: 'With love from your family',
    description: 'Updated gift message',
    required: false,
  })
  @IsString()
  @IsOptional()
  giftMessage?: string;
}

export class UpdateDeliveryStatusDto {
  @ApiProperty({
    example: DeliveryStatus.SHIPPED,
    description: 'New delivery status',
    enum: DeliveryStatus,
  })
  @IsEnum(DeliveryStatus, {
    message: `Delivery status must be one of: ${Object.values(DeliveryStatus).join(', ')}`,
  })
  deliveryStatus: DeliveryStatus;
}

// Create a specific DTO for payment status update
export class UpdatePaymentStatusDto {
  @ApiProperty({
    example: PaymentStatus.PAID,
    description: 'New payment status',
    enum: PaymentStatus,
  })
  @IsEnum(PaymentStatus, {
    message: `Payment status must be one of: ${Object.values(PaymentStatus).join(', ')}`,
  })
  paymentStatus: PaymentStatus;
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: DeliveryStatus, required: false })
  @IsEnum(DeliveryStatus)
  @IsOptional()
  deliveryStatus?: DeliveryStatus;

  @ApiProperty({ enum: PaymentStatus, required: false })
  @IsEnum(PaymentStatus)
  @IsOptional()
  paymentStatus?: PaymentStatus;
}