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
    //console.log(user);
    
    if (!user) {
      throw new UnauthorizedException('Invalid access token or user not found');
    }

    return {
      userId: user.id,
      role: payload.role,
      mobile: user.mobile,
      email: user.email,
      isAppUser: user.isAppUser,
      hasAcceptedTerms: user.hasAcceptedTerms,
    };
  }
}
