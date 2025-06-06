import {
  Controller,
  Post,
  Param,
  Get,
  Put,
  Patch,
  Req,
  UploadedFile,
  ForbiddenException,
  Body,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  BadRequestException,
  UseGuards,
  UseInterceptors,
  
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import { UserService } from './user.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ForgetPasswordDto } from './dto/forget-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ApiConsumes, ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { generateFileName, imageFileFilter } from '../utils/upload.utils';


@ApiTags('User Authentication')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully. OTP sent to email.' })
  @ApiResponse({ status: 400, description: 'Bad request. Email already registered.' })
  @ApiBody({ type: RegisterDto })
  async register(@Body() registerDto: RegisterDto) {
    return this.userService.register(registerDto);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP and activate account' })
  @ApiResponse({ status: 200, description: 'Account verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  @ApiBody({ type: VerifyOtpDto })
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.userService.verifyOtp(verifyOtpDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 400, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'Account not verified' })
  @ApiBody({ type: LoginDto })
  async login(@Body() loginDto: LoginDto) {
    return this.userService.login(loginDto);
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend OTP to email' })
  @ApiResponse({ status: 200, description: 'New OTP sent to email' })
  @ApiResponse({ status: 400, description: 'User not found or already verified' })
  @ApiBody({ type: ResendOtpDto })
  async resendOtp(@Body() resendOtpDto: ResendOtpDto) {
    return this.userService.resendOtp(resendOtpDto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send OTP for password reset' })
  @ApiResponse({ status: 200, description: 'OTP sent to email or mobile' })
  @ApiResponse({ status: 400, description: 'User not found' })
  @ApiBody({ type: ForgetPasswordDto })
  async forgetPassword(@Body() forgetPasswordDto: ForgetPasswordDto) {
    return this.userService.forgetPassword(forgetPasswordDto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset user password using OTP/token' })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  @ApiResponse({ status: 400, description: 'Invalid token or OTP' })
  @ApiBody({ type: ResetPasswordDto })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.userService.resetPassword(resetPasswordDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get user profile' })
  @ApiResponse({ status: 200, description: 'User profile data' })
  @ApiBearerAuth()
  @ApiSecurity('application-token')
  async getProfile(@Req() req, @Param('id', ParseIntPipe) id: number) {
    const user = req.user;
    if (user.role === 1 && user.id !== id) {
      throw new ForbiddenException('Members can only access their own profile');
    }
    // Admins and Super Admins can access any profile
    const userdata = await this.userService.getUserProfile(id);
    return {
      message: 'Profile fetched successfully',
      data: userdata,
      currentUser: user,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Put('profile/update/:id')
  @UseInterceptors(
    FileInterceptor('profile', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          cb(null, process.env.UPLOAD_FOLDER_PATH || './uploads/profile');
        },
        filename: (req, file, cb) => {
          const filename = generateFileName(file.originalname);
          cb(null, filename);
        },
      }),
      fileFilter: imageFileFilter,
    }),
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update user profile with optional image' })
  @ApiResponse({ status: 200, description: 'User profile updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiBearerAuth()
  @ApiSecurity('application-token')
  @ApiConsumes('multipart/form-data')
  async updateProfile(
    @Param('id') id: number,
    @UploadedFile() file: Express.Multer.File,
    @Req() req,
    @Body() dto: UpdateProfileDto,
  ) {
    const loggedInUser = req.user;

    // Convert param to number just in case
    const targetUserId = Number(id);

    // Role 1 can only update their own profile
    if (loggedInUser.role === 1 && loggedInUser.id !== targetUserId) {
      throw new BadRequestException('Access denied: Members can only update their own profile');
    }

    // Store only filename in DB
    if (file) {
      dto.profile = file.filename;
    }

    return this.userService.updateProfile(targetUserId, dto);
  }


}