import { addExtra } from 'puppeteer-extra';
import _puppeteer from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import { SearchResult } from './ripperStore.js';

const puppeteer = addExtra(_puppeteer);
puppeteer.use(StealthPlugin());

export async function searchVrcPirate(target: string): Promise<SearchResult[]> {
    console.log(`[VRCPirate] Searching for: ${target}`);
    const results: SearchResult[] = [];

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        const searchUrl = `https://vrcpirate.com/assets?tag=${encodeURIComponent(target)}`;
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        await new Promise(r => setTimeout(r, 5000));

        const html = await page.content();
        const $ = cheerio.load(html);

        $('a[href^="/iviewer/"]').each((i, el) => {
            const href = $(el).attr('href');
            const title = $(el).text().trim();

            if (href && title && title.length > 2) {
                const url = `https://vrcpirate.com${href}`;
                const creator = 'VRCPirate Contributor';

                if (!results.some(r => r.url === url)) {
                    results.push({
                        title,
                        url,
                        creator,
                        source: 'VRCPirate'
                    });
                }
            }
        });

        console.log(`[VRCPirate] Found ${results.length} results for ${target}`);
    } catch (error) {
        console.error(`[VRCPirate] Error searching for ${target}:`, error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }

    return results;
}
