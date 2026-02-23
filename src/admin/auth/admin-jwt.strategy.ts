import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/sequelize';
import { ConfigService } from '@nestjs/config';

import { AdminLogin } from '../model/admin-login.model';

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(
    @InjectModel(AdminLogin)
    private readonly adminLoginModel: typeof AdminLogin,
    private readonly configService: ConfigService,
  ) {
    const secret =
      configService.get<string>('JWT_SECRET') || process.env.JWT_SECRET;

    if (!secret) {
      throw new Error('JWT_SECRET is not set');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: any) {
    if (!payload?.adminId) {
      throw new UnauthorizedException('Invalid admin token');
    }

    const admin = await this.adminLoginModel.findByPk(payload.adminId);
    if (!admin) {
      throw new UnauthorizedException('Invalid admin token');
    }

    return {
      adminId: admin.id,
      uuid: (admin as any).uuid,
      email: (admin as any).email,
      role: (admin as any).role,
      isAdmin: true,
    };
  }
}
