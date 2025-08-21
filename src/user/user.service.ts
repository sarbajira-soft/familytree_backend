import { Injectable, BadRequestException, ConflictException, ForbiddenException, Inject, forwardRef, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User } from './model/user.model';
import { FamilyMember } from '../family/model/family-member.model';
import { UserProfile } from './model/user-profile.model';
import { Invite } from './model/invite.model';
import { MailService } from '../utils/mail.service';
import { UploadService } from '../uploads/upload.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';

import { ResetPasswordDto } from './dto/reset-password.dto';
import { ForgetPasswordDto } from './dto/forget-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Family } from '../family/model/family.model';
import { RegisterDto } from './dto/register.dto';
import { NotificationService } from '../notification/notification.service';
import { Religion } from '../religion/model/religion.model';
import { Language } from '../language/model/language.model';
import { Gothram } from '../gothram/model/gothram.model';
import { Notification } from '../notification/model/notification.model';

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User)
    private userModel: typeof User,
    @InjectModel(UserProfile)
    private userProfileModel: typeof UserProfile,
    @InjectModel(Family)
    private familyModel: typeof Family,
    @InjectModel(FamilyMember)
    private familyMemberModel: typeof FamilyMember,
    @InjectModel(Invite)
    private inviteModel: typeof Invite,
    @InjectModel(Religion)
    private religionModel: typeof Religion,
    @InjectModel(Language)
    private languageModel: typeof Language,
    @InjectModel(Gothram)
    private gothramModel: typeof Gothram,
    @InjectModel(Notification)
    private notificationModel: typeof Notification,
    private mailService: MailService,
    private notificationService: NotificationService,
    @Inject(forwardRef(() => UploadService))
    private uploadService: UploadService,
  ) {}

  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private generateAccessToken(user: User): string {
    return jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' },
    );
  }

  async register(registerDto: RegisterDto) {
    try {
      // Input validation
      if (!registerDto.email || !registerDto.password || !registerDto.firstName || 
          !registerDto.lastName || !registerDto.countryCode || !registerDto.mobile) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'All required fields must be provided',
          error: 'Bad Request',
          requiredFields: ['email', 'password', 'firstName', 'lastName', 'countryCode', 'mobile']
        });
      }

      // Check for existing verified users
      const existingVerifiedUser = await this.userModel.findOne({
        where: {
          status: 1,
          [Op.or]: [
            { email: registerDto.email },
            {
              countryCode: registerDto.countryCode,
              mobile: registerDto.mobile,
            },
          ],
        },
      });

      if (existingVerifiedUser) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'User with this email or mobile already exists',
          error: 'Bad Request',
          existingUser: {
            email: existingVerifiedUser.email,
            mobile: existingVerifiedUser.mobile,
            status: existingVerifiedUser.status
          }
        });
      }

      // Check for existing unverified users with the same email
      const existingUnverifiedUser = await this.userModel.findOne({
        where: { 
          [Op.or]: [
            { email: registerDto.email, status: 0 },
            { 
              countryCode: registerDto.countryCode,
              mobile: registerDto.mobile,
              status: 0
            }
          ]
        },
      });

      const otp = this.generateOtp();
      const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      const hashedPassword = await bcrypt.hash(registerDto.password, 10);

      try {
        if (existingUnverifiedUser) {
          // Update existing unverified user
          await existingUnverifiedUser.update({
            ...registerDto,
            password: hashedPassword,
            otp,
            otpExpiresAt,
            role: registerDto.role || 1, // Default to member if not specified
          });
        } else {
          // Create new user
          const user = await this.userModel.create({
            ...registerDto,
            password: hashedPassword,
            otp,
            otpExpiresAt,
            status: 0, // unverified
            role: registerDto.role || 1, // Default to member
          });
          await this.userProfileModel.create({
            userId: user.id,
            firstName: registerDto.firstName,
            lastName: registerDto.lastName
          });
        }
        
        // Send OTP email
        await this.mailService.sendVerificationOtp(registerDto.email, otp);
        
        return { 
          statusCode: 201,
          message: 'OTP sent to email', 
          email: registerDto.email, 
          mobile: registerDto.countryCode + registerDto.mobile,
          expiresIn: '15 minutes'
        };
      } catch (error) {
        console.error('Error during user registration:', error);
        throw new BadRequestException({
          statusCode: 400,
          message: 'Failed to register user',
          error: 'Registration Error',
          details: error.message
        });
      }
    } catch (error) {
      console.error('Registration error:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException({
        statusCode: 400,
        message: 'Registration failed',
        error: 'Registration Error',
        details: error.message
      });
    }
  }

  async verifyOtp(verifyOtpDto: { userName?: string; otp: string }) {
    try {
      const { userName, otp } = verifyOtpDto;

      if (!userName) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'Email or mobile must be provided',
          error: 'Bad Request'
        });
      }

      // Determine if the userName is an email or mobile
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userName);
      const whereClause: any = {};

      if (isEmail) {
        whereClause.email = userName;
      } else {
        // Handle mobile number (with or without country code)
        whereClause.mobile = userName;
      }

      const user = await this.userModel.findOne({ where: whereClause });

      if (!user) {
        throw new BadRequestException({
          statusCode: 400,
          message: isEmail ? 'User with this email not found' : 'User with this mobile number not found',
          error: 'Bad Request'
        });
      }

      if (user.status === 1) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'Account already verified',
          error: 'Bad Request'
        });
      }

      if (!user.otp || user.otp !== otp) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'Invalid OTP',
          error: 'Bad Request'
        });
      }

      if (!user.otpExpiresAt || new Date(user.otpExpiresAt) < new Date()) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'OTP has expired',
          error: 'Bad Request'
        });
      }

      const accessToken = this.generateAccessToken(user);

      await user.update({
        status: 1,
        otp: null,
        otpExpiresAt: null,
        verifiedAt: new Date(),
        accessToken,
      });

      const userProfile = await this.userProfileModel.findOne({ 
        where: { userId: user.id },
        attributes: ['firstName', 'lastName', 'gender']
      });

      if (!userProfile) {
        console.error(`User profile not found for user ID: ${user.id}`);
        throw new Error('User profile not found');
      }
      
      return {
        message: 'Account verified successfully',
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          mobile: user.mobile,
          firstName: userProfile.firstName,
          lastName: userProfile.lastName,
          role: user.role,
          status: 1, // Explicitly set to 1 as we just verified
          gender: userProfile.gender,
        },
      };
    } catch (error) {
      console.error('Error in verifyOtp:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException({
        statusCode: 500,
        message: 'An error occurred while verifying OTP',
        error: 'Internal Server Error'
      });
    }
  }

  async login(loginDto: { username?: string; password: string }) {
    // Check if username is provided
    if (!loginDto.username) {
      throw new BadRequestException({message:'Please provide username (email or mobile number)'});
    }

    // Determine if username is email or mobile
    const isEmail = loginDto.username.includes('@');
    const isMobile = /^\+?\d{10,15}$/.test(loginDto.username);

    if (!isEmail && !isMobile) {
      throw new BadRequestException({message:'Username must be a valid email or mobile number'});
    }

    // Build the where clause
    const whereClause = isEmail 
      ? { email: loginDto.username }
      : { mobile: loginDto.username };

    const user = await this.userModel.findOne({
      where: whereClause,
    });

    if (!user) {
      throw new BadRequestException({message:'Invalid credentials'});
    }

    // Check if account is verified
    if (user.status !== 1) {
      throw new BadRequestException({message:'Account not verified. Please verify your account first'});
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new BadRequestException({message:'Invalid credentials'});
    }

    // Generate new access token
    const accessToken = this.generateAccessToken(user);

    // Update last login and access token
    await user.update({
      accessToken,
      lastLoginAt: new Date(),
    });
    const userProfile = await this.userProfileModel.findOne({ where: { userId: user.id } });
    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: userProfile.firstName,
        lastName: userProfile .lastName,
        mobile: user.mobile,
        role: user.role,
        status: user.status,
        gender: userProfile.gender,
      },
    };
  }

  async resendOtp(resendOtpDto: { email?: string; mobile?: string }) {
    if (!resendOtpDto.email && !resendOtpDto.mobile) {
      throw new BadRequestException({message:'Either email or mobile must be provided'});
    }

    const whereClause: any = {};
    if (resendOtpDto.email) {
      whereClause.email = resendOtpDto.email;
    } else {
      whereClause.mobile = resendOtpDto.mobile;
    }

    const user = await this.userModel.findOne({ where: whereClause });

    if (!user) {
      throw new BadRequestException({
        message:
        resendOtpDto.email 
          ? 'User with this email not found' 
          : 'User with this mobile number not found'
      });
    }
    // Check if OTP was sent less than 1 minute ago
    if (user.otpExpiresAt && new Date(user.otpExpiresAt.getTime() - 4 * 60 * 1000) > new Date()) {
      throw new BadRequestException({message:'Please wait before requesting a new OTP'});
    }

    // Generate new OTP
    const otp = this.generateOtp();
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Update user with new OTP
    await user.update({
      otp,
      otpExpiresAt,
    });

    // Send OTP email
    await this.mailService.sendVerificationOtp(user.email, otp);

    return {
      message: 'New OTP sent to your email',
      email: user.email,
    };
  }

  async forgetPassword(forgetPasswordDto: { username: string }) {
    const { username } = forgetPasswordDto;

    // Try finding by email or mobile
    const user = await this.userModel.findOne({
      where: {
        [Op.or]: [
          { email: username },
          { mobile: username }
        ]
      }
    });

    if (!user) {
      throw new BadRequestException({message:'User not found'});
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    await user.update({ otp, otpExpiresAt });

    // Send OTP logic (email or SMS) based on username pattern
    if (username.includes('@')) {
      await this.mailService.sendPasswordResetOtp(user.email, otp);
    } else {
      // sendSmsOtp(user.mobile, otp);
    }

    return { message: 'OTP sent successfully' };
  }

  async resetPassword(resetPasswordDto: {
    username: string;
    otp: string;
    newPassword: string;
    confirmPassword: string;
  }) {
    const { username, otp, newPassword, confirmPassword } = resetPasswordDto;

    // Validate required fields
    if (!username || !otp || !newPassword || !confirmPassword) {
      throw new BadRequestException({message:'All fields are required'});
    }

    // Check if passwords match
    if (newPassword !== confirmPassword) {
      throw new BadRequestException({message:'Passwords do not match'});
    }

    // Determine whether the username is email or mobile
    const isEmail = username.includes('@');
    const whereClause: any = {
      otp,
      ...(isEmail ? { email: username } : { mobile: username }),
    };

    // Find user
    const user = await this.userModel.findOne({ where: whereClause });

    if (!user) {
      throw new BadRequestException({message:'Invalid OTP or user not found'});
    }

    // Check OTP expiration
    if (!user.otpExpiresAt || new Date(user.otpExpiresAt) < new Date()) {
      throw new BadRequestException({message:'OTP has expired'});
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the user record
    await user.update({
      password: hashedPassword,
      otp: null,
      otpExpiresAt: null,
    });

    return {
      message: 'Password reset successfully',
    };
  }

  async getUserProfile(id: number | string) {
    try {
      const user = await this.userModel.findOne({
        where: { id },
        include: [
          {
            model: UserProfile,
            as: 'userProfile',
            include: [
              {
                model: FamilyMember,
                as: 'familyMember',
                attributes: ['familyCode', 'approveStatus'],
              },
              {
                model: Religion,
                as: 'religion',
                attributes: ['id', 'name'],
              },
              {
                model: Language,
                as: 'language',
                attributes: ['id', 'name', 'isoCode'],
              },
              {
                model: Gothram,
                as: 'gothram',
                attributes: ['id', 'name'],
              },
            ],
          },
        ],
      });

      if (!user) throw new NotFoundException('User profile not found');

      // Convert profile filename to full URL if it exists and isn't already a URL
      if (user.userProfile?.profile) {
        user.userProfile.profile = this.uploadService.getFileUrl(user.userProfile.profile, 'profile');
      }

      return user;
    } catch (error) {
      console.error('Error in getUserProfile:', error);
      throw new BadRequestException({
        statusCode: 500,
        message: 'Failed to fetch user profile',
        error: 'Server Error',
        details: error.message
      });
    }
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    try {
      // Fetch both user and user profile
      const user = await this.userModel.findByPk(userId);
      const userProfile = await this.userProfileModel.findOne({ where: { userId } });

      if (!user || !userProfile) {
        throw new BadRequestException({ message: 'User not found' });
      }

      // Store the original profile image to delete later if needed
      const originalProfileImage = userProfile.profile;
      
      // If a new profile image is provided (not empty and different from current)
      if (dto.profile && dto.profile !== '') {
        // If there's an existing image, delete it from S3
        if (originalProfileImage && originalProfileImage !== '') {
          try {
            console.log('Deleting old profile image from S3:', originalProfileImage);
            const deleted = await this.uploadService.deleteFile(originalProfileImage, 'profile');
            if (deleted) {
              console.log('Successfully deleted old profile image');
            } else {
              console.warn('Failed to delete old profile image, but continuing with update');
            }
          } catch (error) {
            console.error('Error deleting old profile image from S3:', error);
            // Continue with the update even if deletion fails
          }
        }
      }

      const isNewImageUploaded = dto.profile && dto.profile !== originalProfileImage;
      
      // If a new profile image is provided and it's different from the current one
      if (isNewImageUploaded && originalProfileImage) {
        try {
          // Delete the old image from S3
          const oldImageUrl = this.uploadService.getFileUrl(originalProfileImage, 'profile');
          await this.uploadService.deleteFile(oldImageUrl);
        } catch (error) {
          console.error('Error deleting old profile image from S3:', error);
          // Continue with the update even if deletion fails
        }
      }

      // Validate family code
      if (dto.familyCode) {
        const existingFamily = await this.familyModel.findOne({ 
          where: { familyCode: dto.familyCode } 
        });
        if (!existingFamily) {
          throw new BadRequestException({ 
            message: 'Invalid family code. Please enter a valid family code.' 
          });
        }
      }

      const { email, countryCode, mobile, role, status } = dto;
      
      // Handle email update - allow same email, but check for conflicts with other users
      if (email !== undefined && email !== user.email) {
        const emailExists = await this.userModel.findOne({
          where: { 
            email, 
            id: { [Op.ne]: userId },
            status: { [Op.ne]: 3 } // Exclude deleted users
          },
        });
        if (emailExists) {
          throw new BadRequestException({ 
            message: 'Email already in use by another user' 
          });
        }
        user.email = email;
      }

      // Handle mobile number update - allow same mobile, but check for conflicts with other users
      if (mobile !== undefined && countryCode !== undefined && 
          (mobile !== user.mobile || countryCode !== user.countryCode)) {
        const mobileExists = await this.userModel.findOne({
          where: {
            mobile,
            countryCode,
            id: { [Op.ne]: userId },
            status: { [Op.ne]: 3 } // Exclude deleted users
          },
        });
        if (mobileExists) {
          throw new BadRequestException({ 
            message: 'Mobile number already in use by another user' 
          });
        }
        user.mobile = mobile;
        user.countryCode = countryCode;
      }

      // Direct assignments (no uniqueness checks needed)
      if (role !== undefined) user.role = role;
      if (status !== undefined) user.status = status;

      await user.save();

      // Handle profile image cleanup - only if we're not using S3 URL
      if (dto.profile && !dto.profile.startsWith('http')) {
        const newFile = path.basename(dto.profile);
        if (newFile && userProfile.profile && userProfile.profile !== newFile) {
          const uploadPath = process.env.UPLOAD_FOLDER_PATH || './uploads/profile';
          const oldImagePath = path.join(uploadPath, userProfile.profile);
          try {
            if (fs.existsSync(oldImagePath)) {
              fs.unlinkSync(oldImagePath);
            }
          } catch (err) {
            console.warn(`Failed to remove old profile image: ${err.message}`);
          }
        }
      }

      // Update user profile with the new family code if provided
      if (dto.familyCode) {
        // Update the family code in the user profile
        userProfile.familyCode = dto.familyCode;
        
        // Check if user is already a member of this family
        const existing = await this.familyMemberModel.findOne({
          where: { memberId: userId, familyCode: dto.familyCode },
        });

        if (!existing) {
          await this.familyMemberModel.create({
            memberId: userId,
            familyCode: dto.familyCode,
            creatorId: null,
            approveStatus: 'approved', // Auto-approve since user is updating their own profile
          });

          const adminUserIds = await this.notificationService.getAdminsForFamily(dto.familyCode);
          if (adminUserIds && adminUserIds.length > 0) {
            await this.notificationService.createNotification(
              {
                type: 'FAMILY_MEMBER_JOINED',
                title: 'Family Member Joined',
                message: `User ${userProfile.firstName || ''} ${userProfile.lastName || ''} has joined the family.`,
                familyCode: dto.familyCode,
                referenceId: userId,
                userIds: adminUserIds,
              },
              userId
            );
          }
        }
      }

      // Save the updated profile
      await userProfile.save();

      // Get the updated user with profile and related data
      const updatedUser = await this.userModel.findByPk(userId, {
        include: [
          {
            model: UserProfile,
            as: 'userProfile',
            include: [
              {
                model: FamilyMember,
                as: 'familyMember',
                attributes: ['familyCode', 'approveStatus'],
              },
              {
                model: Religion,
                as: 'religion',
                attributes: ['id', 'name'],
              },
              {
                model: Language,
                as: 'language',
                attributes: ['id', 'name', 'code'],
              },
              {
                model: Gothram,
                as: 'gothram',
                attributes: ['id', 'name'],
              },
            ],
          },
        ],
      });

      // Convert profile image to URL if it exists
      // Convert profile filename to full URL for the response
      if (updatedUser.userProfile?.profile) {
        updatedUser.userProfile.profile = this.uploadService.getFileUrl(updatedUser.userProfile.profile, 'profile');
      }

      return {
        message: 'Profile updated successfully',
        data: {
          ...updatedUser.toJSON(),
          userProfile: updatedUser.userProfile?.toJSON(),
        },
      };
    } catch (err) {
      console.error('Update Profile Error:', err);
      if (err?.name === 'SequelizeValidationError') {
        throw new BadRequestException({
          message: 'Validation error',
          errors: err.errors.map((e) => e.message),
        });
      }
      throw new BadRequestException({ 
        message: err?.message || 'Something went wrong' 
      });
    }
  }

  async deleteUser(userId: number, requesterId: number) {
    const member = await this.familyMemberModel.findOne({ where: { memberId: userId } });

    // Only check creatorId if member exists
    if (member && member.creatorId !== requesterId) {
      throw new ForbiddenException('You are not authorized to delete this member.');
    }

    // Get user with profile using the correct association alias
    const user = await this.userModel.findByPk(userId, {
      include: [{
        model: UserProfile,
        as: 'userProfile'  // Specify the alias used in the association
      }]
    });
    
    if (!user) throw new BadRequestException({ message: 'User not found' });

    // Delete profile image from S3 if it exists
    if (user.userProfile?.profile) {
      try {
        console.log(`Deleting profile image for user ${userId}:`, user.userProfile.profile);
        await this.uploadService.deleteFile(user.userProfile.profile, 'profile');
        console.log(`Successfully deleted profile image for user ${userId}`);
      } catch (error) {
        console.error(`Error deleting profile image for user ${userId}:`, error);
        // Continue with user deletion even if image deletion fails
      }
    }

    // Soft delete user
    user.status = 3;
    await user.save();

    // Remove from ft_family_members if the record exists
    if (member) {
      try {
        await this.familyMemberModel.destroy({ where: { memberId: userId } });
        console.log(`Removed user ${userId} from family members`);
      } catch (error) {
        console.error(`Error removing user ${userId} from family members:`, error);
        // Continue even if this fails
      }
    }

    return { message: 'User deleted successfully' };
  }

  async mergeUserData(existingUserId: number, currentUserId: number, notificationId?: number) {
    // 1. Fetch users and profiles
    const existingUser = await this.userModel.findByPk(existingUserId);
    const currentUser = await this.userModel.findByPk(currentUserId);
    const existingProfile = await this.userProfileModel.findOne({ where: { userId: existingUserId } });
    const currentProfile = await this.userProfileModel.findOne({ where: { userId: currentUserId } });

    if (!existingUser || !currentUser || !existingProfile || !currentProfile) {
      throw new BadRequestException('User or profile not found');
    }

    // Store the original profile image to delete later if needed
    const existingProfileImage = existingProfile.profile;
    const newProfileImage = currentProfile.profile;

    // 2. Overwrite all fields except id/userId and familyCode
    Object.assign(existingUser, currentUser.toJSON(), { id: existingUser.id });
    Object.assign(
      existingProfile,
      currentProfile.toJSON(),
      { 
        id: existingProfile.id, 
        userId: existingUserId, 
        familyCode: existingProfile.familyCode 
      }
    );

    // If the current user has a different profile image, handle S3 cleanup
    if (newProfileImage && newProfileImage !== existingProfileImage) {
      try {
        // Delete the old profile image from S3 if it exists
        if (existingProfileImage) {
          console.log(`Deleting old profile image for user ${existingUserId}:`, existingProfileImage);
          await this.uploadService.deleteFile(existingProfileImage, 'profile');
        }
      } catch (error) {
        console.error('Error deleting old profile image during merge:', error);
        // Continue with merge even if image deletion fails
      }
    }

    // 3. Delete current user and profile
    try {
      // Delete the current user's profile image from S3 if it exists
      if (newProfileImage && newProfileImage !== existingProfileImage) {
        console.log(`Deleting current user's profile image:`, newProfileImage);
        await this.uploadService.deleteFile(newProfileImage, 'profile');
      }
      
      await currentProfile.destroy();
      await currentUser.destroy();
    } catch (error) {
      console.error('Error during user deletion in merge:', error);
      throw error; // Re-throw to ensure we don't leave data in an inconsistent state
    }

    // 4. Save the updated existing user and profile
    await existingUser.save();
    await existingProfile.save();

    // 5. Update notification type if notificationId is provided
    if (notificationId) {
      await this.notificationModel.update(
        { type: 'FAMILY_MEMBER_JOINED' },
        { where: { id: notificationId } }
      );
    }

    return { message: 'User data swapped, current user deleted, and notification updated', userId: existingUserId };
  }
}