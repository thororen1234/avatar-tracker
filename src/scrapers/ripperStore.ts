import { addExtra } from 'puppeteer-extra';
import _puppeteer from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';

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

export async function searchRipperStore(query: string): Promise<SearchResult[]> {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();

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

export async function extractPayLinkFromTopic(topicUrl: string): Promise<string | null> {
    let browser;
    try {
        const match = topicUrl.match(/topic\/(\d+)/);
        if (!match) return null;

        const tid = match[1];
        const topicApiUrl = `https://forum.ripper.store/api/topic/${tid}`;

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        const topicData = await getJsonFromPage(page, topicApiUrl);

        if (topicData && topicData.posts && topicData.posts.length > 0) {
            const firstPost = topicData.posts[0];
            if (firstPost.content) {
                const $ = cheerio.load(firstPost.content);
                let payLink: string | null = null;
                $('a').each((_, el) => {
                    const href = $(el).attr('href');
                    if (href && (href.includes('payhip.com') || href.includes('jinxxy.com') || href.includes('gumroad.com') || href.includes('booth.pm') || href.includes('ko-fi.com') || href.includes('patreon.com'))) {
                        payLink = href;
                        return false;
                    }
                });
                return payLink;
            }
        }
    } catch (e) {
        console.error(`[RipperStore] Failed to extract pay link from ${topicUrl}:`, e);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
    return null;
}
