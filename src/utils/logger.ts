const timestamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export const logger = {
  info: (module: string, msg: string) => console.log(`[${timestamp()}] [INFO] [${module}] ${msg}`),
  warn: (module: string, msg: string) => console.warn(`[${timestamp()}] [WARN] [${module}] ${msg}`),
  error: (module: string, msg: string, err?: unknown) => {
    console.error(`[${timestamp()}] [ERROR] [${module}] ${msg}`);
    if (err) {
      if (err instanceof Error) {
        console.error(`  ${err.name}: ${err.message}`);
        if (err.stack) {
          const stackLines = err.stack.split('\n').slice(1, 4).join('\n');
          console.error(stackLines);
        }
      } else {
        console.error(`  ${String(err)}`);
      }
    }
  },
  debug: (module: string, msg: string) => {
    if (process.env.DEBUG) console.log(`[${timestamp()}] [DEBUG] [${module}] ${msg}`);
  },
};
