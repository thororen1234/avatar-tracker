import { SlashCommandBuilder, ChatInputCommandInteraction, Client } from 'discord.js';
import { extractPayLinkFromTopic } from '../scrapers/ripperStore.js';
import { scrapeBoothItem } from '../scrapers/boothStore.js';
import { addTarget, runTracker } from '../tracker.js';

export const data = new SlashCommandBuilder()
    .setName('track')
    .setDescription('Track an avatar or store link')
    .addStringOption(option =>
        option.setName('target')
            .setDescription('The avatar name or store URL to track')
            .setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction, client: Client, channelId: string) {
    let target = interaction.options.getString('target', true).trim();

    await interaction.deferReply();

    let replyText = '';

    if (target.startsWith('https://forum.ripper.store/topic/')) {
        const result = await extractPayLinkFromTopic(target);
        if (result.payLink) {
            target = result.payLink;
            replyText += `Extracted original creator link from Ripper Store post: **${target}**.\nTracking this link instead!\n\n`;
        } else if (result.title) {
            const cleanTitle = result.title.replace(/^(?:\[?(?:GIFT|FOUND|LF)\]?:?\s*)+/i, '').trim();
            target = cleanTitle;
            replyText += `Could not find a pay/creator link. Extracted title: **${target}**\nTracking this name across platforms!\n\n`;
        } else {
            replyText += `Could not find a pay/creator link or title in that Ripper Store topic. I will track the provided URL.\n\n`;
        }
    }
    else if (target.includes('booth.pm/')) {
        const boothItem = await scrapeBoothItem(target);
        if (boothItem) {
            target = boothItem.title;
            replyText += `Extracted name from Booth: **${boothItem.title}** (ID: ${boothItem.id}).\nTracking this name across platforms!\n\n`;
        } else {
            replyText += `Failed to extract information from Booth link. Tracking the URL directly.\n\n`;
        }
    }

    const added = addTarget(target, interaction.user.id);
    if (added) {
        replyText += `Now tracking: **${target}**`;
        await interaction.editReply(replyText);
        await runTracker(client, channelId);
    } else {
        replyText += `You are already tracking: **${target}**`;
        await interaction.editReply(replyText);
    }
}
