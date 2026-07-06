import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { runTracker } from './tracker.js';
import { commands } from './commands/index.js';

dotenv.config();

const token = process.env.DISCORD_BOT_TOKEN;
const channelId = process.env.DISCORD_CHANNEL_ID;

if (!token || !channelId) {
    console.error('Missing DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID in .env file');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const commandData = commands.map(c => c.data.toJSON());

client.once('ready', async () => {
    console.log(`Bot logged in as ${client.user?.tag}`);

    try {
        console.log('[Discord] Started refreshing application (/) commands.');
        const rest = new REST({ version: '10' }).setToken(token);

        if (client.user) {
            await rest.put(
                Routes.applicationCommands(client.user.id),
                { body: commandData }
            );
            console.log('[Discord] Successfully reloaded application (/) commands.');
        }
    } catch (error) {
        console.error('[Discord] Failed to refresh application commands:', error);
    }

    cron.schedule('0 * * * *', async () => {
        console.log('[Cron] Triggering tracker run...');
        await runTracker(client, channelId);
    });

    console.log('[Cron] Scheduled tracker to run every hour at minute 0.');

    runTracker(client, channelId).catch(console.error);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.channelId !== channelId) {
        await interaction.reply({ content: 'I only operate in the configured tracking channel.', ephemeral: true });
        return;
    }

    const command = commands.find(c => c.data.name === interaction.commandName);
    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction, client, channelId);
    } catch (error) {
        console.error(`Error executing ${interaction.commandName}`);
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
});

client.login(token).catch(error => {
    console.error('Error logging into discord:', error);
});
