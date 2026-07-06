import { addExtra } from 'puppeteer-extra';
import _puppeteer from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const puppeteer = addExtra(_puppeteer as any);
puppeteer.use(StealthPlugin());

const API_URL = 'https://forum.ripper.store/api/search?term={query}&in=posts&matchWords=all&by=&categories=&searchChildren=false&hasTags=&replies=&repliesFilter=atleast&timeFilter=newer&timeRange=&sortBy=relevance&sortDirection=desc&showAs=topics';

export interface SearchResult {
    title: string;
    url: string;
    source: string;
    downloadLinks?: string[];
    creator?: string;
}

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
    /vrmmodels\.store/i,
];

function isDownloadLink(url: string): boolean {
    return DL_PATTERNS.some(pattern => pattern.test(url));
}

async function getJsonFromPage(page: any, url: string): Promise<any> {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    await page.waitForFunction(() => {
        const text = document.body.innerText.trim();
        return text.startsWith('{') || text.startsWith('[');
    }, { timeout: 15000 }).catch(() => { });

    const innerText = await page.evaluate(() => document.body.innerText);
    return JSON.parse(innerText);
}

const COOKIE_PATH = path.join(process.env.DATA_DIR || process.cwd(), 'ripper_cookies.json');

async function loginToRipperStore(page: any) {
    if (fs.existsSync(COOKIE_PATH)) {
        try {
            const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH, 'utf-8'));
            await page.setCookie(...cookies);
        } catch (e) {
            console.error('[RipperStore] Failed to parse cookies:', e);
        }
    }

    await page.goto('https://forum.ripper.store/', { waitUntil: 'networkidle2', timeout: 30000 });
    const isLoggedIn = await page.evaluate(() => {
        return document.querySelector('#user_dropdown') !== null || document.querySelector('[component="header/profilelink"]') !== null;
    });

    if (isLoggedIn) return;

    const username = process.env.RIPPERSTORE_USERNAME;
    const password = process.env.RIPPERSTORE_PASSWORD;
    if (!username || !password) {
        console.warn('[RipperStore] No credentials provided in .env! Cannot login, links may be hidden.');
        return;
    }

    console.log('[RipperStore] Logging in...');
    await page.goto('https://forum.ripper.store/login', { waitUntil: 'networkidle2', timeout: 60000 });

    try {
        const turnstileIframe = await page.waitForSelector('iframe[src*="cloudflare"]', { timeout: 15000 });
        if (turnstileIframe) {
            console.log('[RipperStore] Cloudflare Turnstile detected! Attempting to click...');
            await new Promise(r => setTimeout(r, 3000));
            const rect = await turnstileIframe.boundingBox();
            if (rect) {
                await page.mouse.move(rect.x + 30, rect.y + rect.height / 2, { steps: 10 });
                await new Promise(r => setTimeout(r, 500));
                await page.mouse.down();
                await new Promise(r => setTimeout(r, 150));
                await page.mouse.up();

                await new Promise(r => setTimeout(r, 1000));
                await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: 10 });
                await new Promise(r => setTimeout(r, 500));
                await page.mouse.down();
                await new Promise(r => setTimeout(r, 150));
                await page.mouse.up();
            }
        }
    } catch (e) { }

    try {
        await page.waitForSelector('#username', { timeout: 60000 });
        await page.type('#username', username);
        await page.type('#password', password);

        await Promise.all([
            page.click('#login'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
        ]);

        const newCookies = await page.cookies();
        fs.writeFileSync(COOKIE_PATH, JSON.stringify(newCookies, null, 2));
        console.log('[RipperStore] Logged in successfully and saved cookies.');
    } catch (e) {
        console.error('[RipperStore] Login failed:', e);
        const errPath = path.join(process.env.DATA_DIR || process.cwd(), 'ripper_login_error.png');
        await page.screenshot({ path: errPath });
        console.error(`[RipperStore] Saved error screenshot to ${errPath}`);
    }
}

export async function searchRipperStore(query: string): Promise<SearchResult[]> {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();

        await loginToRipperStore(page);

        const url = API_URL.replace('{query}', encodeURIComponent(query));
        console.log(`[RipperStore] Searching for: ${query}`);

        const data = await getJsonFromPage(page, url);
        if (!data || !data.posts) {
            return [];
        }

        const results: SearchResult[] = [];
        for (const post of data.posts) {
            if (post.topic && post.topic.title) {
                const topicUrl = `https://forum.ripper.store/topic/${post.topic.slug}`;
                let downloadLinks: string[] = [];

                try {
                    const topicApiUrl = `https://forum.ripper.store/api/topic/${post.topic.tid}`;
                    const topicData = await getJsonFromPage(page, topicApiUrl);

                    if (topicData && topicData.posts) {
                        for (const tPost of topicData.posts) {
                            if (tPost.content) {
                                const $ = cheerio.load(tPost.content);
                                $('a').each((_, el) => {
                                    const href = $(el).attr('href');
                                    if (href && isDownloadLink(href) && !downloadLinks.includes(href)) {
                                        downloadLinks.push(href);
                                    }
                                });
                            }
                        }
                    }
                } catch (e) {
                    console.error(`[RipperStore] Failed to fetch topic ${topicUrl} for links:`, e);
                }

                results.push({
                    title: post.topic.title,
                    url: topicUrl,
                    source: 'Ripper.Store',
                    downloadLinks,
                    creator: post.user?.username || 'Unknown'
                });
            }
        }

        return results;
    } catch (error) {
        console.error(`[RipperStore] Error searching for ${query}:`, error);
        return [];
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

export async function extractPayLinkFromTopic(topicUrl: string): Promise<{ payLink: string | null, title: string | null }> {
    let browser;
    try {
        const match = topicUrl.match(/topic\/(\d+)/);
        if (!match) return { payLink: null, title: null };

        const tid = match[1];
        const topicApiUrl = `https://forum.ripper.store/api/topic/${tid}`;

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        await loginToRipperStore(page);

        const topicData = await getJsonFromPage(page, topicApiUrl);
        let title = null;
        if (topicData && topicData.title) {
            title = topicData.title;
        }

        if (topicData && topicData.posts && topicData.posts.length > 0) {
            for (const post of topicData.posts) {
                if (post.content) {
                    const $ = cheerio.load(post.content);
                    let payLink: string | null = null;
                    $('a').each((_, el) => {
                        const href = $(el).attr('href');
                        if (href) {
                            const isStoreDomain = href.includes('payhip.com') || href.includes('jinxxy.com') || href.includes('gumroad.com') || href.includes('booth.pm') || href.includes('ko-fi.com') || href.includes('patreon.com');
                            const isCustomPayhip = /\/b\/[a-zA-Z0-9]{4,8}(?:\?.*)?$/.test(href);
                            if (isStoreDomain || isCustomPayhip) {
                                payLink = href;
                                return false;
                            }
                        }
                    });
                    if (payLink) return { payLink, title };
                }
            }
        }
        return { payLink: null, title };
    } catch (e) {
        console.error(`[RipperStore] Failed to extract pay link from ${topicUrl}:`, e);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
    return { payLink: null, title: null };
}
