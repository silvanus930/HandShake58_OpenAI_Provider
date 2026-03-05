/**
 * Hybrid Web Extractor
 * Supports static HTML and JavaScript-rendered sites (Next.js, React, Nuxt, etc.)
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { chromium, type Browser } from 'playwright';

const NAVIGATION_TIMEOUT = 10_000;
const MAX_TEXT_LENGTH = 5000;
const STATIC_SIZE_THRESHOLD = 500 * 1024; // 500 KB

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface HybridExtractionResult {
  title: string;
  main_text: string;
  links: string[];
  source: 'static' | 'dynamic';
}

const DYNAMIC_PATTERNS = [
  /__NEXT_DATA__/i,
  /window\.__NUXT__/i,
  /id=["']root["']/i,
  /id=["']app["']/i,
  /id=["']__nuxt["']/i,
  /id=["']__next["']/i,
  /data-reactroot/i,
  /react-root/i,
];

function detectDynamicPage(html: string): boolean {
  for (const pattern of DYNAMIC_PATTERNS) {
    if (pattern.test(html)) return true;
  }
  const scriptLength = (html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || []).join('').length;
  const textLength = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').length;
  const scriptToTextRatio = scriptLength / Math.max(1, textLength);
  if (scriptToTextRatio > 2) return true;
  return false;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function cleanupText(text: string): string {
  return normalizeWhitespace(text).slice(0, MAX_TEXT_LENGTH);
}

function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    try {
      const resolved = new URL(href, baseUrl);
      if (['http:', 'https:'].includes(resolved.protocol)) {
        links.push(resolved.href);
      }
    } catch {
      // skip invalid
    }
  });
  return [...new Set(links)];
}

/**
 * Static extraction: axios + cheerio (+ Readability for main content)
 */
async function extractStatic(html: string, url: string): Promise<HybridExtractionResult | null> {
  try {
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, aside, .sidebar, .nav, .footer, .header, iframe, noscript').remove();

    let mainText = $('body').text();
    let title = $('title').text().trim() || '';

    try {
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      if (article) {
        mainText = article.textContent || mainText;
        if (article.title) title = article.title;
      }
    } catch {
      // fallback to cheerio extraction
    }

    mainText = cleanupText(mainText);
    if (!mainText && !title) return null;

    const links = extractLinksFromHtml(html, url);

    return {
      title: title || new URL(url).hostname,
      main_text: mainText,
      links,
      source: 'static',
    };
  } catch {
    return null;
  }
}

/**
 * Dynamic extraction: Playwright
 */
async function extractDynamic(url: string): Promise<HybridExtractionResult | null> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: NAVIGATION_TIMEOUT,
    });

    const [title, bodyText, links] = await Promise.all([
      page.title(),
      page.evaluate(() => document.body?.innerText || ''),
      page.evaluate((base: string) => {
        const anchors = document.querySelectorAll('a[href]');
        const set = new Set<string>();
        for (const a of anchors) {
          const href = (a as HTMLAnchorElement).href;
          if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            try {
              const u = new URL(href, base);
              if (['http:', 'https:'].includes(u.protocol)) set.add(u.href);
            } catch {}
          }
        }
        return Array.from(set);
      }, url),
    ]);

    const mainText = cleanupText(bodyText);
    if (!mainText && !title) return null;

    return {
      title: title || new URL(url).hostname,
      main_text: mainText,
      links,
      source: 'dynamic',
    };
  } catch {
    return null;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.warn('[hybridExtractor] Browser close error:', e);
      }
    }
  }
}

/**
 * Hybrid extract: try static first if applicable, else dynamic
 */
export async function hybridExtract(url: string): Promise<HybridExtractionResult | { error: string }> {
  const normalizedUrl = url.replace(/\/$/, '') || url;

  let html: string;
  let pageSize: number;

  try {
    const res = await axios.get<string>(normalizedUrl, {
      headers: { 'User-Agent': UA },
      timeout: 15_000,
      maxContentLength: 2 * 1024 * 1024,
      responseType: 'text',
      validateStatus: (s) => s === 200,
    });
    html = res.data || '';
    pageSize = Buffer.byteLength(html, 'utf8');
  } catch (e) {
    console.warn('[hybridExtractor] Fetch failed, trying Playwright:', e instanceof Error ? e.message : e);
    const dynamicResult = await extractDynamic(normalizedUrl);
    if (dynamicResult) return dynamicResult;
    return { error: 'content_not_extracted' };
  }

  const hasDynamicMarkers = detectDynamicPage(html);
  const useStaticOnly = pageSize < STATIC_SIZE_THRESHOLD && !hasDynamicMarkers;

  if (useStaticOnly) {
    const staticResult = await extractStatic(html, normalizedUrl);
    if (staticResult) return staticResult;
  }

  if (hasDynamicMarkers || !useStaticOnly) {
    const dynamicResult = await extractDynamic(normalizedUrl);
    if (dynamicResult) return dynamicResult;
  }

  const staticFallback = await extractStatic(html, normalizedUrl);
  if (staticFallback) return staticFallback;

  return { error: 'content_not_extracted' };
}
