import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as cheerio from 'cheerio';
import { env } from '../../config/env';
import { authenticate } from '../../middleware/authenticate';
import { ValidationError, UnprocessableError } from '../../shared/errors';
import OpenAI, { APIError } from 'openai';
import { PDFParse } from 'pdf-parse';

export const parseRouter = Router();

if (!fs.existsSync(env.UPLOAD_DIR)) fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

const upload = multer({ dest: env.UPLOAD_DIR, limits: { fileSize: 20 * 1024 * 1024 } });

const TEXT_MIN_CHARS = 50;
const OCR_MAX_PAGES = 3;

function cleanText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().substring(0, 10000);
}

function extractApiError(e: unknown): string {
  if (e instanceof APIError) {
    const detail = (e as any).error?.message || e.message;
    if (e.status === 401) return `API key is invalid or expired. Please update it in Settings. (${detail})`;
    return `AI service error: ${detail}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

// ── PDF parsing with OCR fallback ──

async function parsePdf(filePath: string, dashscopeKey?: string): Promise<{ text: string; source: string }> {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const textResult = await parser.getText();
  const text = cleanText(textResult.text);

  if (text.length >= TEXT_MIN_CHARS) return { text, source: 'pdf' };

  if (dashscopeKey) {
    try {
      const ocrText = await ocrPdfPages(filePath, dashscopeKey);
      if (ocrText.trim().length > text.length) return { text: cleanText(ocrText), source: 'pdf_ocr' };
    } catch (e) {
      throw new UnprocessableError(extractApiError(e));
    }
  }

  return { text, source: 'pdf' };
}

async function ocrPdfPages(filePath: string, dashscopeKey: string, maxPages = OCR_MAX_PAGES): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const info = await parser.getInfo({ parsePageInfo: true });
  const pageCount = Math.min(maxPages, info.total);

  const screenshotResult = await parser.getScreenshot({ first: pageCount, scale: 2.0 });

  const errors: string[] = [];
  const texts = await Promise.all(
    screenshotResult.pages.map(async (s) => {
      try {
        return await ocrImageBase64(s.dataUrl, dashscopeKey);
      } catch (e) {
        errors.push(extractApiError(e));
        return '';
      }
    })
  );

  const combined = texts.filter(Boolean).join('\n\n');
  if (!combined && errors.length > 0) throw new UnprocessableError(errors[0]);
  return combined;
}

async function ocrImageBase64(dataUrl: string, apiKey: string): Promise<string> {
  const openai = new OpenAI({ apiKey, baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' });
  const response = await openai.chat.completions.create({
    model: 'qwen-vl-plus',
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: dataUrl } } as any,
      { type: 'text', text: 'Extract all text from this image. Output only the extracted text.' },
    ]}],
  });
  return response.choices[0]?.message?.content || '';
}

// ── Other parsers ──

async function parseDocx(filePath: string): Promise<string> {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return cleanText(result.value);
}

async function parseImage(filePath: string, mimeType: string, dashscopeKey: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  return ocrImageBase64(`data:${mimeType};base64,${buffer.toString('base64')}`, dashscopeKey);
}

async function parseUrl(url: string): Promise<{ text: string; title: string }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, aside, .nav, .menu, .sidebar, .ad, .cookie, iframe, noscript').remove();
  const title = $('title').text().trim() || $('h1').first().text().trim() || '';
  const contentSelectors = ['main', 'article', '[role="main"]', '.content', '#content', '.post', '.entry', 'body'];
  let text = '';
  for (const sel of contentSelectors) {
    const el = $(sel);
    if (el.length) { text = el.text(); break; }
  }
  return { text: cleanText(text), title };
}

// ── Routes ──

parseRouter.post('/url', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') return next(new ValidationError('url required'));
    const { text, title } = await parseUrl(url);
    if (!text) return next(new UnprocessableError('Could not extract text from URL'));
    res.json({ text, title, source: 'url', url, charCount: text.length });
  } catch (e: any) { next(new UnprocessableError(`Failed to fetch URL: ${e.message}`)); }
});

parseRouter.post('/urls', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { urls } = req.body as { urls: string[] };
    if (!Array.isArray(urls) || urls.length === 0) return next(new ValidationError('urls array required'));
    const results = await Promise.allSettled(
      urls.map(async (url) => {
        const { text, title } = await parseUrl(url);
        const emailMatch = text.match(/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i);
        return { name: title.substring(0, 60) || url, email: emailMatch ? emailMatch[0] : undefined, rawText: text, source: 'url', sourceUrl: url };
      })
    );
    const candidates = results.map((r, i) => ({
      url: urls[i], ok: r.status === 'fulfilled', candidate: r.status === 'fulfilled' ? r.value : null, error: r.status === 'rejected' ? (r.reason as Error).message : null,
    }));
    res.json({ candidates });
  } catch (e) { next(e); }
});

parseRouter.post('/', authenticate, upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  const file = req.file;
  if (!file) return next(new ValidationError('No file uploaded'));
  const ext = path.extname(file.originalname).toLowerCase();
  const filePath = file.path;
  try {
    let text = ''; let source = '';
    if (ext === '.pdf') {
      const result = await parsePdf(filePath, req.user!.dashscopeKey ?? undefined);
      text = result.text; source = result.source;
    } else if (ext === '.docx') { text = await parseDocx(filePath); source = 'docx'; }
    else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      if (!req.user!.dashscopeKey) return next(new UnprocessableError('API key required for image OCR. Please add it in Settings.'));
      text = await parseImage(filePath, { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext]!, req.user!.dashscopeKey!);
      source = 'image_ocr';
    } else {
      return next(new ValidationError(`Unsupported: ${ext}`));
    }
    res.json({ text, source, charCount: text.length });
  } catch (e) {
    if (e instanceof APIError) return next(new UnprocessableError(extractApiError(e)));
    next(e);
  } finally { fs.unlink(filePath, () => {}); }
});
