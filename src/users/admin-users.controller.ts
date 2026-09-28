import { Controller, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { UserRole } from '@prisma/client';
import { ListUsersQuery } from './dto/list-users.query';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';
import { AdminUserResponse } from './user.mapper';
import { PaginatedResult } from '../common/pagination.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async listUsers(@Query() query: ListUsersQuery): Promise<PaginatedResult<AdminUserResponse>> {
    return this.usersService.listUsers(query);
  }

  @Get(':id')
  async getUser(@Param('id') id: string): Promise<AdminUserResponse> {
    return this.usersService.getUserById(id);
  }

  @Patch(':id')
  async updateUser(
    @Param('id') id: string,
    @Body() dto: AdminUpdateUserDto,
  ): Promise<AdminUserResponse> {
    return this.usersService.adminUpdateUser(id, dto);
  }
}
