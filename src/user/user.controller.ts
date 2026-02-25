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
  Logger,
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
import { TogglePrivacyDto } from './dto/toggle-privacy.dto';
import { ApiConsumes, ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { generateFileName, imageFileFilter } from '../utils/upload.utils';
import { MergeUserDto } from './dto/merge-user.dto';
import { UploadService } from '../uploads/upload.service';
import { BlockingService } from '../blocking/blocking.service';
import { NotificationService } from '../notification/notification.service';
import { InjectModel } from '@nestjs/sequelize';
import { FamilyLink } from '../family/model/family-link.model';
import { FamilyMember } from '../family/model/family-member.model';
import { UserProfile } from './model/user-profile.model';

 
@ApiTags('User Module')
@Controller('user')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    private readonly userService: UserService,
    private readonly uploadService: UploadService,
    private readonly blockingService: BlockingService,
    private readonly notificationService: NotificationService,
    @InjectModel(FamilyLink)
    private readonly familyLinkModel: typeof FamilyLink,
    @InjectModel(FamilyMember)
    private readonly familyMemberModel: typeof FamilyMember,
    @InjectModel(UserProfile)
    private readonly userProfileModel: typeof UserProfile,
  ) {}

  /**
   * BLOCK OVERRIDE: Normalize Sequelize model instances to plain objects
   * before spreading into API payloads to avoid circular JSON structures.
   */
  private toPlainObject<T>(value: T): any {
    if (!value) {
      return value;
    }

    const modelValue = value as any;
    if (typeof modelValue.toJSON === 'function') {
      return modelValue.toJSON();
    }
    if (typeof modelValue.get === 'function') {
      return modelValue.get({ plain: true });
    }

    return value;
  }

  /**
   * Check if two families are linked via FamilyLink table
   */
  private async areFamiliesLinked(familyCode1: string, familyCode2: string): Promise<boolean> {
    if (!familyCode1 || !familyCode2 || familyCode1 === familyCode2) {
      return familyCode1 === familyCode2;
    }

    const [low, high] = familyCode1 < familyCode2 
      ? [familyCode1, familyCode2] 
      : [familyCode2, familyCode1];

    const link = await this.familyLinkModel.findOne({
      where: {
        familyCodeLow: low,
        familyCodeHigh: high,
        status: 'active',
      },
    });

    return !!link;
  }

  /**
   * Check if two families are associated via UserProfile associatedFamilyCodes
   */
  private async areFamiliesAssociated(familyCode1: string, familyCode2: string): Promise<boolean> {
    if (!familyCode1 || !familyCode2 || familyCode1 === familyCode2) {
      return familyCode1 === familyCode2;
    }

    this.logger.log(`areFamiliesAssociated: Checking if ${familyCode1} has ${familyCode2} in associatedFamilyCodes`);

    // Use text search for json arrays - case insensitive
    const [results1] = await this.userProfileModel.sequelize.query(
      `SELECT 1 FROM ft_user_profile 
       WHERE LOWER("familyCode") = LOWER(:familyCode1)
       AND "associatedFamilyCodes"::text ILIKE '%' || :familyCode2 || '%'
       LIMIT 1`,
      {
        replacements: { familyCode1, familyCode2 },
        type: 'SELECT',
      }
    );

    this.logger.log(`areFamiliesAssociated: Query1 results: ${JSON.stringify(results1)}`);

    if (results1 && results1.length > 0) {
      this.logger.log(`areFamiliesAssociated: Found association! ${familyCode1} has ${familyCode2}`);
      return true;
    }

    // Check reverse direction
    this.logger.log(`areFamiliesAssociated: Checking reverse - if ${familyCode2} has ${familyCode1}`);
    
    const [results2] = await this.userProfileModel.sequelize.query(
      `SELECT 1 FROM ft_user_profile 
       WHERE LOWER("familyCode") = LOWER(:familyCode2)
       AND "associatedFamilyCodes"::text ILIKE '%' || :familyCode1 || '%'
       LIMIT 1`,
      {
        replacements: { familyCode1, familyCode2 },
        type: 'SELECT',
      }
    );

    this.logger.log(`areFamiliesAssociated: Query2 results: ${JSON.stringify(results2)}`);

    const found = results2 && results2.length > 0;
    this.logger.log(`areFamiliesAssociated: Result = ${found}`);
    return found;
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully. OTP sent to email.',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request... Email or mobile number already registered.',
  })
  @ApiBody({ type: RegisterDto })
  async register(@Body() registerDto: RegisterDto) {
    try {
      const result = await this.userService.register(registerDto);
      return result;
    } catch (error) {
      this.logger.error('Registration error', error?.stack || String(error));
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException({
        statusCode: 400,
        message: 'Registration failed. Please check your input data.',
        error: error.message || 'Bad Request',
        details: error.response?.message || undefined,
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
  @ApiResponse({
    status: 400,
    description: 'User not found or already verified',
  })
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
  @ApiOperation({
    summary:
      'Merge current user data into existing user and delete current user',
  })
  @ApiBody({ type: MergeUserDto })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async mergeUserData(@Req() req, @Body() body: MergeUserDto) {
    const { existingId, currentId, notificationId } = body;
    const loggedInUser = req.user;
    if (!loggedInUser || (loggedInUser.role !== 2 && loggedInUser.role !== 3)) {
      throw new ForbiddenException('Only admin users can perform this action');
    }
    return this.userService.mergeUserData(
      existingId,
      currentId,
      notificationId,
    );
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

    const userdata = await this.userService.getUserProfile(
      Number(loggedInUser.userId),
    );
    return {
      message: 'Profile fetched successfully',
      data: userdata,
      currentUser: loggedInUser,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('privacy')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle private account setting (self only)' })
  @ApiResponse({ status: 200, description: 'Privacy updated' })
  @ApiBearerAuth()
  @ApiSecurity('application-token')
  async setPrivacy(@Req() req, @Body() dto: TogglePrivacyDto) {
    const loggedInUser = req.user;
    return this.userService.setPrivacy(Number(loggedInUser.userId), dto.isPrivate);
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
    const loggedInUserId = Number(loggedInUser.userId || loggedInUser.id);
    const targetUserId = Number(id);

    // Always allow self for any role
    if (loggedInUserId === targetUserId) {
      const userdata = await this.userService.getUserProfile(id);
      const plainUserData = this.toPlainObject(userdata);
      return {
        message: 'Profile fetched successfully',
        // BLOCK OVERRIDE: Injected new blockStatus contract.
        data: {
          ...plainUserData,
          blockStatus: {
            isBlockedByMe: false,
            isBlockedByThem: false,
          },
        },
        currentUser: loggedInUser,
      };
    }

    const blockStatus = await this.blockingService.getBlockStatus(
      loggedInUserId,
      targetUserId,
    );

    // BLOCK OVERRIDE: If target blocked viewer, return restricted payload for blocked-profile UI.
    if (blockStatus.isBlockedByThem) {
      return {
        message: 'Profile fetched successfully',
        data: {
          blockStatus,
        },
        currentUser: loggedInUser,
      };
    }

    const targetUser = await this.userService.getUserProfile(id);
    const plainTargetUser = this.toPlainObject(targetUser);

    // BLOCK OVERRIDE: If viewer blocked target, return limited profile payload.
    if (blockStatus.isBlockedByMe) {
      return {
        message: 'Profile fetched successfully',
        data: {
          id: plainTargetUser?.id,
          userProfile: {
            firstName: plainTargetUser?.userProfile?.firstName || '',
            lastName: plainTargetUser?.userProfile?.lastName || '',
            profile: plainTargetUser?.userProfile?.profile || null,
          },
          blockStatus,
        },
        currentUser: loggedInUser,
      };
    }

    const targetIsPrivate = plainTargetUser?.userProfile?.isPrivate;
    const myProfile = await this.userService.getUserProfile(loggedInUserId);
    const plainMyProfile = this.toPlainObject(myProfile);

    const myFamilyCode = plainMyProfile?.userProfile?.familyCode;
    const targetFamilyCode = plainTargetUser?.userProfile?.familyCode;

    this.logger.log(`Profile access check: isPrivate=${targetIsPrivate}, myFamilyCode=${myFamilyCode}, targetFamilyCode=${targetFamilyCode}`);

    // If profile is NOT private (public), allow any authenticated user to view
    if (!targetIsPrivate) {
      this.logger.log(`Profile is public - allowing access`);
      return {
        message: 'Profile fetched successfully',
        // BLOCK OVERRIDE: Injected new blockStatus contract.
        data: { ...plainTargetUser, blockStatus },
        currentUser: loggedInUser,
      };
    }

    // If profile IS private, check if viewer is in same family or linked/associated
    if (targetIsPrivate) {
      this.logger.log(`Profile is private - checking family/association access`);

      // Same family check
      if (myFamilyCode && targetFamilyCode && myFamilyCode === targetFamilyCode) {
        this.logger.log(`Same family - allowing access`);
        return {
          message: 'Profile fetched successfully',
          data: { ...plainTargetUser, blockStatus },
          currentUser: loggedInUser,
        };
      }

      // Check linked families
      if (myFamilyCode && targetFamilyCode) {
        const familiesAreLinked = await this.areFamiliesLinked(myFamilyCode, targetFamilyCode);
        if (familiesAreLinked) {
          this.logger.log(`Linked families - allowing access`);
          return {
            message: 'Profile fetched successfully',
            data: { ...plainTargetUser, blockStatus },
            currentUser: loggedInUser,
          };
        }
      }

      // Check associated families
      if (myFamilyCode && targetFamilyCode) {
        const familiesAreAssociated = await this.areFamiliesAssociated(myFamilyCode, targetFamilyCode);
        if (familiesAreAssociated) {
          this.logger.log(`Associated families - allowing access`);
          return {
            message: 'Profile fetched successfully',
            data: { ...plainTargetUser, blockStatus },
            currentUser: loggedInUser,
          };
        }
      }

      this.logger.error(`Private profile access denied: user ${loggedInUser.userId} cannot view user ${id}`);
      throw new BadRequestException({
        message: 'This profile is private. Only family members can view it.',
      });
    }

    // Default allow (should not reach here)
    return {
      message: 'Profile fetched successfully',
      data: { ...plainTargetUser, blockStatus },
      currentUser: loggedInUser,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('gift-address/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get minimal user address info for gifting' })
  @ApiResponse({ status: 200, description: 'Gifting address data' })
  @ApiBearerAuth()
  @ApiSecurity('application-token')
  async getGiftAddress(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const loggedInUser = req.user;
    const targetUserId = Number(id);

    if (loggedInUser.userId === targetUserId) {
      const data = await this.userService.getUserAddressForGifting(id);
      return {
        message: 'Gifting address fetched successfully',
        data,
        currentUser: loggedInUser,
      };
    }

    const usersBlockedEitherWay =
      await this.blockingService.isUserBlockedEitherWay(
        Number(loggedInUser.userId),
        targetUserId,
      );
    if (usersBlockedEitherWay) {
      throw new ForbiddenException('Access denied');
    }

    const [myProfile, targetUser] = await Promise.all([
      this.userService.getUserProfile(loggedInUser.userId),
      this.userService.getUserProfile(id),
    ]);

    const myFamilyCode = myProfile?.userProfile?.familyCode;
    const targetFamilyCode = targetUser?.userProfile?.familyCode;

    if (myFamilyCode && targetFamilyCode && myFamilyCode === targetFamilyCode) {
      const data = await this.userService.getUserAddressForGifting(id);
      return {
        message: 'Gifting address fetched successfully',
        data,
        currentUser: loggedInUser,
      };
    }

    throw new BadRequestException({
      message: 'Access denied: You can only view addresses in your family',
    });
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
  @ApiResponse({
    status: 200,
    description: 'User profile updated successfully',
  })
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
    // if (loggedInUser.role === 1 && loggedInUser.userId !== targetUserId) {
    //   throw new BadRequestException({message:'Access denied: Members can only update their own profile'});
    // }

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

    return this.userService.updateProfile(targetUserId, body, loggedInUser);
  }

  // @Put('profile/update/public/:id')
  // @UseInterceptors(
  //   FileInterceptor('profile', {
  //     storage: memoryStorage(),
  //     fileFilter: imageFileFilter,
  //     limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  //   }),
  // )
  // @HttpCode(HttpStatus.OK)
  // @ApiOperation({ summary: 'Update user profile with optional image (public endpoint)' })
  // @ApiResponse({ status: 200, description: 'User profile updated successfully' })
  // @ApiConsumes('multipart/form-data')
  // async updateProfilePublic(
  //   @Param('id') id: number,
  //   @UploadedFile() file: Express.Multer.File,
  //   @Body() body: UpdateProfileDto,
  // ) {
  //   // Convert param to number just in case
  //   const targetUserId = Number(id);

  //   // Clean up empty strings in the body
  //   Object.keys(body).forEach((key) => {
  //     if (body[key] === '') {
  //       body[key] = undefined;
  //     }
  //   });

  //   // Handle file upload to S3 if file exists
  //   if (file) {
  //     // Upload to S3 and get the URL
  //     body.profile = await this.uploadService.uploadFile(file, 'profile');
  //   }

  //   return this.userService.updateProfile(targetUserId, body , loggedInUser = null );
  // }

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
