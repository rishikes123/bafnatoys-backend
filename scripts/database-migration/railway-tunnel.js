"use strict";

const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");

// Keep credentials inside this process and an ignored local .env file. Never print CLI variable output.
const cli = path.join(process.env.APPDATA || "", "npm/node_modules/@railway/cli/bin/railway.js");
if (!fs.existsSync(cli)) throw new Error("Railway CLI entry point was not found");
const service = process.argv[2] || "Postgres";
const port = Number(process.env.MIGRATION_TUNNEL_PORT || 55439);
const variables = spawnSync(process.execPath, [cli, "variable", "list", "--service", service, "--json"], { encoding: "utf8", windowsHide: true });
if (variables.status !== 0) throw new Error("Unable to read the selected Railway database variables");
const values = JSON.parse(variables.stdout);
if (!values.PGUSER || !values.PGPASSWORD || !values.PGDATABASE) throw new Error("Selected service is not PostgreSQL");
const uri = new URL("postgresql://127.0.0.1/");
uri.port = String(port); uri.username = values.PGUSER; uri.password = values.PGPASSWORD;
uri.pathname = `/${values.PGDATABASE}`;
const localFile = path.resolve(".env.pg-migration");
fs.writeFileSync(localFile, `DATABASE_URL=${JSON.stringify(uri.toString())}\n`, { mode: 0o600 });
const child = spawn(process.execPath, [cli, "connect", service, "--tunnel-only", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let ready = false;
let diagnostics = "";
const timer = setInterval(() => {
  const socket = net.connect({ host: "127.0.0.1", port });
  socket.once("connect", () => { socket.destroy(); if (!ready) { ready = true; console.log("Private Railway PostgreSQL tunnel ready; credentials saved in ignored .env.pg-migration"); } });
  socket.on("error", () => socket.destroy());
}, 1000);
// Drain both streams without exposing connection strings or passwords.
child.stdout.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-12000); });
child.stderr.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-12000); });
child.on("exit", code => {
  clearInterval(timer);
  console.log(`Private tunnel closed (code ${code ?? "signal"})`);
  if (code) {
    for (const value of Object.values(values)) {
      if (typeof value === "string" && value.length >= 6) diagnostics = diagnostics.split(value).join("[redacted]");
    }
    console.log(diagnostics.replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[database URL redacted]"));
  }
  process.exitCode = code || 0;
});
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
console.log("Opening private PostgreSQL tunnel; public database access stays disabled");
