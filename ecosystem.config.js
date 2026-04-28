// ecosystem.config.js
// PM2 process manager config — keeps the server running 24/7 on a VPS.
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 logs tcg-tracker
//   pm2 restart tcg-tracker

module.exports = {
  apps: [
    {
      name: 'tcg-tracker',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      // Restart if it crashes, with exponential backoff
      exp_backoff_restart_delay: 100,
      // Log files
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
