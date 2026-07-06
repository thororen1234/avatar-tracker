import { addExtra } from 'puppeteer-extra';
import _puppeteer, { Browser, Page } from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { SearchResult } from './ripperStore.js';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const puppeteer = addExtra(_puppeteer as any);
puppeteer.use(StealthPlugin());

const COOKIES_PATH = path.join(process.cwd(), 'vrmodels_cookies.json');

const DL_PATTERNS = [
    /mega\.nz/i, /mega\.io/i, /mediafire/i, /drive\.google/i, /gofile\.io/i,
    /pixeldrain/i, /anonfiles/i, /anonfile\.la/i, /workupload/i, /1fichier/i,
    /dropbox/i, /onedrive/i, /terabox/i, /bowfile/i, /1cloudfile\.com/i,
    /archive\.org\/download/i, /app\.bunkrr\.su/i, /buzzheavier\.com/i,
    /clicknupload\.click/i, /cyberfile\.me/i, /dailyuploads\.net/i,
    /datanodes\.to/i, /disk\.yandex\.com/i, /fastupload\.io/i,
    /filebin\.net/i, /fileditch\.com/i, /filepost\.io/i, /files\.fm/i,
    /filetransfer\.io/i, /fuckingfast\.net/i, /hexload\.com/i,
    /mixdrop\.ag/i, /send\.cm/i, /terminal\.lc/i, /transfer\.it/i,
    /uploadfile\.pl/i, /uploadhaven\.com/i, /uploadnow\.io/i,
    /wdho\.ru/i, /wetransfer\.com/i, /axfc\.net/i, /filemail\.com/i,
    /sendspace\.com/i, /swisstransfer\.com/i, /zippyshare\.day/i,
];

function isDownloadLink(url: string): boolean {
    return DL_PATTERNS.some(pattern => pattern.test(url));
}

export function extractCreator(text: string): string | undefined {
    let match = text.match(/(?:creator|author|by)[\s:]+([A-Za-z0-9_.-]+)/i);
    if (match) {
        const name = match[1].trim();
        if (name.toLowerCase() !== 'companion' && name.toLowerCase() !== 'companion-') {
            return name;
        }
    }

    match = text.match(/[0-9]\.[0-9]\s+([A-Za-z0-9_.-]+)$/i);
    if (match) return match[1].trim();

    return undefined;
}

async function loadCookies(page: Page) {
    if (fs.existsSync(COOKIES_PATH)) {
        const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
        if (cookies && cookies.length) {
            await page.browserContext().setCookie(...cookies);
        }
    }
}

async function saveCookies(page: Page) {
    const cookies = await page.browserContext().cookies();
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
}

async function loginIfNeeded(page: Page) {
    await page.goto('https://vrmodels.store/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const content = await page.content();
    if (content.includes('name="login_name"')) {
        console.log('[VRModels] Not logged in, attempting login...');
        const user = process.env.VRMODELS_USERNAME;
        const pass = process.env.VRMODELS_PASSWORD;
        if (!user || !pass) {
            console.warn('[VRModels] VRMODELS_USERNAME or VRMODELS_PASSWORD missing in .env. Cannot login.');
            return;
        }

        await page.type('input[name="login_name"]', user);
        await page.type('input[name="login_password"]', pass);

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.click('button[type="submit"], input[type="submit"]')
        ]).catch(() => console.log('Wait for navigation timed out after login click.'));

        await saveCookies(page);
        console.log('[VRModels] Login submitted and cookies saved.');
    } else {
        console.log('[VRModels] Already logged in via cookies.');
    }
}

