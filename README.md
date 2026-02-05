# my-app

Minimal instructions to run the upload server locally and with Docker.

Prerequisites
- Node.js 18+ / 20+
- npm
- Docker (optional, recommended for Redis)

Local development

1. Copy `.env.example` to `.env` and set values.
2. Install dependencies:

```bash
npm ci
```

3. Start the server:

```bash
PORT=15500 node server/server.js
```

Using Docker Compose (recommended for Redis)

1. Copy `.env.example` to `.env` and set values.
2. Start services:

```bash
docker compose up --build
```

This will start Redis and the app on port `15500` and mount `public/uploads`.

Notes
- For production, set `COOKIE_SECURE=true` and provide `REDIS_URL`.
- Replace local uploads with S3/GCS for durable object storage in production.

Production (durable storage + env guidance)

1. Use durable object storage (recommended): set `STORAGE_BACKEND=s3` and provide `S3_BUCKET`, `S3_REGION`, and `S3_PUBLIC_URL` in your production environment. Do NOT store uploads on the container filesystem — S3 ensures files persist across deployments.

2. Configure environment variables in the cloud provider or with Docker secrets. Example production env file is provided at `.env.production.example` (do NOT commit real secrets).

3. Ensure production mode and secure cookies:

```
NODE_ENV=production
COOKIE_SECURE=true
```

4. SMTP: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `BOOKING_TO`. For Gmail, use an App Password and keep credentials in the host's secret manager.

5. Start the server (example using docker-compose):

```
cp .env.production.example .env
# edit .env with real values (or configure secrets in your cloud provider)
docker compose up --build -d
```

6. Verify health and email sending:

```
# health
curl -i http://<host>:15500/health

# test booking (or submit form)
curl -F "name=Test" -F "email=you@example.com" -F "date=2026-01-30" -F "time=10:00" \
	http://<host>:15500/api/book
```

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## SMTP / Booking form

This project includes a server endpoint that sends booking form submissions via SMTP (`POST /api/book`).

Setup:

- Copy `.env.example` to `.env` and fill in real values for:
	- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
	- `BOOKING_TO` (email that receives booking requests)
	- `ADMIN_USER`, `ADMIN_PASS`, `PASSCODE`, `PORT`

- Do NOT commit `.env` to source control.

Start the server (reads `.env` automatically):

```bash
# edit .env first, then:
PORT=15500 npm run server
```

Quick one-shot (no .env):

```bash
SMTP_HOST=smtp.example.com SMTP_PORT=587 SMTP_SECURE=false \
SMTP_USER=you@example.com SMTP_PASS='yourpass' BOOKING_TO=me@domain.com PORT=15500 npm run server
```

Test the booking endpoint with curl:

```bash
curl -F "name=Test" -F "email=you@example.com" -F "date=2026-01-20" \
	-F "time=10:00" -F "message=Hello" -F "attachment=@/path/to/ref.jpg" \
	http://127.0.0.1:15500/api/book
```

If you want the server to load `.env` automatically on start, `dotenv` is already installed and loaded by the server.

Redeploy trigger: Thu Feb  5 01:50:07 UTC 2026
