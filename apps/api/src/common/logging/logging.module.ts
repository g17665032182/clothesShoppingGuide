import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

type LogLevel =
  'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

const logLevels = new Set<LogLevel>([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
]);

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get<string>('NODE_ENV') === 'production';
        const configuredLevel = config.get<string>('LOG_LEVEL');
        const level: LogLevel = logLevels.has(configuredLevel as LogLevel)
          ? (configuredLevel as LogLevel)
          : isProduction
            ? 'info'
            : 'debug';
        const prettyEnabled =
          config.get<string>('LOG_PRETTY') === undefined
            ? !isProduction
            : isTruthy(config.get<string>('LOG_PRETTY'));

        const pinoHttp: {
          level: LogLevel;
          redact: {
            paths: string[];
            censor: string;
          };
          transport?: {
            target: string;
            options: {
              colorize: boolean;
              singleLine: boolean;
              translateTime: string;
            };
          };
        } = {
          level,
          redact: {
            // 日志中禁止保留可复用的认证凭据。
            paths: ['req.headers.authorization', 'req.headers.cookie'],
            censor: '[REDACTED]',
          },
        };

        if (prettyEnabled) {
          pinoHttp.transport = {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: true,
              translateTime: 'SYS:standard',
            },
          };
        }

        return {
          pinoHttp,
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
