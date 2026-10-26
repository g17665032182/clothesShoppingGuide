import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../authorization/roles.decorator.js';
import { RolesGuard } from '../authorization/roles.guard.js';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { User, UserRole } from './user.entity.js';
import { UsersService } from './users.service.js';
import type { UserResponse } from './users.service.js';

@Controller('users')
export class UsersController {
  public constructor(private readonly usersService: UsersService) {}

  @Get('me')
  public getMe(@CurrentUser() user: User): UserResponse {
    return this.usersService.toResponse(user);
  }

  @Patch('me')
  public updateMe(
    @CurrentUser() user: User,
    @Body() dto: UpdateProfileDto,
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
  public async getById(@Param('id') id: string): Promise<UserResponse> {
    return this.usersService.toResponse(
      await this.usersService.getRequired(id),
    );
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id')
  public updateByAdmin(
    @Param('id') id: string,
    @Body() dto: AdminUpdateUserDto,
  ): Promise<UserResponse> {
    return this.usersService.updateByAdmin(id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  public disable(@Param('id') id: string): Promise<UserResponse> {
    return this.usersService.disable(id);
  }
}
