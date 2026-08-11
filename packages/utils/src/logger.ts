export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  constructor(private context: string = 'aione') {}

  log(level: LogLevel, message: string, data?: Record<string, any>) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] ${level.toUpperCase()} [${this.context}]`;
    const payload = data ? ` ${JSON.stringify(data)}` : '';
    console.log(`${prefix} ${message}${payload}`);
  }

  debug(message: string, data?: Record<string, any>) {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, any>) {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, any>) {
    this.log('warn', message, data);
  }

  error(message: string, error?: Error | Record<string, any>) {
    if (error instanceof Error) {
      this.log('error', message, { message: error.message, stack: error.stack });
    } else {
      this.log('error', message, error);
    }
  }
}

export function createLogger(context?: string): Logger {
  return new Logger(context);
}
