![rex1337 (rep4rep script) Logo](./images/logo.png)

# rex1337 (rep4rep script)

[![Docker](https://img.shields.io/badge/Docker-ready-blue.svg)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An automated tool for farming points on [rep4rep.com](https://rep4rep.com) by posting comments on Steam profiles. Optimized for performance, server deployment, and HomeLab enthusiasts.

---

## ✨ Features

- 🔄 **Infinite Loop**: Automatically manages Steam cooldowns (24h) and daily limits (10 comments/day).
- 📊 **Web Dashboard**: Built-in status page and JSON API for monitoring (default port `1337`).
- 🐳 **Docker Optimized**: Ultra-lightweight Alpine-based image.
- 🔐 **Secure**: Automatic 2FA support via `sharedSecret`.
- 📝 **Structured Logging**: Daily rotating logs to prevent disk bloat.
- 🔔 **Telegram Notifications**: Supports periodic summaries and critical alerts.

---

## 🚀 Quick Start (Deploy from Source)

The most efficient way to deploy **rex1337** is using `docker-compose`. This method allows you to easily update the code and keep your data safe.

### 1. Clone or Upload Files

Clone this repository directly to your server or upload the files via SFTP:

```bash
git clone https://github.com/YOUR_LOGIN/rex1337.git
cd rex1337
```

### 2. Configure Settings

1. **Environment**: Open `docker-compose.yml` and add your `REP4REP_KEY` in the `environment` section.
2. **Accounts**: Edit `accounts.json` and add your Steam credentials.

### 3. Launch & Build

Since you are using the source code, Docker will build the image locally on your server:

```bash
docker-compose up -d --build
```

Access your dashboard at `http://your-server-ip:1337`.

### 🔄 How to Update

- **If you change `accounts.json` or environment vars**:
  ```bash
  docker-compose restart
  ```
- **If you update the script code (`.js` files)**:
  ```bash
  docker-compose up -d --build
  ```

---

## ⚙️ Configuration (environment)

You can configure these variables directly in your `docker-compose.yml`:

| Variable               | Description                           | Default    |
| ---------------------- | ------------------------------------- | ---------- |
| `REP4REP_KEY`          | Your Rep4Rep API Key                  | (Required) |
| `MIN_COMMENT_DELAY`    | Min delay between comments (sec)      | `60`       |
| `MAX_COMMENT_DELAY`    | Max delay between comments (sec)      | `300`      |
| `ACCOUNT_SWITCH_DELAY` | Delay before switching accounts (sec) | `30`       |
| `TELEGRAM_TOKEN`       | Telegram Bot Token                    | (Optional) |
| `PORT`                 | Dashboard/API Port                    | `1337`     |

---

## 👨‍💻 Monitoring & API

- **Dashboard**: `http://localhost:1337`
- **JSON Status**: `http://localhost:1337/api/status`
- **Health Check**: `http://localhost:1337/health`

---

## ⚖️ License

Distributed under the MIT License. See `LICENSE` for more information.

_Disclaimer: This tool is for educational purposes. Use it at your own risk and according to the terms of service of the respective platforms._
