# Relay Terminal Cloud — WebSocket Relay Server

A stateful WebSocket relay that bridges browser terminal sessions to Go connectors.

## Architecture

```
Browser (xterm.js) ←→ WSS Relay ←→ Go Connector ←→ Local PTY
```

## How it works

1. **Connectors** connect to `wss://relay.yourapp.com/connect`, send `hello` with device credentials
2. **Browsers** connect to `wss://relay.yourapp.com/session`, send `auth` with Supabase JWT + session ID
3. The relay routes messages between matched browser↔connector pairs

## Deploy to Fly.io

```bash
cd relay-server
npm install

# Install Fly CLI: https://fly.io/docs/getting-started/installing-flyctl/
fly auth login
fly launch --name relay-terminal-cloud
fly secrets set SUPABASE_URL=https://psmglvwvoygaadjajvoq.supabase.co
fly secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
fly deploy
```

Your relay URL will be: `wss://relay-terminal-cloud.fly.dev`

## Local development

```bash
cd relay-server
cp .env.example .env
# Fill in your Supabase credentials
npm install
npm run dev
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 8080) |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for device auth |

## Message Protocol

See `PROTOCOL.md` for the complete message specification.
