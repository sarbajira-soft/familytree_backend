import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SequelizeModule } from '@nestjs/sequelize';

import { AdminController } from './admin.controller';
import { AdminAuditLogService } from './admin-audit-log.service';
import { AdminService } from './admin.service';
import { AdminJwtStrategy } from './auth/admin-jwt.strategy';
import { AdminJwtAuthGuard } from './auth/admin-jwt-auth.guard';
import { AdminRolesGuard } from './auth/admin-roles.guard';
import { AdminAuditLog } from './model/admin-audit-log.model';
import { AdminLogin } from './model/admin-login.model';

@Module({
  imports: [
    SequelizeModule.forFeature([AdminLogin, AdminAuditLog]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const secret =
          configService.get<string>('JWT_SECRET') || process.env.JWT_SECRET;

        if (!secret) {
          throw new Error('JWT_SECRET is not set');
        }

        return {
          secret,
          signOptions: { expiresIn: '1d' },
        };
      },
    }),
  ],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminAuditLogService,
    AdminJwtStrategy,
    AdminJwtAuthGuard,
    AdminRolesGuard,
  ],
  exports: [AdminService],
})
export class AdminModule {}
