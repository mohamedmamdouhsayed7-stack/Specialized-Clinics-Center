import { Controller, Get, Post, Body, UseGuards, Request, Res, Param } from '@nestjs/common';
import { BackupService } from './backup.service';
import { RestoreBackupDto } from './dto/restore-backup.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { Response } from 'express';

// Full database access either way (dump or restore), so Admin-only.
@Controller('backup')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get('status')
  getStatus() {
    return this.backupService.getStatus();
  }

  @Get('list')
  listBackups() {
    return this.backupService.listBackups();
  }

  @Post('run')
  runBackup(@Request() req) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.backupService.runBackup('manual', req.user.id, ipAddress, userAgent);
  }

  @Post('restore')
  restoreBackup(@Request() req, @Body() dto: RestoreBackupDto) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.backupService.restoreBackup(dto.filename, req.user.id, ipAddress, userAgent);
  }

  @Get('export-excel')
  async exportExcel(@Request() req, @Res() res: Response) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const buffer = await this.backupService.exportToExcel(req.user.id, ipAddress, userAgent);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '-');
    const filename = `clinic-data-backup-${dateStr}-${timeStr}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('download/:filename')
  async downloadBackup(@Request() req, @Res() res: Response, @Param('filename') filename: string) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const filepath = await this.backupService.downloadBackup(filename, req.user.id, ipAddress, userAgent);

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(filepath);
  }
}
