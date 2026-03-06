import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/sequelize';
import { User } from '../user/model/user.model';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectModel(User)
    private readonly userModel: typeof User,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  async validate(payload: any) {
    const user = await this.userModel.findByPk(payload.id);

    if (!user) {
      throw new UnauthorizedException('Invalid access token or user not found');
    }

    const isActive = Number((user as any).status) === 1;
    const lifecycleState = String((user as any).lifecycleState || 'active');
    if (!isActive || lifecycleState !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }

    return {
      userId: user.id,
      role: user.role,
      mobile: user.mobile,
      email: user.email,
      isAppUser: user.isAppUser,
      hasAcceptedTerms: user.hasAcceptedTerms,
    };
  }
}
