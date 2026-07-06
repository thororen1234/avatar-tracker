import fs from 'fs';
import path from 'path';
import { searchRipperStore, SearchResult } from './scrapers/ripperStore.js';
import { searchVrModelsStore } from './scrapers/vrModelsStore.js';
import { searchVrcPirate } from './scrapers/vrcpirateStore.js';
import { Client, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const DATA_DIR = process.env.DATA_DIR || process.cwd();
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
        const vrcPirateResults = await searchVrcPirate(target);
        const allResults = [...ripperResults, ...vrModelsResults, ...vrcPirateResults];

        if (!foundCache[target]) {
            foundCache[target] = [];
        }

        for (const result of allResults) {
            if (!foundCache[target].includes(result.url)) {
                foundCache[target].push(result.url);
                hasNewFinds = true;
                await notifyDiscord(client, channelId, target, result, userIds);
            }
        }
    }

    if (hasNewFinds) {
        saveFoundCache(foundCache);
    }

    console.log('[Tracker] Run completed.');
}

async function notifyDiscord(client: Client, channelId: string, target: string, result: SearchResult, userIds: string[]) {
    try {
        const channel = await client.channels.fetch(channelId) as TextChannel;
        if (!channel || !channel.isTextBased()) {
            console.error('[Tracker] Invalid discord channel configured.');
            return;
        }

        const isUnknownCreator = !result.creator || result.creator === 'Unknown' || result.creator === 'VRCPirate Contributor';
        const embedColor = isUnknownCreator ? '#FFFF00' : '#00FF00';
        const embedTitle = isUnknownCreator ? 'Possible Avatar Found (Unknown Creator)' : 'Avatar Found!';

        const embed = new EmbedBuilder()
            .setTitle(embedTitle)
            .setColor(embedColor)
            .addFields(
                { name: 'Target', value: target },
                { name: 'Title', value: result.title },
                { name: 'Source', value: result.source }
            );

        if (result.creator) {
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
        const messageContent = isUnknownCreator
            ? `Found a potential match for **${target}**, but couldn't verify the creator.`
            : `Hey ${mentions}, an avatar you requested was found!`;

        await channel.send({
            content: messageContent,
            embeds: [embed],
            components: [row]
        });
        console.log(`[Tracker] Notified discord about ${result.url}`);
    } catch (error) {
        console.error(`[Tracker] Error notifying discord:`, error);
    }
}
