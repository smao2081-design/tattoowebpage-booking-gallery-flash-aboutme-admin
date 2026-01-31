module.exports = {
  apps: [
    {
      name: "upload-server",
      script: "server/server.js",
      env: {
        PORT: 15500,
        NODE_ENV: "production"
      }
    },
    {
      name: "next",
      script: "node_modules/.bin/next",
      args: "start -p 3000",
      env: {
        PORT: 3000,
        NODE_ENV: "production"
      }
    }
  ]
};