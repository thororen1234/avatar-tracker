import axios from 'axios';
import * as cheerio from 'cheerio';

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

export async function searchRipperStore(query: string): Promise<SearchResult[]> {
    try {
        const url = API_URL.replace('{query}', encodeURIComponent(query));
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });

        const data = response.data;
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
                    const topicResp = await axios.get(topicApiUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                        },
                        timeout: 10000
                    });

                    if (topicResp.data && topicResp.data.posts) {
                        for (const tPost of topicResp.data.posts) {
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
                    console.error(`Failed to fetch topic ${topicUrl} for links:`, e);
                }

                results.push({
                    title: post.topic.title,
                    url: topicUrl,
                    source: 'Ripper.Store',
                    downloadLinks
                });
            }
        }

        return results;
    } catch (error) {
        console.error(`Error searching RipperStore for ${query}:`, error);
        return [];
    }
}

export async function extractPayLinkFromTopic(topicUrl: string): Promise<string | null> {
    try {
        const match = topicUrl.match(/topic\/(\d+)/);
        if (!match) return null;

        const tid = match[1];
        const topicApiUrl = `https://forum.ripper.store/api/topic/${tid}`;
        const topicResp = await axios.get(topicApiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });

        if (topicResp.data && topicResp.data.posts && topicResp.data.posts.length > 0) {
            const firstPost = topicResp.data.posts[0];
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
        console.error(`Failed to extract pay link from ${topicUrl}:`, e);
    }
    return null;
}
