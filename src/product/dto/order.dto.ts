import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsNumber,
  Min,
  IsOptional,
  IsEnum,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryStatus, PaymentStatus } from '../model/order.model';

export class CreateOrderDto {
  @ApiProperty({
    description: 'Unique order number (auto-generated if not provided)',
    required: false,
  })
  @IsString()
  @IsOptional()
  orderNumber?: string; // Made optional since it's auto-generated

  @ApiProperty({
    description: 'ID of the user who placed the order',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'User ID must be a number' })
  userId: number;

  @ApiProperty({
    description: 'ID of the receiver of the order (optional)',
    required: false,
  })
  @Type(() => Number)
  @ValidateIf((o) => o.receiverId !== null && o.receiverId !== undefined)
  @IsNumber({}, { message: 'Receiver ID must be a number' })
  @IsOptional()
  receiverId?: number;

  @ApiProperty({
    description: 'Name of the receiver',
  })
  @IsString()
  @IsNotEmpty({ message: 'Receiver name is required' })
  receiverName: string; // Added receiver name field

  @ApiProperty({
    description: 'Source location of the order',
  })
  @IsString()
  @IsNotEmpty({ message: 'From location is required' })
  from: string;

  @ApiProperty({
    description: 'Destination location of the order',
  })
  @IsString()
  @IsNotEmpty({ message: 'To location is required' })
  to: string;

  @ApiProperty({
    description: 'Duration in days (optional)',
    required: false,
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Duration must be a number' })
  @Min(1, { message: 'Duration must be at least 1 day' })
  @IsOptional() // Made optional as per your request
  duration?: number;

  @ApiProperty({
    description: 'ID of the user who created the order',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'CreatedBy must be a number' })
  createdBy: number;

  @ApiProperty({
    description: 'ID of the product being ordered',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Product ID must be a number' })
  productId: number;

  @ApiProperty({
    description: 'Price of the product at time of order',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Price must be a number' })
  @Min(0, { message: 'Price cannot be negative' })
  price: number;

  @ApiProperty({
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
    description: 'Quantity of the product being ordered',
    default: 1,
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Quantity must be a number' })
  @Min(1, { message: 'Quantity must be at least 1' })
  quantity: number;

  @ApiProperty({
    description: 'Special delivery instructions (optional)',
    required: false,
  })
  @IsString()
  @IsOptional()
  deliveryInstructions?: string;

  @ApiProperty({
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
    description: 'ID of the receiver of the order (optional)',
    required: false,
  })
  @Type(() => Number)
  @ValidateIf((o) => o.receiverId !== null && o.receiverId !== undefined)
  @IsNumber({}, { message: 'Receiver ID must be a number' })
  @IsOptional()
  receiverId?: number;

  @ApiProperty({
    description: 'Name of the receiver',
    required: false,
  })
  @IsString()
  @IsOptional()
  receiverName?: string;

  @ApiProperty({
    description: 'Source location of the order',
    required: false,
  })
  @IsString()
  @IsOptional()
  from?: string;

  @ApiProperty({
    description: 'Destination location of the order',
    required: false,
  })
  @IsString()
  @IsOptional()
  to?: string;

  @ApiProperty({
    description: 'Duration in days',
    required: false,
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Duration must be a number' })
  @Min(1, { message: 'Duration must be at least 1 day' })
  @IsOptional()
  duration?: number;

  @ApiProperty({
    description: 'Updated price of the product',
    required: false,
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Price must be a number' })
  @Min(0, { message: 'Price cannot be negative' })
  @IsOptional()
  price?: number;

  @ApiProperty({
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
    description: 'Updated quantity of the product',
    required: false,
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Quantity must be a number' })
  @Min(1, { message: 'Quantity must be at least 1' })
  @IsOptional()
  quantity?: number;

  @ApiProperty({
    description: 'Updated delivery instructions',
    required: false,
  })
  @IsString()
  @IsOptional()
  deliveryInstructions?: string;

  @ApiProperty({
    description: 'Updated gift message',
    required: false,
  })
  @IsString()
  @IsOptional()
  giftMessage?: string;
}

export class UpdateDeliveryStatusDto {
  @ApiProperty({
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