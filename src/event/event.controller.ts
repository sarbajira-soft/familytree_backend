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
import { EventService } from '../event/event.service';
import { CreateEventDto, UpdateEventDto } from './dto/event.dto';
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
import { Op } from 'sequelize';

@ApiTags('Event Module')
@Controller('event')
export class EventController {
  constructor(private readonly eventService: EventService) {}

  @UseGuards(JwtAuthGuard)
  @Post('create')
  @UseInterceptors(
    FilesInterceptor('eventImages', 10, {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath =
            process.env.EVENT_IMAGE_UPLOAD_PATH || '/uploads/events';
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
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBearerAuth()
  @ApiSecurity('application-token')
  @ApiOperation({ summary: 'Create a new event' })
  @ApiResponse({ status: 201, description: 'Event created successfully' })
  @HttpCode(HttpStatus.CREATED)
  async createEvent(
    @Req() req,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: CreateEventDto,
  ) {
    const loggedInUser = req.user;

    // Set userId from logged-in user if not provided
    if (!body.userId) {
      body.userId = loggedInUser.userId;
    }

    // Set createdBy to userId if not provided
    if (!body.createdBy) {
      body.createdBy = loggedInUser.userId;
    }

    // Handle multiple image uploads
    if (files && files.length > 0) {
      const imageNames = files.map(file => file.filename);
      // LOG the full URL for each uploaded image
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const uploadPath = process.env.EVENT_IMAGE_UPLOAD_PATH?.replace(/^\.?\/?/, '') || 'uploads/events';
      const fullUrls = imageNames.map(name => `${baseUrl.replace(/\/$/, '')}/${uploadPath.replace(/\/$/, '')}/${name}`);
      console.log('Uploaded image URLs:', fullUrls);
      body.eventImages = JSON.stringify(imageNames);
    }

    return this.eventService.createEvent(body);
  }

  @Get('all')
  @ApiOperation({ summary: 'Get all events' })
  getAllEvents() {
    return this.eventService.getAll();
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'Get upcoming events' })
  getUpcomingEvents() {
    return this.eventService.getUpcoming();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get event by ID' })
  @ApiResponse({ status: 200, description: 'Event found' })
  getEventById(@Param('id') id: number) {
    return this.eventService.getById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  @UseInterceptors(
    FilesInterceptor('eventImages', 10, {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath =
            process.env.EVENT_IMAGE_UPLOAD_PATH || '/uploads/events';
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update event by ID' })
  async updateEvent(
    @Req() req,
    @Param('id') id: number,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: UpdateEventDto,
  ) {
    const loggedInUser = req.user;

    // Handle multiple image uploads
    if (files && files.length > 0) {
      const imageNames = files.map(file => file.filename);
      body.eventImages = JSON.stringify(imageNames);
    }

    return this.eventService.update(id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete event by ID' })
  deleteEvent(@Param('id') id: number) {
    return this.eventService.delete(id);
  }
}
