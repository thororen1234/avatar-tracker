import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { getTargets } from '../tracker.js';

export const data = new SlashCommandBuilder()
    .setName('list')
    .setDescription('List all currently tracked avatars');

export async function execute(interaction: ChatInputCommandInteraction) {
    const targetsMap = getTargets();
    const targets = Object.keys(targetsMap);
    if (targets.length === 0) {
        await interaction.reply({ content: 'Currently not tracking any avatars.', ephemeral: true });
    } else {
        const userTargets = targets.filter(t => targetsMap[t].includes(interaction.user.id));

        if (userTargets.length === 0) {
            await interaction.reply({ content: 'You are currently not tracking any avatars.', ephemeral: true });
        } else {
            const list = userTargets.map((t, i) => `${i + 1}. ${t}`).join('\n');
            await interaction.reply(`You are currently tracking:\n${list}`);
        }
    }
}
