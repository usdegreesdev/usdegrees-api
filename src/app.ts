import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'

import path from 'path'

export const app = express()

// Strips sensitive query params (e.g. the report-download `token`) before a
// URL is written anywhere — request logs, morgan, etc. — so a signed
// download token never lands in server/PM2/proxy log files.
function redactSensitiveQueryParams(url: string): string {
  return url.replace(/([?&](?:token|access_token)=)[^&]+/gi, "$1[redacted]");
}

app.use((req, res, next) => {
  console.log("➡️ Incoming:", req.method, redactSensitiveQueryParams(req.url));
  next();
});

const allowedOrigins = [
  'http://localhost:3000',
  'https://us-degree-web.vercel.app',
  process.env.ALLOWED_ORIGIN,
].filter(Boolean) as string[]

const CORS_REJECTION_MESSAGE = "Not allowed by CORS"

app.use(helmet())
app.use(cors({
  origin: (origin, callback) => {
    // No Origin header: non-browser callers (curl, Postman, server-to-server,
    // mobile/native clients) don't send one, and CORS is a browser-enforced
    // response-reading restriction — it isn't and can't be an auth boundary
    // for callers that don't send it, so there's nothing to gain by blocking
    // this case.
    if (!origin) return callback(null, true)

    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      const err = new Error(CORS_REJECTION_MESSAGE) as Error & { status: number }
      err.status = 403
      callback(err)
    }
  },
  credentials: true
}))

// Only intercepts CORS rejections above — everything else falls through
// unchanged (there is no other app-level error handler).
app.use((err: Error & { status?: number }, req: Request, res: Response, next: NextFunction) => {
  if (err.message === CORS_REJECTION_MESSAGE) {
    console.warn(`[cors] blocked origin=${req.headers.origin ?? "(none)"}`);
    return res.status(err.status ?? 403).json({ error: "Forbidden" });
  }
  next(err);
})

morgan.token("redacted-url", (req: Request) => redactSensitiveQueryParams(req.originalUrl || req.url))
app.use(morgan(':method :redacted-url :status :res[content-length] - :response-time ms'))
app.use(express.json())

app.use("/public", express.static(path.join(__dirname, "../public")));

app.get('/health', (_, res) => res.json({ status: 'ok' }))