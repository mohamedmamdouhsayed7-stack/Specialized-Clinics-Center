import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PatientsModule } from './patients/patients.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { VisitsModule } from './visits/visits.module';
import { ServicesModule } from './services/services.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PaymentsModule } from './payments/payments.module';
import { ReportsModule } from './reports/reports.module';
import { BackupModule } from './backup/backup.module';
import { MaintenanceModule } from './common/maintenance/maintenance.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MaintenanceModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: (config) => {
        const requiredEnvVars = [
          'NODE_ENV',
          'PORT',
          'DATABASE_URL',
          'JWT_SECRET',
          'JWT_REFRESH_SECRET',
        ];

        // FRONTEND_URL is required in production to prevent CORS fallback to localhost
        if (config.NODE_ENV === 'production') {
          requiredEnvVars.push('FRONTEND_URL', 'BACKUP_ENCRYPTION_KEY');
        }

        const missingEnvVars = requiredEnvVars.filter((envVar) => !config[envVar]);

        if (missingEnvVars.length > 0) {
          throw new Error(
            `Missing required environment variables: ${missingEnvVars.join(', ')}`,
          );
        }

        if (
          config.NODE_ENV === 'production' &&
          (!config.FRONTEND_URL.startsWith('https://') ||
            /localhost|127\.0\.0\.1/i.test(config.FRONTEND_URL))
        ) {
          throw new Error('FRONTEND_URL must be a public HTTPS origin in production');
        }

        return {
          ...config,
          NODE_ENV: config.NODE_ENV,
          PORT: parseInt(config.PORT, 10),
          DATABASE_URL: config.DATABASE_URL,
          JWT_SECRET: config.JWT_SECRET,
          JWT_REFRESH_SECRET: config.JWT_REFRESH_SECRET,
          FRONTEND_URL: config.FRONTEND_URL,
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const ttlSeconds = Number(configService.get<number>('AUTH_LOGIN_THROTTLE_TTL', 60));
        const limit = Number(configService.get<number>('AUTH_LOGIN_THROTTLE_LIMIT', 10));
        const ttlMs = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds * 1000 : 60000;

        return [{
          ttl: ttlMs,
          limit: Number.isFinite(limit) && limit > 0 ? limit : 10,
        }];
      },
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    UsersModule,
    PatientsModule,
    AppointmentsModule,
    VisitsModule,
    ServicesModule,
    InvoicesModule,
    PaymentsModule,
    ReportsModule,
    BackupModule,
  ],
})
export class AppModule {}
