module.exports = {
  apps: [
    {
      name: 'lh-discord',
      cwd: __dirname,
      script: 'dist/src/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      wait_ready: true,
      listen_timeout: 30000,
      watch: false,
      max_memory_restart: '256M',
      kill_timeout: 10000,
      time: true,
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
