import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  Delete,
  Put,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import { GalleryService } from './gallery.service';
import { CreateGalleryDto } from './dto/gallery.dto';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { generateFileName, imageFileFilter } from '../utils/upload.utils';

@ApiTags('Gallery Module')
@Controller('gallery')
export class GalleryController {
  constructor(private readonly galleryService: GalleryService) {}

  @UseGuards(JwtAuthGuard)
  @Post('create')
  @UseInterceptors(
    FilesInterceptor('images', 10, {
      // Allow up to 10 images
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath =
            process.env.GALLERY_PHOTO_UPLOAD_PATH || './uploads/gallery';
          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const filename = generateFileName(file.originalname);
          cb(null, filename);
        },
      }),
      fileFilter: imageFileFilter,
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB per file
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new gallery' })
  @ApiResponse({ status: 201, description: 'Gallery created successfully' })
  @HttpCode(HttpStatus.CREATED)
  async createGallery(
    @Req() req,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: CreateGalleryDto,
  ) {
    const loggedInUser = req.user;

    if (files && files.length > 0) {
      body.images = files.map((file) => file.filename);
    }

    return this.galleryService.createGallery(body, loggedInUser.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all galleries' })
  @ApiResponse({ status: 200, description: 'List of galleries' })
  getAllGalleries() {
    return this.galleryService.getAll();
  }

  @Get('family/:familyCode')
  @ApiOperation({ summary: 'Get galleries by family code' })
  @ApiResponse({ status: 200, description: 'List of galleries for family' })
  getGalleriesByFamily(@Param('familyCode') familyCode: string) {
    return this.galleryService.getByFamilyCode(familyCode);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get gallery by ID' })
  @ApiResponse({ status: 200, description: 'Gallery found' })
  getGalleryById(@Param('id') id: number) {
    return this.galleryService.getById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  @UseInterceptors(
    FilesInterceptor('images', 10, {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath =
            process.env.GALLERY_PHOTO_UPLOAD_PATH || './uploads/gallery';
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
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB per file
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update gallery by ID' })
  async updateGallery(
    @Req() req,
    @Param('id') id: number,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: CreateGalleryDto,
  ) {
    const loggedInUser = req.user;

    if (files && files.length > 0) {
      body.images = files.map((file) => file.filename);
    }

    return this.galleryService.update(id, body, loggedInUser.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete gallery by ID' })
  deleteGallery(@Param('id') id: number, @Req() req) {
    const loggedInUser = req.user;
    return this.galleryService.delete(id, loggedInUser.userId);
  }
}
