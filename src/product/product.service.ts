import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Product } from './model/product.model';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import * as fs from 'fs';
import * as path from 'path';
import { ProductImage } from './model/product-image.model';

@Injectable()
export class ProductService {
  constructor(
    @InjectModel(Product)
    private readonly productModel: typeof Product,

    @InjectModel(ProductImage)
    private readonly productImageModel: typeof ProductImage,
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
    const products = await this.productModel.findAll({ include: [ProductImage] });
    return products.map((product) => {
      const productJson = product.toJSON();
      const images = productJson.images?.map(img => this.constructImageUrl(img.imageUrl)) || [];
      return {
        ...productJson,
        images,
      };
    });
  }

  async getById(id: number) {
    const product = await this.productModel.findByPk(id, { include: [ProductImage] });
    if (!product) throw new NotFoundException('Product not found');
    
    const productJson = product.toJSON();
    const images = productJson.images?.map(img => this.constructImageUrl(img.imageUrl)) || [];
    return {
      ...productJson,
      images,
    };
  }

  async update(id: number, dto: UpdateProductDto) {
    const product = await this.productModel.findByPk(id, { include: [ProductImage] });
    if (!product) throw new NotFoundException('Product not found');

    await product.update(dto);

    return {
      message: 'Product updated successfully',
      data: product,
    };
  }

  async delete(id: number) {
    const product = await this.productModel.findByPk(id, { include: [ProductImage] });
    if (!product) throw new NotFoundException('Product not found');

    // Delete product images and files
    const uploadDir = process.env.PRODUCT_IMAGE_UPLOAD_PATH || 'uploads/products';
    for (const img of product.images || []) {
      const imagePath = path.join(uploadDir, img.imageUrl);
      if (fs.existsSync(imagePath)) {
        try {
          fs.unlinkSync(imagePath);
        } catch (err) {
          console.warn('Failed to delete product image:', err.message);
        }
      }
      await img.destroy();
    }

    await product.destroy();
    return { message: 'Product deleted successfully' };
  }

  async addProductImages(productId: number, imageFiles: string[]) {
    const product = await this.productModel.findByPk(productId);
    if (!product) throw new NotFoundException('Product not found');
    const createdImages = await Promise.all(
      imageFiles.map(imageUrl =>
        this.productImageModel.create({ productId, imageUrl })
      )
    );
    return {
      message: 'Images added successfully',
      images: createdImages.map(img => ({ id: img.id, imageUrl: this.constructImageUrl(img.imageUrl) })),
    };
  }

  async deleteProductImage(imageId: number) {
    const image = await this.productImageModel.findByPk(imageId);
    if (!image) throw new NotFoundException('Image not found');
    const uploadDir = process.env.PRODUCT_IMAGE_UPLOAD_PATH || 'uploads/products';
    const imagePath = path.join(uploadDir, image.imageUrl);
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
    await image.destroy();
    return { message: 'Image deleted successfully' };
  }

  async getProductImages(productId: number) {
    const images = await this.productImageModel.findAll({ where: { productId } });
    return images.map(img => ({ id: img.id, imageUrl: this.constructImageUrl(img.imageUrl) }));
  }
}