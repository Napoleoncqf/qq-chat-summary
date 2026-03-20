module.exports = {
  apps: [{
    name: 'qq-chat-summary',
    script: 'src/index.ts',
    interpreter: 'node_modules/.bin/tsx.cmd',
    cwd: 'D:/QQ_chat_summary',
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
