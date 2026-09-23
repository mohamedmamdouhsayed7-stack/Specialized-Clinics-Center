import { Controller, Get, Post, Body, Patch, Param, Query, UseGuards, ParseUUIDPipe, Request, Put, Delete } from '@nestjs/common';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('patients')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PatientsController {
  constructor(private patientsService: PatientsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  create(@Request() req, @Body() createPatientDto: CreatePatientDto) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.patientsService.create(createPatientDto, req.user.id, ipAddress, userAgent);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  findAll(
    @Query('search') search?: string,
    @Query('isArchived') isArchived?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const archived = isArchived === 'true' ? true : isArchived === 'false' ? false : undefined;
    return this.patientsService.findAll(search, archived, pageNum, limitNum);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.patientsService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  update(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() updatePatientDto: UpdatePatientDto) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.patientsService.update(id, updatePatientDto, req.user.id, ipAddress, userAgent);
  }

  @Put(':id/archive')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  archive(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.patientsService.archive(id, req.user.id, ipAddress, userAgent);
  }

  @Put(':id/restore')
  @Roles(UserRole.ADMIN)
  restore(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.patientsService.restore(id, req.user.id, ipAddress, userAgent);
  }

  @Delete(':id/permanent')
  @Roles(UserRole.ADMIN)
  hardDelete(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.patientsService.hardDelete(id, req.user.id, ipAddress, userAgent);
  }
}