export async function searchVrModelsStore(query: string): Promise<SearchResult[]> {
    const searchUrl = `https://vrmodels.store/?do=search&subaction=search&story=${encodeURIComponent(query)}`;

    let browser: Browser | null = null;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();

        await loadCookies(page);
        await loginIfNeeded(page);

        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));

        const content = await page.content();
        const $ = cheerio.load(content);

        const results: SearchResult[] = [];

        const linksToVisit: string[] = [];
        const resultTitles: Record<string, string> = {};

        $('.short-story, .story').each((i, el) => {
            const titleEl = $(el).find('.story-title a, h2.title a, h3 a');
            const title = titleEl.text().trim();
            const url = titleEl.attr('href');

            if (title && url) {
                linksToVisit.push(url);
                resultTitles[url] = title;
            }
        });

        for (const url of linksToVisit) {
            let downloadLinks: string[] = [];
            let creator: string | undefined = undefined;
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                const pageContent = await page.content();
                const $page = cheerio.load(pageContent);

                $page('a').each((_, el) => {
                    const href = $page(el).attr('href');
                    if (href && isDownloadLink(href) && !downloadLinks.includes(href)) {
                        downloadLinks.push(href);
                    }
                });

                let descriptionText = '';
                $page('script[type="application/ld+json"]').each((i, el) => {
                    try {
                        const data = JSON.parse($page(el).html() || '{}');
                        if (data['@graph']) {
                            const article = data['@graph'].find((g: any) => g['@type'] === 'NewsArticle');
                            if (article && article.description) {
                                descriptionText += ' ' + article.description;
                            }
                        }
                    } catch (e) { }
                });
                if (!descriptionText) {
                    descriptionText = $page('meta[name="description"]').attr('content') || '';
                }
                creator = extractCreator(descriptionText);

            } catch (e) {
                console.error(`[VRModels] Failed to visit ${url}:`, e);
            }

            results.push({
                title: resultTitles[url],
                url: url,
                source: 'vrmodels.store',
                downloadLinks,
                creator
            });
        }

        return results;
    } catch (error) {
        console.error(`Error searching vrModelsStore for ${query}:`, error);
        return [];
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

export async function getRecentVrModels(daysBack: number = 1): Promise<SearchResult[]> {
    let browser: Browser | null = null;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();

        await loadCookies(page);
        await loginIfNeeded(page);

        const results: SearchResult[] = [];
        const linksToVisit: string[] = [];
        const resultTitles: Record<string, string> = {};

        const thresholdDate = new Date();
        thresholdDate.setDate(thresholdDate.getDate() - daysBack);

        let currentPage = 1;
        let keepGoing = true;

        while (keepGoing) {
            const url = `https://vrmodels.store/avatars/page/${currentPage}/`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 2000));

            const content = await page.content();
            const $ = cheerio.load(content);
            const shots = $('.shot');

            if (shots.length === 0) break;

            shots.each((i, el) => {
                if (!keepGoing) return;

                const titleEl = $(el).find('h3 a, a').first();
                let title = titleEl.text().trim();
                if (!title) {
                    title = $(el).find('h3').text().trim();
                }
                const postUrl = $(el).find('a').attr('href');

                const textContent = $(el).text();
                const dateMatch = textContent.match(/Date:\s*(\d{2})-(\d{2})-(\d{4}),\s*(\d{2}):(\d{2})/);
                if (dateMatch) {
                    const [_, day, month, year, hours, minutes] = dateMatch;
                    const postDate = new Date(`${year}-${month}-${day}T${hours}:${minutes}:00Z`);

                    if (postDate < thresholdDate) {
                        keepGoing = false;
                        return;
                    }
                }

                if (title && postUrl && keepGoing) {
                    linksToVisit.push(postUrl);
                    resultTitles[postUrl] = title;
                }
            });

            currentPage++;
        }

        for (const url of linksToVisit) {
            let downloadLinks: string[] = [];
            let creator: string | undefined = undefined;

            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                const pageContent = await page.content();
                const $page = cheerio.load(pageContent);

                $page('a').each((_, el) => {
                    const href = $page(el).attr('href');
                    if (href && isDownloadLink(href) && !downloadLinks.includes(href)) {
                        downloadLinks.push(href);
                    }
                });

                let descriptionText = '';
                $page('script[type="application/ld+json"]').each((i, el) => {
                    try {
                        const data = JSON.parse($page(el).html() || '{}');
                        if (data['@graph']) {
                            const article = data['@graph'].find((g: any) => g['@type'] === 'NewsArticle');
                            if (article && article.description) {
                                descriptionText += ' ' + article.description;
                            }
                        }
                    } catch (e) { }
                });

                if (!descriptionText) {
                    descriptionText = $page('meta[name="description"]').attr('content') || '';
                }

                creator = extractCreator(descriptionText);

            } catch (e) {
                console.error(`[VRModels] Failed to visit ${url}:`, e);
            }

            results.push({
                title: resultTitles[url],
                url: url,
                source: 'vrmodels.store',
                downloadLinks,
                creator
            });
        }

        return results;
    } catch (error) {
        console.error(`Error fetching recent vrModelsStore avatars:`, error);
        return [];
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}
