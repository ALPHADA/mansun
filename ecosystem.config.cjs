const cwd = __dirname;
module.exports = {
  apps: [
    {
      name: "mansun-market-data",
      cwd,
      script: "node_modules/tsx/dist/cli.mjs",
      args: "scripts/marine-worker.ts",
      env: { NODE_ENV: "production" },
      restart_delay: 10000,
      kill_timeout: 35000,
      time: true,
    },
    {
      name: "mansun-market-web",
      cwd,
      script: "node_modules/next/dist/bin/next",
      args: "start --hostname 127.0.0.1 --port 3005",
      env: { NODE_ENV: "production" },
      max_memory_restart: "600M",
      restart_delay: 3000,
      time: true,
    },
    {
      name: "mansun-market-jobs",
      cwd,
      script: "node_modules/tsx/dist/cli.mjs",
      args: "scripts/worker.ts",
      env: { NODE_ENV: "production" },
      restart_delay: 10000,
      time: true,
    },
    {
      name: "mansun-market-backup",
      cwd,
      script: "node_modules/tsx/dist/cli.mjs",
      args: "scripts/backup.ts",
      env: { NODE_ENV: "production" },
      autorestart: false,
      cron_restart: "0 4 * * *",
      time: true,
    },
  ],
};
