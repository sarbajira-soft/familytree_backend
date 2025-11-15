import { BadRequestException, Controller, Post, Body, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/sequelize';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AcceptTermsDto } from './dto/accept-terms.dto';
import { User } from './model/user.model';

@ApiTags('User Module')
@Controller('user')
export class UserConsentController {
  constructor(
    @InjectModel(User)
    private readonly userModel: typeof User,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('accept-terms')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accept Terms & Conditions' })
  @ApiBody({ type: AcceptTermsDto })
  @ApiResponse({ status: 200, description: 'Terms accepted successfully' })
  async acceptTerms(@Req() req, @Body() body: AcceptTermsDto) {
    const loggedInUser = req.user;

    if (!body.accepted) {
      throw new BadRequestException({ message: 'Terms must be accepted' });
    }

    const userId = Number(loggedInUser.userId);
    const user = await this.userModel.findByPk(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const termsVersion = body.termsVersion || 'v1.0.0';
    const now = new Date();

    await user.update({
      hasAcceptedTerms: true,
      termsVersion,
      termsAcceptedAt: now,
    });

    return {
      message: 'Terms accepted successfully',
      data: {
        userId: user.id,
        hasAcceptedTerms: true,
        termsVersion,
        termsAcceptedAt: now,
      },
    };
  }
}
