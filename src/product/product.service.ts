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

  // Helper method to construct image URLs properly
  private constructImageUrl(imageName: string): string {
    if (!imageName) return null;
    
    const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, ''); // Remove trailing slash
    const uploadPath = (process.env.PRODUCT_IMAGE_UPLOAD_PATH?.replace(/^\.?\/?/, '') || 'uploads/products').replace(/\/$/, ''); // Remove trailing slash
    
    // Ensure proper URL construction without double slashes
    return `${baseUrl}/${uploadPath}/${imageName}`;
  }

  async createProduct(dto: CreateProductDto) {
    const product = await this.productModel.create(dto);
    return {
      message: 'Product created successfully',
      data: product,
    };
  }

  async getAll() {
    const products = await this.productModel.findAll();
    
    return products.map((product) => {
      const productJson = product.toJSON();
      return {
        ...productJson,
        image: this.constructImageUrl(productJson.image),
      };
    });
  }

  async getById(id: number) {
    const product = await this.productModel.findByPk(id);
    if (!product) throw new NotFoundException('Product not found');
    
    const productJson = product.toJSON();
    return {
      ...productJson,
      image: this.constructImageUrl(productJson.image),
    };
  }

  async update(id: number, dto: UpdateProductDto) {
    const product = await this.productModel.findByPk(id);
    if (!product) throw new NotFoundException('Product not found');

    // Handle image file deletion
    if (dto.image && product.image && dto.image !== product.image) {
      const uploadDir = process.env.PRODUCT_IMAGE_UPLOAD_PATH || './uploads/products';
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
      const uploadDir = process.env.PRODUCT_IMAGE_UPLOAD_PATH || './uploads/products';
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