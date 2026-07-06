import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

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

const COOKIE_PATH = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'ripper_cookies.json');

async function getFlareSolverrResponse(url: string): Promise<any> {
    const flareUrl = process.env.FLARESOLVERR_URL || 'http://localhost:8191/v1';
    let cookies: any[] = [];
    if (fs.existsSync(COOKIE_PATH)) {
        try {
            const rawCookies = JSON.parse(fs.readFileSync(COOKIE_PATH, 'utf-8'));
            cookies = rawCookies.map((c: any) => ({
                name: c.name,
                value: c.value,
                domain: c.domain || '.ripper.store',
                path: c.path || '/'
            }));
        } catch (e) {
            console.error('[RipperStore] Failed to read cookies:', e);
        }
    }

    try {
        const response = await axios.post(flareUrl, {
            cmd: 'request.get',
            url: url,
            maxTimeout: 60000,
            cookies: cookies
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.solution) {
            if (response.data.solution.cookies && response.data.solution.cookies.length > 0) {
                fs.writeFileSync(COOKIE_PATH, JSON.stringify(response.data.solution.cookies, null, 2));
            }

            const html = response.data.solution.response;
            const $ = cheerio.load(html);
            const bodyText = $('body').text().trim();

            if (bodyText.startsWith('{') || bodyText.startsWith('[')) {
                return JSON.parse(bodyText);
            }
            if (html.trim().startsWith('{') || html.trim().startsWith('[')) {
                return JSON.parse(html.trim());
            }

            console.error(`[RipperStore] Expected JSON from ${url}, got HTML instead.`);
            return null;
        }
    } catch (e: any) {
        console.log(flareUrl);
        console.error(`[RipperStore] FlareSolverr request failed for ${url}:`, e.message);
    }
    return null;
}

export async function searchRipperStore(query: string): Promise<SearchResult[]> {
    try {
        const url = API_URL.replace('{query}', encodeURIComponent(query));
        console.log(`[RipperStore] Searching for: ${query}`);

        const data = await getFlareSolverrResponse(url);
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
                    const topicData = await getFlareSolverrResponse(topicApiUrl);

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
    }
}

export async function extractPayLinkFromTopic(topicUrl: string): Promise<{ payLink: string | null, title: string | null }> {
    try {
        const match = topicUrl.match(/topic\/(\d+)/);
        if (!match) return { payLink: null, title: null };

        const tid = match[1];
        const topicApiUrl = `https://forum.ripper.store/api/topic/${tid}`;

        const topicData = await getFlareSolverrResponse(topicApiUrl);
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
    }
    return { payLink: null, title: null };
}
