import { Controller, Get, Post, Body, Patch, Param, Query, UseGuards, ParseUUIDPipe, Request, Delete } from '@nestjs/common';
import { VisitsService } from './visits.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { UpdateVisitDto } from './dto/update-visit.dto';
import { UpdateVisitStatusDto } from './dto/update-visit-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole, VisitType, VisitStatus } from '@prisma/client';

@Controller('visits')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VisitsController {
  constructor(private readonly visitsService: VisitsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  create(@Request() req, @Body() createVisitDto: CreateVisitDto) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.visitsService.create(createVisitDto, req.user.id, ipAddress, userAgent);
  }

  @Get('today-counts')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  getTodayCounts() {
    return this.visitsService.getTodayCounts();
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  findAll(
    @Query('patientId') patientId?: string,
    @Query('appointmentId') appointmentId?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.visitsService.findAll(
      patientId,
      appointmentId,
      type as VisitType,
      status as VisitStatus,
      from,
      to,
      search,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.visitsService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  update(
    @Request() req,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateVisitDto: UpdateVisitDto,
  ) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.visitsService.update(id, updateVisitDto, req.user.id, ipAddress, userAgent);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  updateStatus(
    @Request() req,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateStatusDto: UpdateVisitStatusDto,
  ) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.visitsService.updateStatus(id, updateStatusDto, req.user.id, ipAddress, userAgent);
  }

  @Delete(':id/permanent')
  @Roles(UserRole.ADMIN)
  hardDelete(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.visitsService.hardDelete(id, req.user.id, ipAddress, userAgent);
  }
}
