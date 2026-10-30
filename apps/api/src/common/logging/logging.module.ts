import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

type LogLevel =
  'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

type TransportTarget = {
  level: LogLevel;
  target: string;
  options: {
    colorize?: boolean;
    singleLine?: boolean;
    translateTime?: string;
    destination?: number | string;
    mkdir?: boolean;
  };
};

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
        const fileLoggingEnabled = isTruthy(
          config.get<string>('LOG_FILE_ENABLED') ?? 'true',
        );
        const filePath =
          config.get<string>('LOG_FILE_PATH') ?? './logs/app.log';

        const pinoHttp: {
          level: LogLevel;
          redact: {
            paths: string[];
            censor: string;
          };
          transport?: {
            targets: TransportTarget[];
          };
        } = {
          level,
          redact: {
            // 日志中禁止保留可复用的认证凭据。
            paths: ['req.headers.authorization', 'req.headers.cookie'],
            censor: '[REDACTED]',
          },
        };

        const transportTargets: TransportTarget[] = [];

        if (prettyEnabled) {
          transportTargets.push({
            level,
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: true,
              translateTime: 'SYS:standard',
            },
          });
        } else {
          // 未开启可读输出时，仍保留 JSON 日志到标准输出，便于容器采集。
          transportTargets.push({
            level,
            target: 'pino/file',
            options: {
              destination: 1,
            },
          });
        }

        if (fileLoggingEnabled) {
          // 文件只记录需要关注的告警及更高等级，避免普通请求日志持续膨胀。
          transportTargets.push({
            level: 'warn',
            target: 'pino/file',
            options: {
              destination: filePath,
              mkdir: true,
            },
          });
        }

        pinoHttp.transport = { targets: transportTargets };

        return {
          pinoHttp,
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
