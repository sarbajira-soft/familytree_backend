import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { AdminLogin } from './model/admin-login.model';
import { AdminLoginDto } from './dto/admin-login.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(AdminLogin)
    private readonly adminLoginModel: typeof AdminLogin,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: AdminLoginDto) {
    const email = (dto.email || '').trim().toLowerCase();
    const password = dto.password;

    if (!email || !password) {
      throw new BadRequestException({ message: 'Email and password are required' });
    }

    const admin = await this.adminLoginModel.findOne({ where: { email } });
    if (!admin) {
      throw new BadRequestException({ message: 'Invalid credentials' });
    }

    if (Number((admin as any).status) !== 1) {
      throw new ForbiddenException('Admin account is inactive');
    }

    const passwordMatches = await bcrypt.compare(password, (admin as any).password || '');
    if (!passwordMatches) {
      throw new BadRequestException({ message: 'Invalid credentials' });
    }

    const accessToken = this.jwtService.sign({
      adminId: admin.id,
      uuid: (admin as any).uuid,
      email: (admin as any).email,
      role: (admin as any).role,
      isAdmin: true,
    });

    await admin.update({ lastLoginAt: new Date() });

    return {
      message: 'Login successful',
      accessToken,
      admin: {
        id: admin.id,
        uuid: (admin as any).uuid,
        email: (admin as any).email,
        fullName: (admin as any).fullName,
        role: (admin as any).role,
        lastLoginAt: (admin as any).lastLoginAt,
      },
    };
  }
}
