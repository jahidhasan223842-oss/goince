// PM2 config — live server-e `pm2 start ecosystem.config.js` diye chalao.
// Server restart / reboot holeo PM2 nije theke abar chalu korbe (`pm2 startup` ekbar run korte hobe).
module.exports = {
  apps: [{
    name: 'goince',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'production', PORT: 3000 },
    max_restarts: 10,
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
