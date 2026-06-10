module.exports = {
  apps: [
    {
      name: 'icebreaker-backend',
      cwd: './backend',
      script: 'node_modules/ts-node-dev/lib/bin.js',
      args: '--respawn --transpile-only src/index.ts',
      interpreter: 'node',
      env: {
        NODE_ENV: 'development',
        PORT: '3200'
      }
    },
    {
      name: 'icebreaker-frontend',
      cwd: './frontend',
      script: 'node_modules/.bin/vite',
      args: '--port 5300',
      interpreter: 'node'
    }
  ]
}
