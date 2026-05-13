import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Collection } from 'discord.js';
import { logger } from '../utils/logger.js';
import { Routes } from 'discord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getSubcommandInfo(commandData) {
    const subcommands = [];

    if (commandData.options) {
        for (const option of commandData.options) {
            if (option.type === 1) {
                subcommands.push(option.name);
            } else if (option.type === 2) {
                if (option.options) {
                    for (const subOption of option.options) {
                        if (subOption.type === 1) {
                            subcommands.push(`${option.name}/${subOption.name}`);
                        }
                    }
                }
            }
        }
    }

    return subcommands;
}

async function getAllFiles(directory, fileList = []) {
    const files = await fs.readdir(directory, { withFileTypes: true });

    for (const file of files) {
        const filePath = path.join(directory, file.name);

        if (file.isDirectory()) {
            if (file.name === 'modules') continue;
            await getAllFiles(filePath, fileList);
        } else if (file.name.endsWith('.js')) {
            fileList.push(filePath);
        }
    }

    return fileList;
}

export async function loadCommands(client) {
    client.commands = new Collection();
    const commandsPath = path.join(__dirname, '../commands');
    const commandFiles = await getAllFiles(commandsPath);

    logger.info(`Found ${commandFiles.length} command files to load`);

    const uniqueCommandNames = new Set();

    for (const filePath of commandFiles) {
        try {
            const normalizedPath = filePath.replace(/\\/g, '/');

            const commandModule = await import(`file://${filePath}`);
            const command = commandModule.default || commandModule;

            if (!command.data || !command.execute) {
                logger.warn(`Command missing data/execute: ${filePath}`);
                continue;
            }

            command.category = path.basename(path.dirname(filePath));
            command.filePath = normalizedPath;

            const name = command.data.name;

            if (!uniqueCommandNames.has(name)) {
                uniqueCommandNames.add(name);
                client.commands.set(name, command);
            }

            logger.info(`Loaded command: ${name}`);

        } catch (error) {
            logger.error(`Error loading command ${filePath}:`, error);
        }
    }

    logger.info(`Loaded ${client.commands.size} commands`);
    return client.commands;
}

/* =======================================================
   🔥 GLOBAL SLASH COMMAND REGISTRATION (FIXED)
======================================================= */

export async function registerCommands(client) {
    try {
        const commands = [];
        const registeredNames = new Set();

        for (const command of client.commands.values()) {
            if (command.data?.toJSON) {
                const name = command.data.name;

                if (!registeredNames.has(name)) {
                    registeredNames.add(name);
                    commands.push(command.data.toJSON());
                }
            }
        }

        const clientId = client.config.bot.clientId;

        logger.info(`Registering ${commands.length} GLOBAL slash commands...`);

        await client.rest.put(
            Routes.applicationCommands(clientId),
            { body: commands }
        );

        logger.info(`✅ GLOBAL commands registered successfully`);

    } catch (error) {
        logger.error('Error registering commands:', error);
        throw error;
    }
}

/* ======================================================= */

export async function reloadCommand(client, commandName) {
    const command = client.commands.get(commandName);

    if (!command) {
        return { success: false, message: `Command "${commandName}" not found` };
    }

    try {
        const commandPath = path.resolve(command.filePath);
        const moduleUrl = pathToFileURL(commandPath);
        moduleUrl.searchParams.set('t', Date.now().toString());

        const newCommand = (await import(moduleUrl.href)).default;

        client.commands.set(commandName, newCommand);

        logger.info(`Reloaded command: ${commandName}`);

        return { success: true };

    } catch (error) {
        logger.error(`Reload error ${commandName}:`, error);

        return {
            success: false,
            message: error.message
        };
    }
}
