import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Product } from './model/product.model';
import { Category } from './model/category.model';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import * as fs from 'fs';
import * as path from 'path';
import { ProductImage } from './model/product-image.model';
import { UploadService } from '../uploads/upload.service';

@Injectable()
export class ProductService {
  constructor(
    @InjectModel(Product)
    private readonly productModel: typeof Product,

    @InjectModel(ProductImage)
    private readonly productImageModel: typeof ProductImage,
  ) {}

  // Helper method to construct S3 image URLs
  private constructProductImageUrl(filename: string): string {
    if (!filename) return null;
    
    // If it's already a full URL, return as is
    if (filename.startsWith('http://') || filename.startsWith('https://')) {
      return filename;
    }

    // If S3 is configured, construct S3 URL
    if (process.env.S3_BUCKET_NAME && process.env.REGION) {
      return `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.REGION}.amazonaws.com/products/${filename}`;
    }

    // Fallback to local URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const uploadPath = process.env.PRODUCT_IMAGE_UPLOAD_PATH?.replace(/^\.?\/?/, '') || 'uploads/products';
    return `${baseUrl.replace(/\/$/, '')}/${uploadPath.replace(/\/$/, '')}/${filename}`;
  }

  private getProductImageFilenameFromUrl(url: string): string | null {
    if (!url) return null;
    
    try {
      const parsedUrl = new URL(url);
      // Extract the filename from the path
      return parsedUrl.pathname.split('/').pop() || null;
    } catch (e) {
      // If it's not a valid URL, return as is (might already be a filename)
      return url;
    }
  }

  async createProduct(dto: CreateProductDto, imageFiles?: Express.Multer.File[]) {
    const product = await this.productModel.create(dto);
    const uploadService = new UploadService();

    // Save images if provided
    if (imageFiles && imageFiles.length > 0) {
      try {
        // Upload files to S3 and get URLs
        const uploadPromises = imageFiles.map(file => 
          uploadService.uploadFile(file, 'products')
        );
        
        const imageUrls = await Promise.all(uploadPromises);
        
        // Save image references to database
        await Promise.all(
          imageUrls.map(imageUrl => 
            this.productImageModel.create({ 
              productId: product.id, 
              imageUrl: this.getProductImageFilenameFromUrl(imageUrl) || imageUrl 
            })
          )
        );
      } catch (error) {
        console.error('Error uploading product images:', error);
        // Clean up product if image upload fails
        await product.destroy();
        throw new Error('Failed to upload product images');
      }
    }

    const productWithCategory = await this.productModel.findByPk(product.id, {
      include: [
        { 
          model: Category, 
          as: 'category',
          attributes: ['id', 'name']
        }
      ]
    });
    return {
      message: 'Product created successfully',
      data: productWithCategory,
    };
  }

  async getAll() {
    const products = await this.productModel.findAll({ 
      include: [
        ProductImage,
        { 
          model: Category, 
          as: 'category',
          attributes: ['id', 'name']
        }
      ] 
    });
    return products.map((product) => {
      const productJson = product.toJSON();
      const images = productJson.images?.map(img => this.constructProductImageUrl(img.imageUrl)) || [];
      return {
        ...productJson,
        images,
      };
    });
  }

  async getById(id: number) {
    const product = await this.productModel.findByPk(id, { 
      include: [
        ProductImage,
        { 
          model: Category, 
          as: 'category',
          attributes: ['id', 'name']
        }
      ] 
    });
    if (!product) throw new NotFoundException('Product not found');
    
    const productJson = product.toJSON();
    const images = productJson.images?.map(img => this.constructProductImageUrl(img.imageUrl)) || [];
    return {
      ...productJson,
      images,
    };
  }

  async update(id: number, dto: UpdateProductDto) {
    const product = await this.productModel.findByPk(id, { 
      include: [
        ProductImage,
        { 
          model: Category, 
          as: 'category',
          attributes: ['id', 'name']
        }
      ] 
    });
    if (!product) throw new NotFoundException('Product not found');

    await product.update(dto);

    return {
      message: 'Product updated successfully',
      data: product,
    };
  }

  async delete(id: number) {
    const product = await this.productModel.findByPk(id, { 
      include: [
        ProductImage,
        { 
          model: Category, 
          as: 'category',
          attributes: ['id', 'name']
        }
      ] 
    });
    if (!product) throw new NotFoundException('Product not found');

    // Delete product images from S3 or local storage
    const uploadService = new UploadService();
    const uploadDir = process.env.PRODUCT_IMAGE_UPLOAD_PATH || 'uploads/products';
    
    for (const img of product.images || []) {
      try {
        const imageUrl = this.constructProductImageUrl(img.imageUrl);
        if (imageUrl.includes('amazonaws.com')) {
          // Delete from S3
          await uploadService.deleteFile(imageUrl);
        } else {
          // Local file deletion
          const imagePath = path.join(uploadDir, img.imageUrl);
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
          }
        }
        await img.destroy();
      } catch (error) {
        console.error('Error deleting product image:', error);
        // Continue with other deletions even if one fails
      }
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
      images: createdImages.map(img => ({ id: img.id, imageUrl: this.constructProductImageUrl(img.imageUrl) })),
    };
  }

  async deleteProductImage(imageId: number) {
    const image = await this.productImageModel.findByPk(imageId);
    if (!image) throw new NotFoundException('Image not found');
    
    const uploadService = new UploadService();
    try {
      const imageUrl = this.constructProductImageUrl(image.imageUrl);
      if (imageUrl.includes('amazonaws.com')) {
        // Delete from S3
        await uploadService.deleteFile(imageUrl);
      } else {
        // Local file deletion
        const uploadDir = process.env.PRODUCT_IMAGE_UPLOAD_PATH || 'uploads/products';
        const imagePath = path.join(uploadDir, image.imageUrl);
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      }
    } catch (error) {
      console.error('Error deleting product image:', error);
    }
    
    await image.destroy();
    return { message: 'Image deleted successfully' };
  }

  async getProductImages(productId: number) {
    const images = await this.productImageModel.findAll({ where: { productId } });
    return images.map(img => ({ id: img.id, imageUrl: this.constructProductImageUrl(img.imageUrl) }));
  }
}