import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ADMIN_ROLES_KEY, AdminRole } from './admin-roles.decorator';

@Injectable()
export class AdminRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(
      ADMIN_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) throw new ForbiddenException('No admin data in request');

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const role = user.role as AdminRole | undefined;
    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException('Access denied: Insufficient permissions');
    }

    return true;
  }
}
