import { Controller, Get, Post, Body, Patch, Delete, Param, UseGuards, ParseUUIDPipe, Request } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  create(@Request() req, @Body() createUserDto: CreateUserDto) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.usersService.create(createUserDto, req.user.id, ipAddress, userAgent);
  }

  @Patch(':id')
  update(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() updateUserDto: UpdateUserDto) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.usersService.update(id, updateUserDto, req.user.id, ipAddress, userAgent);
  }

  @Patch(':id/status')
  updateStatus(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body('isActive') isActive: boolean) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.usersService.updateStatus(id, isActive, req.user.id, ipAddress, userAgent);
  }

  @Patch(':id/password')
  updatePassword(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body('newPassword') newPassword: string) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.usersService.updatePassword(id, newPassword, req.user.id, ipAddress, userAgent);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.usersService.remove(id, req.user.id, ipAddress, userAgent);
  }
}
