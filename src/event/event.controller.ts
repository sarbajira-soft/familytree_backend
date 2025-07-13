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
import { CreateEventDto, UpdateEventDto, CreateEventImageDto } from './dto/event.dto';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiSecurity,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { generateFileName, imageFileFilter } from '../utils/upload.utils';
import { Op } from 'sequelize';
import { EventImage } from './model/event-image.model';

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
            process.env.EVENT_IMAGE_UPLOAD_PATH || 'uploads/events';
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
    let imageNames: string[] = [];
    if (files && files.length > 0) {
      imageNames = files.map(file => file.filename);
    }

    return this.eventService.createEvent(body, imageNames);
  }

  @UseGuards(JwtAuthGuard)
  @Get('all')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all events for the logged-in user\'s family' })
  getAllEvents(@Req() req) {
    const loggedInUser = req.user;
    return this.eventService.getAll(loggedInUser.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-events')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get events for the logged-in user\'s family' })
  getMyEvents(@Req() req) {
    const loggedInUser = req.user;
    return this.eventService.getEventsForUser(loggedInUser.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('upcoming')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get upcoming events for the logged-in user\'s family' })
  getUpcomingEvents(@Req() req) {
    const loggedInUser = req.user;
    return this.eventService.getUpcoming(loggedInUser.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('upcoming/birthdays')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get upcoming birthdays for the logged-in user\'s family' })
  getUpcomingBirthdays(@Req() req) {
    const loggedInUser = req.user;
    return this.eventService.getUpcomingBirthdays(loggedInUser.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('upcoming/anniversaries')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get upcoming marriage anniversaries for the logged-in user\'s family' })
  getUpcomingAnniversaries(@Req() req) {
    const loggedInUser = req.user;
    return this.eventService.getUpcomingAnniversaries(loggedInUser.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('upcoming/all')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all upcoming events including custom events, birthdays, and anniversaries' })
  getAllUpcomingEvents(@Req() req) {
    const loggedInUser = req.user;
    return this.eventService.getAllUpcomingEvents(loggedInUser.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('upcoming/family/:familyCode')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all upcoming events for a specific family code (admin only)' })
  getUpcomingByFamilyCode(@Param('familyCode') familyCode: string) {
    return this.eventService.getUpcomingByFamilyCode(familyCode);
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
            process.env.EVENT_IMAGE_UPLOAD_PATH || 'uploads/events';
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
    let imageNames: string[] = [];
    if (files && files.length > 0) {
      imageNames = files.map(file => file.filename);
    }

    // Handle images to remove (from request body)
    let imagesToRemove: number[] = [];
    if (body.imagesToRemove) {
      try {
        imagesToRemove = Array.isArray(body.imagesToRemove) 
          ? body.imagesToRemove 
          : JSON.parse(body.imagesToRemove);
      } catch (error) {
        console.error('Error parsing imagesToRemove:', error);
        imagesToRemove = [];
      }
    }

    // Handle existing image URLs from the request body
    // The frontend might send existing image URLs in the eventImages field
    // along with new binary files
    if (body.eventImages && typeof body.eventImages === 'string') {
      try {
        // If it's a JSON string, parse it
        body.eventImages = JSON.parse(body.eventImages);
      } catch (error) {
        // If it's not JSON, treat it as a single string
        body.eventImages = [body.eventImages];
      }
    }

    return this.eventService.update(id, body, imageNames, imagesToRemove, loggedInUser.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete event by ID' })
  deleteEvent(@Req() req, @Param('id') id: number) {
    const loggedInUser = req.user;
    return this.eventService.delete(id, loggedInUser.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/images')
  @UseInterceptors(
    FilesInterceptor('eventImages', 10, {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = process.env.EVENT_IMAGE_UPLOAD_PATH || 'uploads/events';
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
  @ApiOperation({ summary: 'Add images to an existing event' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        eventImages: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
  })
  async addEventImages(
    @Req() req,
    @Param('id') id: number,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const loggedInUser = req.user;
    const imageNames = files?.map(file => file.filename) || [];
    return this.eventService.addEventImages(id, imageNames, loggedInUser.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('images/:imageId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a specific image from an event' })
  async deleteEventImage(@Req() req, @Param('imageId') imageId: number) {
    const loggedInUser = req.user;
    return this.eventService.deleteEventImage(imageId, loggedInUser.userId);
  }

  @Get(':id/images')
  @ApiOperation({ summary: 'Get all images for an event' })
  async getEventImages(@Param('id') id: number) {
    return this.eventService.getEventImages(id);
  }
}
