import { Controller, Get, Post, Body, Patch, Param, Query, UseGuards, ParseUUIDPipe, Request, HttpCode, Res, Delete } from '@nestjs/common';
import { Response } from 'express';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceStatusDto } from './dto/update-invoice-status.dto';
import { AddChargeDto } from './dto/add-charge.dto';
import { CreateReplacementDto } from './dto/create-replacement.dto';
import { FindInvoicesDto } from './dto/find-invoices.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole, InvoiceStatus } from '@prisma/client';
import { createInvoiceContentDisposition, createInvoiceFilename } from './invoice-filename';

@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  create(@Request() req, @Body() createInvoiceDto: CreateInvoiceDto) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.invoicesService.create(createInvoiceDto, req.user.id, ipAddress, userAgent);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  findAll(
    @Query() query: FindInvoicesDto,
  ) {
    return this.invoicesService.findAll(
      query.patientId,
      query.status as InvoiceStatus,
      query.page,
      query.limit,
      query.search,
    );
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.findOne(id);
  }

  @Get(':id/pdf')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('lang') lang: string | undefined,
    @Res() res: Response,
  ) {
    const language = lang === 'ar' ? 'ar' : 'en';
    const { buffer: pdfBuffer, patientName, invoiceNumber } = await this.invoicePdfService.generate(id, language, { copies: 2 });
    const filename = createInvoiceFilename(patientName, invoiceNumber);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': createInvoiceContentDisposition(filename),
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  @Get(':id/pdf/share')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  async sharePdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('lang') lang: string | undefined,
    @Res() res: Response,
  ) {
    const language = lang === 'ar' ? 'ar' : 'en';
    const { buffer: pdfBuffer, patientName, invoiceNumber } = await this.invoicePdfService.generate(id, language, { copies: 1 });
    const filename = createInvoiceFilename(patientName, invoiceNumber);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': createInvoiceContentDisposition(filename),
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  @Delete(':id/permanent')
  @Roles(UserRole.ADMIN)
  hardDelete(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.invoicesService.hardDelete(id, req.user.id, req.user.role, ipAddress, userAgent);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  updateStatus(
    @Request() req,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateStatusDto: UpdateInvoiceStatusDto,
  ) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.invoicesService.updateStatus(id, updateStatusDto, req.user.id, req.user.role, ipAddress, userAgent);
  }

  @Post(':id/charges')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  @HttpCode(201)
  addCharge(
    @Request() req,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() addChargeDto: AddChargeDto,
  ) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.invoicesService.addCharge(id, addChargeDto, req.user.id, req.user.role, ipAddress, userAgent);
  }

  @Post(':id/replacement')
  @Roles(UserRole.ADMIN)
  createReplacement(
    @Request() req,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() createReplacementDto: CreateReplacementDto,
  ) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.invoicesService.createReplacement(id, createReplacementDto, req.user.id, req.user.role, ipAddress, userAgent);
  }
}
