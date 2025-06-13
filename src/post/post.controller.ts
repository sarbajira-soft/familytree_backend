import {
  Controller,
  Post,
  Get,
  Body,
  Param,
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
import { diskStorage } from 'multer';
import * as fs from 'fs';
import { extname } from 'path';
import { PostService } from './post.service';
import { CreatePostDto } from './dto/post.dto';
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

@ApiTags('Post Module')
@Controller('post')
export class PostController {
  constructor(private readonly postService: PostService) {}

  @UseGuards(JwtAuthGuard)
  @Post('create')
  @UseInterceptors(FileInterceptor('postImage', {
    storage: diskStorage({
      destination: (req, file, cb) => {
        const uploadPath = process.env.POST_IMAGE_UPLOAD_PATH || './uploads/posts';
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
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBearerAuth()
  @ApiSecurity('application-token')
  @ApiOperation({ summary: 'Create a new post' })
  @ApiResponse({ status: 201, description: 'Post created successfully' })
  @HttpCode(HttpStatus.CREATED)
  async createPost(
    @Req() req,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreatePostDto,
  ) {
    const loggedInUser = req.user;

    if (file) {
      body.postImage = file.filename;
    }

    return this.postService.createPost(body, loggedInUser.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all posts' })
  @ApiResponse({ status: 200, description: 'List of posts' })
  getAllPosts() {
    return this.postService.getAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get post by ID' })
  @ApiResponse({ status: 200, description: 'Post found' })
  getPostById(@Param('id') id: number) {
    return this.postService.getById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  @UseInterceptors(FileInterceptor('postImage', {
    storage: diskStorage({
      destination: (req, file, cb) => {
        const uploadPath = process.env.POST_IMAGE_UPLOAD_PATH || './uploads/posts';
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
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update post by ID' })
  async updatePost(
    @Req() req,
    @Param('id') id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreatePostDto,
  ) {
    const loggedInUser = req.user;
    if (file) {
      body.postImage = file.filename;
    }

    return this.postService.update(id, body, loggedInUser.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete post by ID' })
  deletePost(@Param('id') id: number) {
    return this.postService.delete(id);
  }
}
