import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { removeTarget } from '../tracker.js';

export const data = new SlashCommandBuilder()
    .setName('untrack')
    .setDescription('Stop tracking an avatar or store link')
    .addStringOption(option =>
        option.setName('target')
            .setDescription('The avatar name or ripper store URL to untrack')
            .setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
    const target = interaction.options.getString('target', true).trim();

    const removed = removeTarget(target, interaction.user.id);
    if (removed) {
        await interaction.reply(`Stopped tracking: **${target}**`);
    } else {
        await interaction.reply({ content: `You were not tracking: **${target}**`, ephemeral: true });
    }
}
