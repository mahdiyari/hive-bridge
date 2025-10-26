// Function by me but colors by AI ;P
export const logger = {
  info: (...args: any[]) => {
    console.log('\x1b[34m[INFO]:\x1b[0m', ...args) // Blue
  },
  debug: (...args: any[]) => {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log('\x1b[36m[DEBUG]:\x1b[0m', ...args) // Cyan
    }
  },
  warning: (...args: any[]) => {
    console.log('\x1b[33m[WARNING]:\x1b[0m', ...args) // Yellow
  },
  error: (...args: any[]) => {
    console.log('\x1b[31m[ERROR]:\x1b[0m', ...args) // Red
  },
}
