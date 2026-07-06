import axios from 'axios';
import * as cheerio from 'cheerio';

export interface BoothItem {
    id: string;
    title: string;
    url: string;
}

export async function scrapeBoothItem(url: string): Promise<BoothItem | null> {
    try {
        const match = url.match(/\/items\/(\d+)/);
        const id = match ? match[1] : null;

        if (!id) return null;

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });

        const $ = cheerio.load(response.data);
        const title = $('h2.text-bg-default').first().text().trim() || $('title').text().replace(' - BOOTH', '').trim();

        return {
            id,
            title,
            url
        };
    } catch (error) {
        console.error(`Error scraping Booth item ${url}:`, error);
        return null;
    }
}
