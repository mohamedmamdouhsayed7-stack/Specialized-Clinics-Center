import { Controller, Post, Body, Get, UseGuards, Request, HttpCode, HttpStatus, Res, Req } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyResetCodeDto } from './dto/verify-reset-code.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { AuthThrottlerGuard } from './guards/auth-throttler.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  private getRefreshCookieOptions(maxAge: number) {
    const secure = process.env.NODE_ENV === 'production' || process.env.FRONTEND_URL?.startsWith('https://') === true;
    return {
      httpOnly: true,
      secure,
      sameSite: secure ? ('none' as const) : ('lax' as const),
      maxAge,
    };
  }

  @Post('login')
  @UseGuards(AuthThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  async login(@Req() req, @Res({ passthrough: true }) res: Response, @Body() loginDto: LoginDto) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const rememberMe = loginDto.rememberMe || false;
    
    const result = await this.authService.login(loginDto, ipAddress, userAgent, rememberMe);

    res.cookie(
      'refreshToken',
      result.refreshToken,
      this.getRefreshCookieOptions(rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000),
    );

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post('register')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async register(@Req() req, @Body() registerDto: RegisterDto) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.authService.register(registerDto, ipAddress, userAgent);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req, @Res({ passthrough: true }) res: Response) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const result = await this.authService.refreshTokens(refreshToken, ipAddress, userAgent);

    res.cookie('refreshToken', result.refreshToken, this.getRefreshCookieOptions(7 * 24 * 60 * 60 * 1000));

    return { 
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req, @Res({ passthrough: true }) res: Response) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const refreshToken = req.cookies?.refreshToken;

    await this.authService.logout(refreshToken, req.user.id, ipAddress, userAgent);

    res.clearCookie('refreshToken');

    return { message: 'Logged out successfully' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getCurrentUser(@Request() req) {
    return req.user;
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(@Request() req, @Body() changePasswordDto: ChangePasswordDto) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.authService.changePassword(
      req.user.id,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
      ipAddress,
      userAgent,
    );
  }

  @Post('forgot-password')
  @UseGuards(AuthThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Req() req, @Body() forgotPasswordDto: ForgotPasswordDto) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.authService.forgotPassword(forgotPasswordDto, ipAddress, userAgent);
  }

  @Post('reset-password')
  @UseGuards(AuthThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Req() req, @Body() resetPasswordDto: ResetPasswordDto) {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.authService.resetPassword(resetPasswordDto, ipAddress, userAgent);
  }

  @Post('verify-reset-code')
  @UseGuards(AuthThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  async verifyResetCode(@Body() verifyResetCodeDto: VerifyResetCodeDto) {
    return this.authService.verifyResetCode(verifyResetCodeDto);
  }
}
