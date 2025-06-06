import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<number[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) throw new ForbiddenException('No user data in request');

    // If no specific roles required, allow access
    if (!requiredRoles || requiredRoles.length === 0) return true;

    // If user role not in allowed roles, deny access
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Access denied: Insufficient permissions');
    }

    return true;
  }
}
