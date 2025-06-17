import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Product } from './model/product.model';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ProductService {
  constructor(
    @InjectModel(Product)
    private readonly productModel: typeof Product,
  ) {}

  async createProduct(dto: CreateProductDto) {
    const product = await this.productModel.create(dto);
    return {
      message: 'Product created successfully',
      data: product,
    };
  }

  async getAll() {
    return this.productModel.findAll();
  }

  async getById(id: number) {
    const product = await this.productModel.findByPk(id);
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(id: number, dto: UpdateProductDto) {
    const product = await this.productModel.findByPk(id);
    if (!product) throw new NotFoundException('Product not found');

    // Handle image file deletion
    if (dto.image && product.image && dto.image !== product.image) {
      const uploadDir =
        process.env.PRODUCT_IMAGE_UPLOAD_PATH || './uploads/products';
      const oldImagePath = path.join(uploadDir, product.image);
      if (fs.existsSync(oldImagePath)) {
        try {
          fs.unlinkSync(oldImagePath);
          console.log('Old product image deleted:', oldImagePath);
        } catch (err) {
          console.warn('Failed to delete old product image:', err.message);
        }
      }
    }

    await product.update(dto);

    return {
      message: 'Product updated successfully',
      data: product,
    };
  }

  async delete(id: number) {
    const product = await this.productModel.findByPk(id);
    if (!product) throw new NotFoundException('Product not found');

    if (product.image) {
      const uploadDir =
        process.env.PRODUCT_IMAGE_UPLOAD_PATH || './uploads/products';
      const imagePath = path.join(uploadDir, product.image);
      if (fs.existsSync(imagePath)) {
        try {
          fs.unlinkSync(imagePath);
        } catch (err) {
          console.warn('Failed to delete product image:', err.message);
        }
      }
    }

    await product.destroy();
    return { message: 'Product deleted successfully' };
  }
}
