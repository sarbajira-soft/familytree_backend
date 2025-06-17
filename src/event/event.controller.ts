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
import { EventService } from '../event/event.service';
import { CreateEventDto } from './dto/event.dto';
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

@ApiTags('Event Module')
@Controller('event')
export class EventController {
  constructor(private readonly eventService: EventService) {}

  @UseGuards(JwtAuthGuard)
  @Post('create')
  @UseInterceptors(
    FileInterceptor('eventImage', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath =
            process.env.EVENT_IMAGE_UPLOAD_PATH || './uploads/events';
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
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateEventDto,
  ) {
    const loggedInUser = req.user;

    if (file) {
      body.eventImage = file.filename;
    }

    return this.eventService.createEvent(body, loggedInUser.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all events' })
  @ApiResponse({ status: 200, description: 'List of events' })
  getAllEvents() {
    return this.eventService.getAll();
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
    FileInterceptor('eventImage', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath =
            process.env.EVENT_IMAGE_UPLOAD_PATH || './uploads/events';
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
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateEventDto,
  ) {
    const loggedInUser = req.user;
    if (file) {
      body.eventImage = file.filename;
    }

    return this.eventService.update(id, body, loggedInUser.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete event by ID' })
  deleteEvent(@Param('id') id: number) {
    return this.eventService.delete(id);
  }
}
