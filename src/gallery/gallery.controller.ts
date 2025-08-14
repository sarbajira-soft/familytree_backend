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
import { diskStorage, memoryStorage } from 'multer';
import * as fs from 'fs';
import { BadRequestException } from '@nestjs/common';
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

  @Get('health')
  @ApiOperation({ summary: 'Gallery service health check' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  async healthCheck() {
    return {
      status: 'healthy',
      service: 'gallery',
      timestamp: new Date().toISOString(),
      message: 'Gallery service is running'
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('create')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'coverPhoto', maxCount: 1 },
        { name: 'images', maxCount: 10 },
      ],
      {
        storage: memoryStorage(),
        fileFilter: imageFileFilter,
        limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
      },
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBearerAuth()
  @ApiOperation({ 
    summary: 'Create a new gallery with album photos',
    description: 'Creates a gallery with uploaded images. Returns detailed response with progress information.'
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Gallery created successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            galleryTitle: { type: 'string' },
            coverPhoto: { type: 'string' },
            album: { type: 'array', items: { type: 'string' } },
            totalImages: { type: 'number' },
            privacy: { type: 'string' },
            familyCode: { type: 'string' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Bad request - validation failed' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @HttpCode(HttpStatus.CREATED)
  async createGallery(
    @Req() req,
    @UploadedFiles() files: { coverPhoto?: Express.Multer.File[], images?: Express.Multer.File[] },
    @Body() dto: CreateGalleryDto,
  ) {
    const createdBy = req.user.userId;
    const albumImages = files.images || [];
    let coverPhotoFilename: string | undefined;
    
    // If cover photo is uploaded, handle it
    if (files.coverPhoto?.[0]) {
      try {
        // Upload cover photo to S3 and get the filename
        coverPhotoFilename = await this.galleryService.uploadGalleryFile(files.coverPhoto[0], 'cover');
      } catch (error) {
        console.error('Error uploading cover photo:', error);
        throw new BadRequestException('Failed to upload cover photo');
      }
    }

    // Create a new DTO with the cover photo filename if it was uploaded
    const galleryData = {
      ...dto,
      ...(coverPhotoFilename && { coverPhoto: coverPhotoFilename })
    };

    return this.galleryService.createGallery(galleryData, createdBy, albumImages);
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
    FileFieldsInterceptor(
      [
        { name: 'coverPhoto', maxCount: 1 },
        { name: 'images', maxCount: 10 },
      ],
      {
        storage: memoryStorage(),
        fileFilter: imageFileFilter,
        limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
      },
    ),
  )
  @ApiConsumes('multipart/form-data')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a gallery' })
  @ApiResponse({ status: 200, description: 'Gallery updated successfully' })
  async updateGallery(
    @Param('id') id: number,
    @UploadedFiles() files: { coverPhoto?: Express.Multer.File[], images?: Express.Multer.File[] } = {},
    @Body() dto: CreateGalleryDto,
    @Req() req,
  ) {
    // Create a new DTO object to avoid mutating the original
    const updateDto = { ...dto };
    
    // Handle cover photo upload if provided
    if (files?.coverPhoto?.[0]) {
      try {
        const filename = await this.galleryService.uploadGalleryFile(files.coverPhoto[0], 'cover');
        updateDto.coverPhoto = filename;
      } catch (error) {
        console.error('Error uploading cover photo:', error);
        throw new BadRequestException('Failed to upload cover photo');
      }
    }

    return this.galleryService.updateGallery(
      +id, 
      updateDto, 
      req.user.userId, 
      files?.images || []
    );
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
