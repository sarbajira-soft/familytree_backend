import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UploadedFile,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  Delete,
  Put,
  UploadedFiles,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBody,
} from '@nestjs/swagger';
import { generateFileName, imageFileFilter } from '../utils/upload.utils';

@ApiTags('Product Module')
@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post('create')
  @UseInterceptors(
    FilesInterceptor('productImages', 10, {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = process.env.PRODUCT_IMAGE_UPLOAD_PATH || 'uploads/products';
          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          cb(null, generateFileName(file.originalname));
        },
      }),
      fileFilter: imageFileFilter,
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        price: { type: 'number' },
        stock: { type: 'number' },
        status: { type: 'number' },
        categoryId: { type: 'number' },
        productImages: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
      required: ['name', 'description', 'price', 'stock', 'status', 'categoryId'],
    },
  })
  @ApiOperation({ summary: 'Create a new product with images' })
  @ApiResponse({ status: 201, description: 'Product created successfully' })
  @HttpCode(HttpStatus.CREATED)
  async createProduct(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: CreateProductDto,
  ) {
    const result = await this.productService.createProduct(body);
    const productId = result.data.id;
    const imageNames = files?.map(file => file.filename) || [];
    if (imageNames.length > 0) {
      await this.productService.addProductImages(productId, imageNames);
    }
    return result;
  }

  @Post(':id/images')
  @UseInterceptors(
    FileInterceptor('productImages', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = process.env.PRODUCT_IMAGE_UPLOAD_PATH || 'uploads/products';
          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          cb(null, generateFileName(file.originalname));
        },
      }),
      fileFilter: imageFileFilter,
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        productImages: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
  })
  @ApiOperation({ summary: 'Add images to an existing product' })
  async addProductImages(
    @Param('id') id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const imageNames = file ? [file.filename] : [];
    return this.productService.addProductImages(id, imageNames);
  }

  @Delete('images/:imageId')
  @ApiOperation({ summary: 'Delete a specific image from a product' })
  async deleteProductImage(@Param('imageId') imageId: number) {
    return this.productService.deleteProductImage(imageId);
  }

  @Get(':id/images')
  @ApiOperation({ summary: 'Get all images for a product' })
  async getProductImages(@Param('id') id: number) {
    return this.productService.getProductImages(id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all products' })
  @ApiResponse({ status: 200, description: 'List of products' })
  getAllProducts() {
    return this.productService.getAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get product by ID' })
  @ApiResponse({ status: 200, description: 'Product found' })
  getProductById(@Param('id') id: number) {
    return this.productService.getById(id);
  }

  @Put(':id')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath =
            process.env.PRODUCT_IMAGE_UPLOAD_PATH || './uploads/products';
          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          cb(null, generateFileName(file.originalname));
        },
      }),
      fileFilter: imageFileFilter,
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Update product by ID' })
  async updateProduct(
    @Param('id') id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UpdateProductDto,
  ) {
    return this.productService.update(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete product by ID' })
  deleteProduct(@Param('id') id: number) {
    return this.productService.delete(id);
  }
}
