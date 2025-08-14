import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  Delete,
  Put,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import * as fs from 'fs';
import { extname } from 'path';
import { PostService } from './post.service';

import { CreatePostDto } from './dto/createpost.dto';
import { EditPostDto } from './dto/edit-post.dto';
import { GetPostByOptionsDto } from './dto/post-options.dto';
import { AddPostCommentDto } from './dto/post-comment.dto';

import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiSecurity,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { generateFileName, imageFileFilter } from '../utils/upload.utils';
import { UploadService } from '../uploads/upload.service';

@ApiTags('Post Module')
@Controller('post')
export class PostController {
  constructor(
    private readonly postService: PostService,
    private readonly uploadService: UploadService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('create')
  @UseInterceptors(
    FileInterceptor('postImage', {
      storage: memoryStorage(),
      fileFilter: imageFileFilter,
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    }),
  )
  async createPost(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreatePostDto,
    @Req() req,
  ) {
    const createdBy = req.user.userId;

    if (file) {
      // Upload to S3, store URL in DTO
      dto.postImage = await this.uploadService.uploadFile(file, 'posts');
    }

    return this.postService.createPost(dto, createdBy);
  }


  @UseGuards(JwtAuthGuard)
  @Put('edit/:id')
  @UseInterceptors(
    FileInterceptor('postImage', {
      storage: memoryStorage(),
      fileFilter: imageFileFilter,
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Edit post' })
  @ApiResponse({ status: 200, description: 'Post updated' })
  async editPost(
    @UploadedFile() file: Express.Multer.File,
    @Param('id') id: number,
    @Body() dto: EditPostDto,
    @Req() req,
  ) {
    const userId = req.user?.userId;
    
    // If there's a file, pass it to the service for upload
    // If not, pass null and let the service handle the existing image
    return this.postService.updatePost(
      id, 
      userId, 
      dto, 
      file || null
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('by-options')
  @ApiBearerAuth()
  async getPostByOptions(@Query() query: GetPostByOptionsDto, @Req() req,) {
    return this.postService.getPostByOptions(
      query.privacy,
      query.familyCode,
      query.createdBy,
      query.postId,
      query.caption,
      req.user.userId,
    );
  } 

  @UseGuards(JwtAuthGuard)
  @Post(':postId/like-toggle')
  @ApiBearerAuth()
  async toggleLike(@Param('postId') postId: number, @Req() req) {
    return this.postService.toggleLikePost(postId, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post(':postId/comment')
  async addComment(
    @Param('postId') postId: number,
    @Body() dto: AddPostCommentDto,
    @Req() req,
  ) {
    return this.postService.addComment(postId, req.user.userId, dto.comment);
  }

  @Get(':postId/comments')
  async getComments(
    @Param('postId') postId: number,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.postService.getComments(postId, page, limit);
  }

  @Get(':postId/comments/count')
  async getCommentCount(@Param('postId') postId: number) {
    return this.postService.getCommentCount(postId);
  }
  
  @Get(':postId/like/count')
  async getLikeCount(@Param('postId') postId: number) {
    return this.postService.getLikeCount(postId);
  }

  @Get(':postId')
  async getPost(
    @Param('postId') postId: number,
  ) {
    return this.postService.getPost(postId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('delete/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete post with image, comments, and likes' })
  @ApiResponse({ status: 200, description: 'Post deleted successfully' })
  async deletePost(@Param('id') id: number, @Req() req) {
    const userId = req.user?.userId;
    return this.postService.deletePost(+id, userId);
  }

} 