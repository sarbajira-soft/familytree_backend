import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User } from './model/user.model';
import { FamilyMember } from '../family/model/family-member.model';
import { UserProfile } from './model/user-profile.model';
import { Invite } from './model/invite.model';
import { MailService } from '../utils/mail.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';

import { ResetPasswordDto } from './dto/reset-password.dto';
import { ForgetPasswordDto } from './dto/forget-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Family } from '../family/model/family.model';
import { RegisterDto } from './dto/register.dto';

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
    private mailService: MailService,
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

  async register(registerDto: RegisterDto){
      
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
          message: 'User with this email or mobile already exists',
        });
      }

      // Check for existing unverified users
      const existingUnverifiedUser = await this.userModel.findOne({
        where: { email: registerDto.email, status: 0 },
      });

      const otp = this.generateOtp();
      const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      const hashedPassword = await bcrypt.hash(registerDto.password, 10);

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
      
      await this.mailService.sendVerificationOtp(registerDto.email, otp);
      return { message: 'OTP sent to email', email: registerDto.email, mobile: registerDto.countryCode+registerDto.mobile };
    
  }

  async verifyOtp(verifyOtpDto: { userName?: string; otp: string }) {
    const { userName, otp } = verifyOtpDto;

    if (!userName) {
      throw new BadRequestException({
        message:'Email or mobile must be provided'
      });
    }

    // Determine if the userName is an email or mobile
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userName);
    const whereClause: any = {};

    if (isEmail) {
      whereClause.email = userName;
    } else {
      // Optional: You could split countryCode from mobile if you're storing them separately
      // For now, assuming full mobile number with country code is stored in `mobile` field
      whereClause.mobile = userName;
    }

    const user = await this.userModel.findOne({ where: whereClause });

    if (!user) {
      throw new BadRequestException({
        message: isEmail ? 'User with this email not found' : 'User with this mobile number not found'
      });
    }

    if (user.status === 1) throw new BadRequestException({message:'Account already verified'});
    if (user.otp !== verifyOtpDto.otp) throw new BadRequestException({message:'Invalid OTP'});
    if (new Date(user.otpExpiresAt) < new Date()) throw new BadRequestException({message:'OTP expired'});

    const accessToken = this.generateAccessToken(user);

    await user.update({
      status: 1,
      otp: null,
      otpExpiresAt: null,
      verifiedAt: new Date(),
      accessToken,
    });

    const userProfile = await this.userProfileModel.findOne({ where: { userId: user.id } });
    
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
        status: user.status,
      },
    };
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
              attributes: ['familyCode'],
            },
          ],
        },
      ],
    });

    if (!user) throw new NotFoundException('User profile not found');

    const baseUrl = process.env.BASE_URL || '';
    const basePath = process.env.UPLOAD_BASE_PATH || '/uploads';
    const folderPath = process.env.PROFILE_FOLDER || '/profile';
    const profile = user.userProfile?.profile;
    
    if (profile) {
      user.userProfile.profile = `${baseUrl}/${basePath}/${folderPath}/${profile}`;
    }

    return user;
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const user = await this.userProfileModel.findOne({ where: { userId } });
    if (!user) throw new BadRequestException({message:'User not found'});

    //  Check if familyCode is present and valid
    if (dto.familyCode) {
      const existingFamily = await this.familyModel.findOne({ where: { familyCode: dto.familyCode } });
      if (!existingFamily) {
        throw new BadRequestException({message:'Invalid family code. Please enter a valid family code.'});
      }
    }

    // Handle profile image update and old file removal
    if (dto.profile) {
      const newFile = path.basename(dto.profile);
      if (newFile && user.profile && user.profile !== newFile) {
        const uploadPath = process.env.UPLOAD_FOLDER_PATH || './uploads/profile';
        const oldImagePath = path.join(uploadPath, user.profile);
        try {
          if (fs.existsSync(oldImagePath)) {
            fs.unlinkSync(oldImagePath);
            console.log('Old profile image deleted:', oldImagePath);
          }
        } catch (err) {
          console.warn(`Failed to remove old profile image: ${err.message}`);
        }
      }
    }

    const existingFamilyMember = await this.familyMemberModel.findOne({ where: { memberId: userId } });
    const currentFamilyCode = existingFamilyMember?.familyCode || null;
    if (dto.familyCode && dto.familyCode !== currentFamilyCode) {
      const remarks = `Requested to join family using code ${dto.familyCode}`;
      await this.inviteModel.create({
        userId: userId,
        familyCode: dto.familyCode,
        createdAt: new Date(),
        updatedAt: new Date(),
        remarks: remarks,
        inviteType: 'FAMILY_JOIN'
      });
      await this.familyMemberModel.create({
        memberId: userId,       
        familyCode: dto.familyCode,
        creatorId: null,
        approveStatus: 'pending'
      });
    }


    user.set(dto as any);
    await user.save();

    return {
      message: 'Profile updated successfully',
      data: user,
    };
  }

}