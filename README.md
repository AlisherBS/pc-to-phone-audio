# 🎵 PC to Phone Audio (WebRTC Audio Streamer)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Docker Image](https://img.shields.io/badge/Docker-Ready-blue?logo=docker)](Dockerfile)
[![Node.js](https://img.shields.io/badge/Node.js-v16%2B-green.svg)](https://nodejs.org)
[![WebRTC](https://img.shields.io/badge/WebRTC-Opus%20Codec-orange.svg)](https://webrtc.org)

**PC to Phone Audio** — компьютердегі (Windows, macOS, Linux) жүйелік дыбысты смартфонға, планшетке немесе басқа ПК-ге веб-браузер арқылы ультра-төмен кідіріспен (Ultra-low latency) трансляциялауға арналған ашық бастапқы коды бар веб-қосымша. Мобильді қосымшаларды орнатуды талап етпейді!

[🇰🇿 Қазақша](#kazakh-version) | [🇬🇧 English](#english-version) | [🇷🇺 Русский](#russian-version)

---

<a name="kazakh-version"></a>
## 🇰🇿 Қазақша нұсқасы

### 🚀 Мүмкіндіктері
- 🎧 **Дыбысты кідіріссіз тарату**: Нақты уақыт режимінде дыбысты жіберу үшін WebRTC протоколы мен Opus кодегін пайдалану.
- 📱 **Қосымшасыз жұмыс**: Барлық заманауи браузерлерде жұмыс істейді (Safari, Chrome, Firefox, Edge, Kiwi, Orion).
- 🧩 **Chrome кеңейтімі**: Жүйелік дыбысты және қойындыны түсіруге арналған браузер кеңейтімінің бастапқы коды енгізілген (`extension/`).
- 🔐 **Бөлмелер және қауіпсіздік**: Құпия сөзі бар жеке бөлмелерді, авторизация токендерін (JWT) және сұрауларды шектеуді қолдау.
- 🔄 **Relay / TURN сервері**: P2P бұғаттаулар/NAT кезінде Coturn үшін уақытша REST тіркелгі деректерін автоматты түрде жасау.
- 🐳 **Docker & Docker Compose**: Кез келген бұлтта немесе үй серверінде лезде орналастыруға дайын.
- 🌍 **Көптілділік**: Қазақ, ағылшын және орыс тілдеріндегі интерфейстар.

---

### 📂 Репозиторий құрылымы
```text
pc-to-phone-audio/
├── client/              # Frontend веб-қосымшасы (HTML5, JS, CSS, PWA, аудио-плеер)
├── server/              # Backend (Node.js, Express, WebSockets, Redis, SQLite)
│   ├── .env.example     # Орта айнымалыларының баптау шаблоны
│   └── server.js        # Бэкенд серверінің кіру нүктесі
├── extension/           # Chrome кеңейтімінің бастапқы коды
├── docker-compose.yml   # Қосымша + Redis жұбын жылдам іске қосу
├── Dockerfile           # Көпбаспалдақты Node.js (Alpine) контейнері
├── .github/workflows/   # Docker Hub-қа бейнені автоматты жинау және жариялау
└── LICENSE              # GNU Affero General Public License v3.0 (AGPL-3.0) лицензиясы
```

---

### 🛠️ Іске қосу нұсқаулары

#### 1-нұсқа. Docker Compose арқылы іске қосу (Ұсынылады)
```bash
# 1. Репозиторийді клондаңыз
git clone https://github.com/AlisherBS/pc-to-phone-audio.git
cd pc-to-phone-audio

# 2. Docker Compose арқылы іске қосыңыз
docker compose up -d
```
Іске қосылғаннан кейін сервис мына мекенжай бойынша қолжетімді болады: `http://localhost:8080`

---

#### 2-нұсқа. Docker Hub-тан жылдам іске қосу
```bash
docker run -d \
  --name pc-to-phone-audio \
  -p 8080:8080 \
  -e JWT_SECRET="your_custom_jwt_secret" \
  -e ADMIN_PASSWORD="your_admin_password" \
  alisherbs/pc-to-phone-audio:latest
```

---

#### 3-нұсқа. Қолмен іске қосу (Node.js)
**Талаптар**: Node.js >= 16.x, Redis (қосымша)

```bash
# 1. Сервер папкасына өтіңіз
cd server

# 2. Тәуелділіктерді орнатыңыз
npm install

# 3. .env.example файлын .env ретінде көшіріп баптаңыз
cp .env.example .env

# 4. Серверді іске қосыңыз
npm start
```

---

### 🧩 Chrome кеңейтімін орнату (`extension/`)
1. Chrome немесе Edge браузерін ашып, `chrome://extensions/` бетіне өтіңіз.
2. Жоғарғы оң жақтағы **Әзірлеуші режимін** (Developer mode) қосыңыз.
3. **Распаковкаланған кеңейтімді жүктеу** (Load unpacked) түймесін басыңыз.
4. Осы репозиторийден `extension/` папкасын таңдаңыз.

---

---

<a name="english-version"></a>
## 🇬🇧 English Version

### 🚀 Overview
**PC to Phone Audio** is an open-source, ultra-low latency system audio mirroring platform. It allows streaming full computer system audio (movies, games, remote desktop audio) directly to mobile phones, tablets, or secondary PCs via WebRTC and the Opus codec. Zero app installation required!

---

### 📂 Repository Structure
```text
pc-to-phone-audio/
├── client/              # Frontend web application (HTML5, JS, CSS, PWA, Audio Player)
├── server/              # Backend (Node.js, Express, WebSockets, Redis, SQLite)
│   ├── .env.example     # Environment variables configuration template
│   └── server.js        # Backend entry point
├── extension/           # Chrome Extension source code for tab/system audio capture
├── docker-compose.yml   # App + Redis stack definition
├── Dockerfile           # Multi-stage Node.js Alpine container
├── .github/workflows/   # Docker Hub auto-build & publish pipeline
└── LICENSE              # GNU Affero General Public License v3.0 (AGPL-3.0)
```

---

### 🛠️ Quick Start

#### Option 1. Docker Compose (Recommended)
```bash
git clone https://github.com/AlisherBS/pc-to-phone-audio.git
cd pc-to-phone-audio
docker compose up -d
```
Access the application at `http://localhost:8080`.

---

#### Option 2. Fast Start from Docker Hub
```bash
docker run -d \
  --name pc-to-phone-audio \
  -p 8080:8080 \
  -e JWT_SECRET="your_custom_jwt_secret" \
  -e ADMIN_PASSWORD="your_admin_password" \
  alisherbs/pc-to-phone-audio:latest
```

---

#### Option 3. Manual Node.js Setup
```bash
cd server
npm install
cp .env.example .env
npm start
```

---

### 🧩 Installing Chrome Extension (`extension/`)
1. Open Chrome or Edge and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked**.
4. Select the `extension/` folder from this repository.

---

---

<a name="russian-version"></a>
## 🇷🇺 Русская версия

### 🚀 Возможности
- 🎧 **Трансляция звука без задержки**: Использование протокола WebRTC и кодека Opus для передачи звука в реальном времени.
- 📱 **Без установки приложений**: Работает во всех современных браузерах (Safari, Chrome, Firefox, Edge, Kiwi, Orion).
- 🧩 **Расширение для Chrome**: Включает исходный код браузерного расширения для захвата системного звука и вкладки (`extension/`).
- 🔐 **Комнаты и безопасность**: Поддержка приватных комнат с паролем, токенов авторизации (JWT) и лимитирования запросов.
- 🔄 **Relay / TURN сервер**: Автоматическая генерация временных REST-учетных данных для Coturn при P2P блокировках/NAT.
- 🐳 **Docker & Docker Compose**: Готов к мгновенному разворачиванию в любом облаке или на домашнем сервере.
- 🌍 **Мультиязычность**: Интерфейсы на казахском, английском и русском языках.

---

### 📂 Структура репозитория
```text
pc-to-phone-audio/
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
```bash
# 1. Клонируйте репозиторий
git clone https://github.com/AlisherBS/pc-to-phone-audio.git
cd pc-to-phone-audio

# 2. Запустите в Docker Compose
docker compose up -d
```
После запуска сервис будет доступен по адресу: `http://localhost:8080`

---

#### Вариант 2. Быстрый запуск из Docker Hub
```bash
docker run -d \
  --name pc-to-phone-audio \
  -p 8080:8080 \
  -e JWT_SECRET="your_custom_jwt_secret" \
  -e ADMIN_PASSWORD="your_admin_password" \
  alisherbs/pc-to-phone-audio:latest
```

---

#### Вариант 3. Ручной запуск (Node.js)
**Требования**: Node.js >= 16.x, Redis (опционально)

```bash
# 1. Перейдите в папку сервера
cd server

# 2. Установите зависимости
npm install

# 3. Скопируйте и настройте конфигурационный файл .env
cp .env.example .env

# 4. Запустите сервер
npm start
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

---

### 🚢 Публикация образов в Docker Hub через GitHub Actions
Репозиторий включает готовый сценарий CI/CD в файле `.github/workflows/docker-publish.yml`.
Чтобы включить автосборку образов в ваш Docker Hub:
1. Перейдите в настройки репозитория на GitHub: **Settings -> Secrets and variables -> Actions**.
2. Добавьте секреты:
   - `DOCKERHUB_USERNAME` — ваше имя пользователя на Docker Hub (`alisherbs`).
   - `DOCKERHUB_TOKEN` — персональный токен доступа (Personal Access Token) с правами записи.
3. При каждом коммите в ветку `main` или создании релиз-тега `v*.*.*` GitHub Actions автоматически соберет образ под платформы `amd64` и `arm64` и опубликует его в ваш Docker Hub.

---

### 📄 License / Лицензия
Этот проект распространяется под открытой лицензией **GNU Affero General Public License v3.0 (AGPL-3.0)**.
Подробную информацию см. в файле [LICENSE](LICENSE).
