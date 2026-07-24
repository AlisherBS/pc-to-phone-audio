# 🎵 WebRTC Audio Streamer

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Docker Image](https://img.shields.io/badge/Docker-Ready-blue?logo=docker)](Dockerfile)
[![Node.js](https://img.shields.io/badge/Node.js-v16%2B-green.svg)](https://nodejs.org)
[![WebRTC](https://img.shields.io/badge/WebRTC-Opus%20Codec-orange.svg)](https://webrtc.org)

**WebRTC Audio Streamer** — это открытое веб-приложение с ультра-низкой задержкой (Ultra-low latency), позволяющее транслировать системный звук с вашего компьютера (Windows, macOS, Linux) на смартфон, планшет или другой ПК через любой современный браузер. Не требует установки мобильных приложений!

[English Documentation](#english-version) | [Документация на русском](#russian-version)

---

<a name="russian-version"></a>
## 🇷🇺 Русская версия

### 🚀 Возможности
- 🎧 **Трансляция звука без задержки**: Использование протокола WebRTC и кодека Opus для передачи звука в реальном времени.
- 📱 **Без установки приложений**: Работает во всех браузерах (Safari, Chrome, Firefox, Edge, Kiwi, Orion).
- 🧩 **Расширение для Chrome**: Включает исходный код браузерного расширения для захвата системного звука и вкладки.
- 🔐 **Комнаты и безопасность**: Поддержка приватных комнат с паролем, токенов авторизации (JWT) и лимитирования запросов.
- 🔄 **Relay / TURN сервер**: Автоматическая генерация временных REST-учетных данных для Coturn при P2P блокировках/NAT.
- 🐳 **Docker & Docker Compose**: Готов к мгновенному разворачиванию в любом облаке или на домашнем сервере.
- 🌍 **Мультиязычность**: Поддержка интерфейсов на русском, английском и китайском языках (i18n).

---

### 📂 Структура репозитория
```text
webrtc-audio-streamer/
├── client/              # Frontend веб-приложение (HTML5, JS, CSS, PWA, аудио-плеер)
├── server/              # Backend (Node.js, Express, WebSockets, Redis, SQLite)
│   ├── .env.example     # Шаблон конфигурации переменных окружения
│   └── server.js        # Точка входа бэкенд сервера
├── extension/           # Исходный код Chrome Extension для захвата системного звука
├── docker-compose.yml   # Скрипт для быстрого запуска связки Приложение + Redis
├── Dockerfile           # Многоэтапный контейнер Node.js (Alpine)
├── .github/workflows/   # Автоматическая сборка и публикация образа в Docker Hub
└── LICENSE              # Лицензия GNU Affero General Public License v3.0 (AGPL-3.0)
```

---

### 🛠️ Варианты запуска

#### Вариант 1. Запуск через Docker Compose (Рекомендуемый)
Для локального разворачивания сервера сигнализации и базы Redis:

```bash
# 1. Клонируйте репозиторий
git clone https://github.com/YOUR_USERNAME/webrtc-audio-streamer.git
cd webrtc-audio-streamer

# 2. Запустите в Docker Compose
docker compose up -d
```
После запуска сервис будет доступен по адресу: `http://localhost:8080`

---

#### Вариант 2. Быстрый запуск из Docker Hub
Если вы скачиваете собранный образ:

```bash
docker run -d \
  --name webrtc-audio-streamer \
  -p 8080:8080 \
  -e JWT_SECRET="your_custom_jwt_secret" \
  -e ADMIN_PASSWORD="your_admin_password" \
  YOUR_DOCKERHUB_USERNAME/webrtc-audio-streamer:latest
```

---

#### Вариант 3. Ручной запуск (Node.js)

**Требования**: Node.js >= 16.x, Redis (опционально, локально или в облаке)

```bash
# 1. Перейдите в папку сервера
cd server

# 2. Установите зависимости
npm install

# 3. Скопируйте и настройте конфигурационный файл .env
cp .env.example .env

# 4. Запустите сервер
npm start
# или в режиме разработки с автоперезапуском:
npm run dev
```

---

### 🧩 Установка Расширения для Chrome (`extension/`)
1. Откройте браузер Chrome или Edge и перейдите на страницу `chrome://extensions/`.
2. Включите **Режим разработчика** (Developer mode) в правом верхнем углу.
3. Нажмите кнопку **Загрузить распакованное расширение** (Load unpacked).
4. Выберите папку `extension/` из этого репозитория.

---

### ⚙️ Переменные окружения (`server/.env.example`)

| Переменная | Описание | Значение по умолчанию |
| :--- | :--- | :--- |
| `PORT` | Порт HTTP и WebSocket сервера | `8080` |
| `NODE_ENV` | Режим работы (`production` / `development`) | `production` |
| `CLIENT_DIR` | Относительный путь к клиентской статике | `../client` |
| `JWT_SECRET` | Секретный ключ для подписи JWT токенов | *Обязательно смените* |
| `ADMIN_PASSWORD` | Пароль администратора | *Обязательно смените* |
| `REDIS_URL` | Адрес подключения к Redis | `redis://localhost:6379` |
| `TURN_URL` | Адрес сервера STUN/TURN | `turn:your-turn-server.com:3478` |
| `TURN_SECRET` | Shared Secret для интеграции с Coturn | *Опционально* |

---

### 🚢 Публикация образов в Docker Hub через GitHub Actions
Репозиторий включает готовый сценарий CI/CD в файле `.github/workflows/docker-publish.yml`.
Чтобы включить автосборку образов в ваш Docker Hub:
1. Перейдите в настройки репозитория на GitHub: **Settings -> Secrets and variables -> Actions**.
2. Добавьте секреты:
   - `DOCKERHUB_USERNAME` — ваше имя пользователя на Docker Hub.
   - `DOCKERHUB_TOKEN` — персональный токен доступа (Personal Access Token) с правами записи.
3. При каждом коммите в ветку `main` или создании релиз-тега `v*.*.*` GitHub Actions автоматически соберет образ под платформы `amd64` и `arm64` и опубликует его в ваш Docker Hub.

---

<a name="english-version"></a>
## 🇬🇧 English Version

### 🚀 Overview
**WebRTC Audio Streamer** is an open-source, ultra-low latency system audio mirroring platform. It allows streaming full PC system audio (games, music, VDI/Citrix remote desktops) directly to mobile devices or secondary computers via WebRTC and the Opus codec. Zero app installation required!

### 🛠️ Quick Start with Docker Compose
```bash
git clone https://github.com/YOUR_USERNAME/webrtc-audio-streamer.git
cd webrtc-audio-streamer
docker compose up -d
```
Access the application at `http://localhost:8080`.

### 📄 License / Лицензия
Этот проект распространяется под открытой лицензией **GNU Affero General Public License v3.0 (AGPL-3.0)**.
Подробную информацию см. в файле [LICENSE](LICENSE).
