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
  Delete
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
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
import { MergeUserDto } from './dto/merge-user.dto';
import { UploadService } from '../uploads/upload.service';

 
@ApiTags('User Module')
@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly uploadService: UploadService
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully. OTP sent to email.' })
  @ApiResponse({ status: 400, description: 'Bad request... Email or mobile number already registered.' })
  @ApiBody({ type: RegisterDto })
  async register(@Body() registerDto: RegisterDto) {
    try {
      const result = await this.userService.register(registerDto);
      return result;
    } catch (error) {
      console.error('Registration error:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException({
        statusCode: 400,
        message: 'Registration failed. Please check your input data.',
        error: error.message || 'Bad Request',
        details: error.response?.message || undefined
      });
    }
  }

  @Post('verify-otp')
  @ApiOperation({ summary: 'Verify OTP and activate account' })
  @ApiResponse({ status: 200, description: 'Account verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  @ApiBody({ type: VerifyOtpDto })
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.userService.verifyOtp(verifyOtpDto);
  }

  @Post('login')
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

  @Post('merge')
  @ApiOperation({ summary: 'Merge current user data into existing user and delete current user' })
  @ApiBody({ type: MergeUserDto })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async mergeUserData(@Req() req, @Body() body: MergeUserDto) {
    const { existingId, currentId, notificationId } = body;
    const loggedInUser = req.user;
    if (!loggedInUser || (loggedInUser.role !== 2 && loggedInUser.role !== 3)) {
      throw new ForbiddenException('Only admin users can perform this action');
    }
    return this.userService.mergeUserData(existingId, currentId, notificationId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('myProfile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get user profile' })
  @ApiResponse({ status: 200, description: 'User profile data' })
  @ApiBearerAuth()
  @ApiSecurity('application-token')
  async getMyProfile(@Req() req) {
    const loggedInUser = req.user;
    console.log(loggedInUser);
    
    const userdata = await this.userService.getUserProfile(Number(loggedInUser.userId));
    return {
      message: 'Profile fetched successfully',
      data: userdata,
      currentUser: loggedInUser,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get user profile' })
  @ApiResponse({ status: 200, description: 'User profile data' })
  @ApiBearerAuth()
  @ApiSecurity('application-token')
  async getProfile(@Req() req, @Param('id', ParseIntPipe) id: number) {
    const loggedInUser = req.user;
    const targetUserId = Number(id);
  
    // Always allow admin
    if (loggedInUser.role === 2 || loggedInUser.role === 3 ) {
      const userdata = await this.userService.getUserProfile(id);
      return {
        message: 'Profile fetched successfully',
        data: userdata,
        currentUser: loggedInUser,
      };
    }
  
    // If member, allow if self or same family
    if (loggedInUser.role === 1) {
      if (loggedInUser.userId === targetUserId) {
        // Self
        const userdata = await this.userService.getUserProfile(id);
        return {
          message: 'Profile fetched successfully',
          data: userdata,
          currentUser: loggedInUser,
        };
      } else {
        // Check if both are in the same family
        const targetUser = await this.userService.getUserProfile(id);
        const myProfile = await this.userService.getUserProfile(loggedInUser.userId);
  
        const myFamilyCode = myProfile?.userProfile?.familyCode;
        const targetFamilyCode = targetUser?.userProfile?.familyCode;
  
        if (myFamilyCode && targetFamilyCode && myFamilyCode === targetFamilyCode) {
          return {
            message: 'Profile fetched successfully',
            data: targetUser,
            currentUser: loggedInUser,
          };
        } else {
          throw new BadRequestException({message:'Access denied: You can only view profiles in your family'});
        }
      }
    }
  
    // Default: deny
    throw new BadRequestException({message:'Access denied'});
  }

  @UseGuards(JwtAuthGuard)
  @Put('profile/update/:id')
  @UseInterceptors(
    FileInterceptor('profile', {
      storage: memoryStorage(),
      fileFilter: imageFileFilter,
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    }),
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update user profile with optional image' })
  @ApiResponse({ status: 200, description: 'User profile updated successfully' })
  @ApiBearerAuth()
  @ApiSecurity('application-token')
  @ApiConsumes('multipart/form-data')
  async updateProfile(
    @Param('id') id: number,
    @UploadedFile() file: Express.Multer.File,
    @Req() req,
    @Body() body: UpdateProfileDto,
  ) {
    const loggedInUser = req.user;

    // Convert param to number just in case
    const targetUserId = Number(id);

    // Role 1 can only update their own profile
    if (loggedInUser.role === 1 && loggedInUser.userId !== targetUserId) {
      throw new BadRequestException({message:'Access denied: Members can only update their own profile'});
    }
    
    // Clean up empty strings in the body
    Object.keys(body).forEach((key) => {
      if (body[key] === '') {
        body[key] = undefined;
      }
    });

    // Handle file upload to S3 if file exists
    if (file) {
      // Upload to S3 and get the URL
      body.profile = await this.uploadService.uploadFile(file, 'profile');
    }
    
    return this.userService.updateProfile(targetUserId, body);
  }

  @Put('profile/update/public/:id')
  @UseInterceptors(
    FileInterceptor('profile', {
      storage: memoryStorage(),
      fileFilter: imageFileFilter,
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    }),
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update user profile with optional image (public endpoint)' })
  @ApiResponse({ status: 200, description: 'User profile updated successfully' })
  @ApiConsumes('multipart/form-data')
  async updateProfilePublic(
    @Param('id') id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UpdateProfileDto,
  ) {
    // Convert param to number just in case
    const targetUserId = Number(id);
    
    // Clean up empty strings in the body
    Object.keys(body).forEach((key) => {
      if (body[key] === '') {
        body[key] = undefined;
      }
    });

    // Handle file upload to S3 if file exists
    if (file) {
      // Upload to S3 and get the URL
      body.profile = await this.uploadService.uploadFile(file, 'profile');
    }
    
    return this.userService.updateProfile(targetUserId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a user if creator' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiBearerAuth()
  @ApiSecurity('application-token')
  async deleteUser(@Param('id', ParseIntPipe) id: number, @Req() req) {
    const loggedInUser = req.user;
    return this.userService.deleteUser(id, loggedInUser.userId);
  }
}