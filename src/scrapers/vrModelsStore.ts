import axios from 'axios';
import { SearchResult } from './ripperStore.js';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const COOKIES_PATH = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'vrmodels_cookies.json');

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

function getCookies(): any[] {
    if (fs.existsSync(COOKIES_PATH)) {
        try {
            const rawCookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
            return rawCookies.map((c: any) => ({
                name: c.name,
                value: c.value,
                domain: c.domain || '.vrmodels.store',
                path: c.path || '/'
            }));
        } catch (e) {
            console.error('[VRModels] Failed to read cookies:', e);
        }
    }
    return [];
}

function saveCookies(cookies: any[]) {
    if (cookies && cookies.length > 0) {
        fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
    }
}

async function getFlareSolverrResponse(url: string, isPost: boolean = false, postData: string = ''): Promise<{ html: string, isLoggedOut: boolean } | null> {
    const flareUrl = process.env.FLARESOLVERR_URL || 'http://localhost:8191/v1';

    try {
        const response = await axios.post(flareUrl, {
            cmd: isPost ? 'request.post' : 'request.get',
            url: url,
            postData: isPost ? postData : undefined,
            maxTimeout: 60000,
            cookies: getCookies()
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.solution) {
            saveCookies(response.data.solution.cookies);
            const html = response.data.solution.response;
            const isLoggedOut = html.includes('name="login_name"');
            return { html, isLoggedOut };
        }
    } catch (e: any) {
        console.error(`[VRModels] FlareSolverr request failed for ${url}:`, e.message);
    }
    return null;
}

async function loginIfNeeded() {
    const response = await getFlareSolverrResponse('https://vrmodels.store/');
    if (!response) return;

    if (response.isLoggedOut) {
        console.log('[VRModels] Not logged in, attempting login via FlareSolverr...');
        const user = process.env.VRMODELS_USERNAME;
        const pass = process.env.VRMODELS_PASSWORD;
        if (!user || !pass) {
            console.warn('[VRModels] VRMODELS_USERNAME or VRMODELS_PASSWORD missing in .env. Cannot login.');
            return;
        }

        const postData = `login_name=${encodeURIComponent(user)}&login_password=${encodeURIComponent(pass)}&login=submit`;
        const loginResponse = await getFlareSolverrResponse('https://vrmodels.store/', true, postData);

        if (loginResponse && !loginResponse.isLoggedOut) {
            console.log('[VRModels] Login submitted and cookies saved.');
        } else {
            console.log('[VRModels] Login might have failed. Checking if successful...');
        }
    } else {
        console.log('[VRModels] Already logged in via cookies.');
    }
}

export async function searchVrModelsStore(query: string): Promise<SearchResult[]> {
    const searchUrl = `https://vrmodels.store/?do=search&subaction=search&story=${encodeURIComponent(query)}`;

    try {
        await loginIfNeeded();

        const response = await getFlareSolverrResponse(searchUrl);
        if (!response) return [];

        const $ = cheerio.load(response.html);
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
                const pageResponse = await getFlareSolverrResponse(url);
                if (pageResponse) {
                    const $page = cheerio.load(pageResponse.html);

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
                }
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
    }
}

export async function getRecentVrModels(daysBack: number = 1): Promise<SearchResult[]> {
    try {
        await loginIfNeeded();

        const results: SearchResult[] = [];
        const linksToVisit: string[] = [];
        const resultTitles: Record<string, string> = {};

        const thresholdDate = new Date();
        thresholdDate.setDate(thresholdDate.getDate() - daysBack);

        let currentPage = 1;
        let keepGoing = true;

        while (keepGoing) {
            const url = `https://vrmodels.store/avatars/page/${currentPage}/`;

            const response = await getFlareSolverrResponse(url);
            if (!response) break;

            const $ = cheerio.load(response.html);
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
                const pageResponse = await getFlareSolverrResponse(url);
                if (pageResponse) {
                    const $page = cheerio.load(pageResponse.html);

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
                }
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
    }
}
