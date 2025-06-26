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
  ParseIntPipe,
  Query,
  Put,
} from '@nestjs/common';
import { FilesInterceptor, FileFieldsInterceptor, AnyFilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import { GalleryService } from './gallery.service';

import { CreateGalleryDto } from './dto/gallery.dto';
import { GetGalleryByOptionsDto } from './dto/gallery-options.dto';
import { ToggleLikeDto } from './dto/gallery-like.dto';
import { CreateGalleryCommentDto } from './dto/gallery-comment.dto';

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
    FileFieldsInterceptor(
      [
        { name: 'coverPhoto', maxCount: 1 },
        { name: 'images', maxCount: 10 },
      ],
      {
        storage: diskStorage({
          destination: (req, file, cb) => {
            const uploadPath = process.env.GALLERY_PHOTO_UPLOAD_PATH || './uploads/gallery';
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
        limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
      },
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new gallery with album photos' })
  @ApiResponse({ status: 201, description: 'Gallery created successfully' })
  @HttpCode(HttpStatus.CREATED)
  async createGallery(
    @Req() req,
    @UploadedFiles()
    files: {
      coverPhoto?: Express.Multer.File[];
      images?: Express.Multer.File[];
    },
    @Body() body: CreateGalleryDto,
  ) {
    const loggedInUser = req.user;

    const coverPhoto = files.coverPhoto?.[0];
    const albumImages = files.images || [];

    if (coverPhoto) {
      body.coverPhoto = coverPhoto.filename as any;
    }

    return this.galleryService.createGallery(body, loggedInUser.userId, albumImages);
  }

  @UseGuards(JwtAuthGuard)
  @Get('by-options')
  @ApiBearerAuth()
  async getGalleryByOptions(@Query() query: GetGalleryByOptionsDto, @Req() req) {
    return this.galleryService.getGalleryByOptions(
      query.privacy as 'public' | 'private',
      query.familyCode,
      query.createdBy,
      query.galleryId,
      query.galleryTitle,
      req.user.userId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = process.env.GALLERY_PHOTO_UPLOAD_PATH || './uploads/gallery';
          if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => cb(null, generateFileName(file.originalname)),
      }),
      fileFilter: imageFileFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Edit a gallery' })
  @ApiResponse({ status: 200, description: 'Gallery updated successfully' })
  async updateGallery(
    @Param('id') id: number,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: CreateGalleryDto,
    @Req() req,
  ) {
    const coverPhoto = files?.find((f) => f.fieldname === 'coverPhoto');
    const albumImages = files?.filter((f) => f.fieldname === 'images');
    return this.galleryService.updateGallery(+id, body, req.user.userId, coverPhoto, albumImages);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a gallery and its images' })
  @ApiResponse({ status: 200, description: 'Gallery deleted successfully' })
  async deleteGallery(@Param('id') id: number) {
    return this.galleryService.deleteGallery(+id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('like')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Like or Unlike a gallery' })
  async toggleLike(@Body() body: ToggleLikeDto, @Req() req) {
    return this.galleryService.toggleLikeGallery(body.galleryId, req.user.userId);
  }

  @Get(':id/likes')
  @ApiOperation({ summary: 'Get like count for a gallery' })
  async getLikeCount(@Param('id') galleryId: number) {
    return this.galleryService.getGalleryLikeCount(galleryId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('comment')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a comment to a gallery' })
  async addComment(
    @Body() body: CreateGalleryCommentDto,
    @Req() req,
  ) {
    return this.galleryService.addGalleryComment(body, req.user.userId);
  }

  @Get(':id/comments')
  @ApiOperation({ summary: 'Get all comments for a gallery' })
  async getComments(@Param('id') galleryId: number) {
    return this.galleryService.getGalleryComments(galleryId);
  }

  @Get(':id/comment-count')
  @ApiOperation({ summary: 'Get total comment count for a gallery' })
  async getGalleryCommentCount(@Param('id') galleryId: number) {
    return this.galleryService.getGalleryCommentCount(galleryId);
  }

  @Get(':galleryId')
  async getPublicGalleryById(
    @Param('galleryId', ParseIntPipe) galleryId: number,
    @Query('userId') userId?: number,
  ) {
    return this.galleryService.getGalleryById(galleryId, userId ? +userId : undefined);
  }

}
