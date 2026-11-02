import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import { Roles } from '../../authorization/decorator/roles.decorator.js';
import { RolesGuard } from '../../authorization/guard/roles.guard.js';
import {
  AdminUpdateUserDto,
  adminUpdateUserSchema,
} from '../dto/admin-update-user.dto.js';
import {
  UpdateProfileDto,
  updateProfileSchema,
} from '../dto/update-profile.dto.js';
import { User, UserRole } from '../entity/user.entity.js';
import { UsersService } from '../service/users.service.js';
import type { UserResponse } from '../service/users.service.js';
import { userIdSchema } from '../dto/user-id.dto.js';

@Controller('users')
@ApiBearerAuth('bearer')
@ApiTags('用户')
export class UsersController {
  public constructor(private readonly usersService: UsersService) {}

  @Get('me')
  public getMe(@CurrentUser() user: User): UserResponse {
    return this.usersService.toResponse(user);
  }

  @Patch('me')
  public updateMe(
    @CurrentUser() user: User,
    @Body({ schema: updateProfileSchema }) dto: UpdateProfileDto,
  ): Promise<UserResponse> {
    return this.usersService.updateProfile(user, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get()
  public list(): Promise<UserResponse[]> {
    return this.usersService.list();
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get(':id')
  public async getById(
    @Param('id', { schema: userIdSchema }) id: string,
  ): Promise<UserResponse> {
    return this.usersService.toResponse(
      await this.usersService.getRequired(id),
    );
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id')
  public updateByAdmin(
    @Param('id', { schema: userIdSchema }) id: string,
    @Body({ schema: adminUpdateUserSchema }) dto: AdminUpdateUserDto,
  ): Promise<UserResponse> {
    return this.usersService.updateByAdmin(id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  public disable(
    @Param('id', { schema: userIdSchema }) id: string,
  ): Promise<UserResponse> {
    return this.usersService.disable(id);
  }
}
