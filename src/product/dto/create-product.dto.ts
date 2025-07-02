import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  Min,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @ApiProperty({
    example: 'Apple iPhone 15',
    description: 'Name of the product',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: 'Latest model with A16 Bionic chip',
    description: 'Description of the product',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: 7999,
    description: 'Price of the product in INR',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Price must be a number' })
  @Min(0, { message: 'Price must not be less than 0' })
  price: number;

  @ApiProperty({
    example: 50,
    description: 'Available stock quantity',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Stock must be a number' })
  @Min(0, { message: 'Stock must not be less than 0' })
  stock: number;

  @ApiProperty({
    example: 1,
    description: 'Status of the product (1 = active, 0 = inactive)',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Status must be a number' })
  @IsIn([0, 1], { message: 'Status must be either 0 or 1' })
  status: number;

  @ApiProperty({
    example: 1,
    description: 'Category ID the product belongs to',
  })
  @Type(() => Number)
  @IsNumber({}, { message: 'Category ID must be a number' })
  categoryId: number;
}

export class CreateProductImageDto {
  @ApiProperty({ example: 1, description: 'Product ID' })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber({}, { message: 'Product ID must be a number' })
  productId: number;

  @ApiProperty({ example: 'product-image.jpg', description: 'Image URL or filename' })
  @IsNotEmpty()
  @IsString()
  imageUrl: string;
}
