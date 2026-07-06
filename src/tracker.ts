import fs from 'fs';
import path from 'path';
import { searchRipperStore, SearchResult } from './scrapers/ripperStore.js';
import { searchVrModelsStore } from './scrapers/vrModelsStore.js';
import { Client, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const TARGETS_FILE = path.join(DATA_DIR, 'targets.json');
const FOUND_FILE = path.join(DATA_DIR, 'found.json');

export function getTargets(): Record<string, string[]> {
    try {
        if (!fs.existsSync(TARGETS_FILE)) return {};
        const data = fs.readFileSync(TARGETS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
}

export function addTarget(target: string, userId: string): boolean {
    const targets = getTargets();
    if (!targets[target]) targets[target] = [];
    if (targets[target].includes(userId)) return false;

    targets[target].push(userId);
    fs.writeFileSync(TARGETS_FILE, JSON.stringify(targets, null, 2));
    return true;
}

export function removeTarget(target: string, userId: string): boolean {
    const targets = getTargets();
    if (!targets[target] || !targets[target].includes(userId)) return false;

    targets[target] = targets[target].filter(id => id !== userId);
    if (targets[target].length === 0) delete targets[target];

    fs.writeFileSync(TARGETS_FILE, JSON.stringify(targets, null, 2));
    return true;
}

function getFoundCache(): Record<string, string[]> {
    try {
        if (!fs.existsSync(FOUND_FILE)) return {};
        const data = fs.readFileSync(FOUND_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
}

function saveFoundCache(cache: Record<string, string[]>) {
    fs.writeFileSync(FOUND_FILE, JSON.stringify(cache, null, 2));
}

export async function runTracker(client: Client, channelId: string) {
    const targetsMap = getTargets();
    const targets = Object.keys(targetsMap);
    const foundCache = getFoundCache();
    let hasNewFinds = false;

    console.log(`[Tracker] Starting run for ${targets.length} targets...`);

    for (const target of targets) {
        const userIds = targetsMap[target];
        console.log(`[Tracker] Searching for: ${target}`);

        const ripperResults = await searchRipperStore(target);
        const vrModelsResults = await searchVrModelsStore(target);
        const allResults = [...ripperResults, ...vrModelsResults];

        if (!foundCache[target]) {
            foundCache[target] = [];
        }

        allResults.sort((a, b) => {
            const aHasLinks = (a.downloadLinks && a.downloadLinks.length > 0) ? 1 : 0;
            const bHasLinks = (b.downloadLinks && b.downloadLinks.length > 0) ? 1 : 0;
            if (aHasLinks > bHasLinks) return -1;
            if (aHasLinks < bHasLinks) return 1;

            const aGift = a.title.toUpperCase().includes('GIFT') || a.title.toUpperCase().includes('[FOUND]');
            const bGift = b.title.toUpperCase().includes('GIFT') || b.title.toUpperCase().includes('[FOUND]');
            if (aGift && !bGift) return -1;
            if (!aGift && bGift) return 1;
            return 0;
        });

        let targetFound = false;

        for (const result of allResults) {
            if (!foundCache[target].includes(result.url)) {
                const isGiftOrFound = result.title.toUpperCase().includes('GIFT') || result.title.toUpperCase().includes('[FOUND]');
                const isUnknownCreator = !result.creator || result.creator === 'Unknown';

                const hasDownloadLinks = result.downloadLinks && result.downloadLinks.length > 0;
                const isDefinitive = (!isUnknownCreator || isGiftOrFound) && hasDownloadLinks;

                if (targetFound && !isDefinitive) continue;

                foundCache[target].push(result.url);
                hasNewFinds = true;
                const wasDefinitive = await notifyDiscord(client, channelId, target, result, userIds);
                if (wasDefinitive) {
                    targetFound = true;
                }
            }
        }

        if (targetFound) {
            console.log(`[Tracker] Target ${target} found definitively. Removing from tracker.`);
            delete targetsMap[target];
            fs.writeFileSync(TARGETS_FILE, JSON.stringify(targetsMap, null, 2));
        }
    }

    if (hasNewFinds) {
        saveFoundCache(foundCache);
    }

    console.log('[Tracker] Run completed.');
}

async function notifyDiscord(client: Client, channelId: string, target: string, result: SearchResult, userIds: string[]): Promise<boolean> {
    try {
        const channel = await client.channels.fetch(channelId) as TextChannel;
        if (!channel || !channel.isTextBased()) {
            console.error('[Tracker] Invalid discord channel configured.');
            return false;
        }

        const isUnknownCreator = !result.creator || result.creator === 'Unknown';
        const isGiftOrFound = result.title.toUpperCase().includes('GIFT') || result.title.toUpperCase().includes('[FOUND]');
        const hasDownloadLinks = result.downloadLinks && result.downloadLinks.length > 0;
        const isDefinitiveFind = (!isUnknownCreator || isGiftOrFound) && hasDownloadLinks;

        const embedColor = isDefinitiveFind ? '#00FF00' : '#FFFF00';
        const embedTitle = isDefinitiveFind ? 'Avatar Found!' : 'Possible Avatar Found';

        const embed = new EmbedBuilder()
            .setTitle(embedTitle)
            .setColor(embedColor)
            .addFields(
                { name: 'Target', value: target },
                { name: 'Title', value: result.title },
                { name: 'Source', value: result.source }
            );

        if (result.creator && !isGiftOrFound) {
            embed.addFields({ name: 'Creator', value: result.creator });
        }

        if (result.downloadLinks && result.downloadLinks.length > 0) {
            embed.addFields({ name: 'Downloads', value: result.downloadLinks.join('\n') });
        } else {
            embed.addFields({ name: 'Downloads', value: 'No direct download links found (check the page directly).' });
        }

        embed.setTimestamp();

        const button = new ButtonBuilder()
            .setLabel(`View on ${result.source}`)
            .setStyle(ButtonStyle.Link)
            .setURL(result.url);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

        const mentions = userIds.map(id => `<@${id}>`).join(' ');
        const messageContent = !isDefinitiveFind
            ? `Found a potential match for **${target}**, but couldn't verify the creator.`
            : `Hey ${mentions}, an avatar you requested was found!`;

        await channel.send({
            content: messageContent,
            embeds: [embed],
            components: [row]
        });
        console.log(`[Tracker] Notified discord about ${result.url}`);
        return isDefinitiveFind;
    } catch (error) {
        console.error(`[Tracker] Error notifying discord:`, error);
        return false;
    }
}
