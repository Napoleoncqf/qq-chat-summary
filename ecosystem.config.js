module.exports = {
  apps: [{
    name: 'qq-chat-summary',
    script: 'src/index.ts',
    interpreter: 'node',
    interpreter_args: '--import tsx',
    cwd: __dirname,
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
