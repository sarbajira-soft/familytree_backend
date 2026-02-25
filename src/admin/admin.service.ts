import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Op } from 'sequelize';

import { AdminLogin } from './model/admin-login.model';
import { AdminAuditLogService } from './admin-audit-log.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(AdminLogin)
    private readonly adminLoginModel: typeof AdminLogin,
    private readonly jwtService: JwtService,
    private readonly adminAuditLogService: AdminAuditLogService,
  ) {}

  private assertActorIsSuperadmin(actor: any) {
    if (!actor || actor.role !== 'superadmin') {
      throw new ForbiddenException('Access denied: Insufficient permissions');
    }
  }

  private toAdminResponse(admin: AdminLogin) {
    return {
      id: admin.id,
      uuid: (admin as any).uuid,
      email: (admin as any).email,
      fullName: (admin as any).fullName,
      role: (admin as any).role,
      status: Number((admin as any).status),
      lastLoginAt: (admin as any).lastLoginAt,
      createdAt: (admin as any).createdAt,
      updatedAt: (admin as any).updatedAt,
    };
  }

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

    await this.adminAuditLogService.log(admin.id, 'ADMIN_LOGIN_SUCCESS', {
      targetType: 'admin_auth',
      targetId: admin.id,
      metadata: {
        email: (admin as any).email,
        role: (admin as any).role,
      },
    });

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

  async me(actor: any) {
    if (!actor?.adminId) {
      throw new ForbiddenException('No admin data in request');
    }

    const admin = await this.adminLoginModel.findByPk(actor.adminId);
    if (!admin) throw new NotFoundException('Admin not found');

    return {
      message: 'Admin fetched successfully',
      admin: this.toAdminResponse(admin),
    };
  }

  async listAdmins(actor: any) {
    this.assertActorIsSuperadmin(actor);

    const admins = await this.adminLoginModel.findAll({
      order: [['id', 'DESC']],
    });

    return {
      message: 'Admins fetched successfully',
      data: admins.map((a) => this.toAdminResponse(a)),
    };
  }

  async createAdmin(actor: any, dto: CreateAdminDto) {
    this.assertActorIsSuperadmin(actor);

    const email = (dto.email || '').trim().toLowerCase();
    const password = dto.password;
    const fullName = (dto.fullName || '').trim();
    const status = dto.status ?? 1;

    if (!email || !password) {
      throw new BadRequestException({ message: 'Email and password are required' });
    }

    if (!fullName) {
      throw new BadRequestException({ message: 'Full name is required' });
    }

    if (dto.role && dto.role === 'superadmin') {
      throw new BadRequestException({
        message: 'Superadmin can only be assigned by promoting an admin',
      });
    }

    const existing = await this.adminLoginModel.findOne({ where: { email } });
    if (existing) {
      throw new BadRequestException({ message: 'Email already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const admin = await this.adminLoginModel.create({
      email,
      password: passwordHash,
      fullName,
      role: 'admin',
      status: Number(status),
    } as any);

    await this.adminAuditLogService.log(Number(actor.adminId), 'ADMIN_ACCOUNT_CREATED', {
      targetType: 'admin_account',
      targetId: admin.id,
      metadata: {
        email: (admin as any).email,
        role: (admin as any).role,
        status: Number((admin as any).status),
      },
    });

    return {
      message: 'Admin created successfully',
      admin: this.toAdminResponse(admin),
    };
  }

  async updateAdmin(actor: any, adminId: number, dto: UpdateAdminDto) {
    this.assertActorIsSuperadmin(actor);

    const target = await this.adminLoginModel.findByPk(adminId);
    if (!target) throw new NotFoundException('Admin not found');

    const before = {
      email: (target as any).email,
      fullName: (target as any).fullName,
      role: (target as any).role,
      status: Number((target as any).status),
    };

    if ((target as any).role === 'superadmin') {
      throw new ForbiddenException('You cannot edit a superadmin account');
    }

    if (dto.email !== undefined) {
      const email = (dto.email || '').trim().toLowerCase();
      if (!email) throw new BadRequestException({ message: 'Email cannot be empty' });

      const existing = await this.adminLoginModel.findOne({
        where: {
          email,
          id: { [Op.ne]: adminId },
        },
      });
      if (existing) {
        throw new BadRequestException({ message: 'Email already in use' });
      }

      (target as any).email = email;
    }

    if (dto.fullName !== undefined) {
      (target as any).fullName = dto.fullName || null;
    }

    if (dto.status !== undefined) {
      (target as any).status = Number(dto.status);
    }

    if (dto.password !== undefined) {
      const passwordHash = await bcrypt.hash(dto.password, 10);
      (target as any).password = passwordHash;
    }

    if (dto.role !== undefined) {
      (target as any).role = dto.role;
    }

    await target.save();

    const after = {
      email: (target as any).email,
      fullName: (target as any).fullName,
      role: (target as any).role,
      status: Number((target as any).status),
    };

    const roleChanged = before.role !== after.role;
    const action = roleChanged && after.role === 'superadmin'
      ? 'ADMIN_ACCOUNT_PROMOTED_TO_SUPERADMIN'
      : 'ADMIN_ACCOUNT_UPDATED';

    await this.adminAuditLogService.log(Number(actor.adminId), action, {
      targetType: 'admin_account',
      targetId: target.id,
      metadata: {
        before,
        after,
        changedFields: Object.keys(after).filter((k) => (before as any)[k] !== (after as any)[k]),
      },
    });

    return {
      message: 'Admin updated successfully',
      admin: this.toAdminResponse(target),
    };
  }

  async deleteAdmin(actor: any, adminId: number) {
    this.assertActorIsSuperadmin(actor);

    if (Number(actor?.adminId) === Number(adminId)) {
      throw new ForbiddenException('You cannot delete your own account');
    }

    const target = await this.adminLoginModel.findByPk(adminId);
    if (!target) throw new NotFoundException('Admin not found');

    if ((target as any).role === 'superadmin') {
      throw new ForbiddenException('You cannot delete a superadmin account');
    }

    const snapshot = {
      email: (target as any).email,
      fullName: (target as any).fullName,
      role: (target as any).role,
      status: Number((target as any).status),
    };

    await target.destroy();

    await this.adminAuditLogService.log(Number(actor.adminId), 'ADMIN_ACCOUNT_DELETED', {
      targetType: 'admin_account',
      targetId: adminId,
      metadata: snapshot,
    });

    return {
      message: 'Admin deleted successfully',
    };
  }
}
