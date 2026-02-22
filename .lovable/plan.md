
# Relay Terminal Cloud — Implementation Plan

## Overview
A production-ready SaaS web app for securely accessing terminals on remote machines via a cloud relay. We'll build the complete web application with Lovable Cloud (Supabase), with the terminal UI using xterm.js ready to connect to a real relay backend later.

---

## 1. Authentication & User Management
- Email + password signup/login with password reset flow
- Google OAuth sign-in
- Session persistence across browser sessions
- User profiles table (display name, avatar)
- Dark mode as default theme

## 2. Team & Role System
- User roles table (owner, member) per project
- Project owners can invite team members via email
- Members can view devices and start sessions; owners can manage devices and members
- Role-based access enforced via RLS policies

## 3. Projects
- Create, rename, and delete projects
- Each project scopes its own devices, sessions, and team members
- Project dashboard showing device count, active sessions, and recent activity

## 4. Device Management
- Add devices to a project with a name
- Generate a one-time pairing code per device
- Display device status (online/offline) with last-seen timestamp
- Device list view with status indicators and quick actions
- Edge function: `POST /pair-device` — validates pairing code and marks device as paired

## 5. Pairing Flow
- User creates a device → receives a pairing code to use on their local connector
- Edge function accepts pairing code + device token, links the connector to the device record
- Once paired, device status updates to reflect connection state

## 6. Sessions & Session Manager
- Start/end session records tied to a device
- Track session_id, device_id, user_id, status (active/ended), started_at, ended_at
- Session history view with filtering by device and date
- Edge functions: `POST /start-session`, `POST /end-session`, `GET /sessions`

## 7. Terminal UI (xterm.js)
- Full-screen dark terminal emulator using xterm.js
- Supports stdin input, stdout display, and scrollback buffer
- WebSocket connection stub — ready to plug into a real relay backend
- Session reconnect logic (detects disconnect, offers reconnect button)
- Fits the modern developer SaaS aesthetic

## 8. Dashboard
- Overview page showing: online devices count, active sessions, recent session history
- Quick-launch buttons to open terminal on online devices
- Real-time status indicators for device connectivity

## 9. API Layer (Edge Functions)
- `POST /pair-device` — pair a connector using a code
- `POST /start-session` — create a new terminal session
- `POST /end-session` — close a session
- `GET /devices` — list devices for a project
- `GET /sessions` — list sessions with filters
- All endpoints authenticated via Supabase JWT

## 10. Real-time Features
- Supabase Realtime subscriptions for device status changes (online/offline)
- Live session status updates on the dashboard
- Terminal streaming will use WebSocket once relay backend is connected

## 11. UI Pages & Navigation
- **Login / Signup** — clean auth pages with Google OAuth button
- **Dashboard** — project overview with stats and quick actions
- **Project View** — devices, sessions, and team members tabs
- **Device List** — status indicators, pairing codes, actions
- **Terminal Session Page** — full xterm.js terminal with connection status
- Sidebar navigation with project switcher

## 12. Branding & Design
- Dark mode default with clean developer SaaS aesthetic
- Monospace fonts for terminal elements
- Status indicators: green (online/active), gray (offline), amber (connecting)
- Minimal, professional UI with consistent spacing and typography
