const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rocks')
        .setDescription('Randomly eliminate one player from a list')
        .addStringOption(option =>
            option.setName('players')
                .setDescription('Comma or space separated list of players')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        try {
            const playersInput = interaction.options.getString('players');
            
            // Parse players from input
            const players = this.parsePlayers(playersInput);

            // Validate input
            if (players.length === 0) {
                return await interaction.reply({
                    content: 'No valid players found in your input. Please provide a list of players separated by commas or spaces.',
                    ephemeral: true
                });
            }

            if (players.length === 1) {
                return await interaction.reply({
                    content: `Cannot eliminate from a list with only one player: **${players[0]}**`,
                    ephemeral: true
                });
            }

            if (players.length > 20) {
                return await interaction.reply({
                    content: 'Too many players! Please limit to 20 players or fewer for the rock draw.',
                    ephemeral: true
                });
            }

            // Shuffle the player order so draw order is random
            for (let i = players.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [players[i], players[j]] = [players[j], players[i]];
            }

            // Randomly decide which player gets the purple rock (eliminated)
            const eliminatedIndex = Math.floor(Math.random() * players.length);

            // Create Stop Rocks button
            const stopButton = new ButtonBuilder()
                .setCustomId(`stop_rocks_${interaction.user.id}`)
                .setLabel('Stop Rocks!')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('⏹️');

            const row = new ActionRowBuilder().addComponents(stopButton);

            // Send initial announcement
            const initialMessage = `${interaction.user} has started rocks!\n` +
                                 `${players.join(', ')} will now draw rocks.\n` +
                                 `Whoever draws the **PURPLE** rock will be eliminated.`;

            await interaction.reply({
                content: initialMessage,
                components: [row],
                fetchReply: true
            });

            const rocksMessage = await interaction.fetchReply();

            // Start the rock drawing sequence
            await this.startRockDrawing(rocksMessage, players, eliminatedIndex, interaction.user.id);

        } catch (error) {
            console.error('Error in rocks command:', error);
            await interaction.reply({
                content: 'There was an error processing the rock draw.',
                ephemeral: true
            });
        }
    },

    async startRockDrawing(message, players, eliminatedIndex, userId) {
        let currentPlayerIndex = 0;
        let gameActive = true;

        // Store game state for stop button
        if (!message.client.rocksGames) {
            message.client.rocksGames = new Map();
        }
        message.client.rocksGames.set(userId, { active: true });

        for (let i = 0; i < players.length && gameActive; i++) {
            currentPlayerIndex = i;

            // Check if game was stopped
            const gameState = message.client.rocksGames.get(userId);
            if (!gameState || !gameState.active) {
                gameActive = false;
                break;
            }

            const player = players[i];
            const isEliminated = (i === eliminatedIndex);

            // Wait a moment before starting each player's turn
            await this.sleep(1000);

            // Send NEW message: Player draws a rock
            const drawMessage = await message.channel.send(`${player} draws a rock.`);

            await this.sleep(1000);

            // Edit that message to show suspense with dots
            const dots = ['...', '....', '.....', '....', '...'];

            for (let dotIndex = 0; dotIndex < dots.length; dotIndex++) {
                // Check if game was stopped during animation
                const gameState = message.client.rocksGames.get(userId);
                if (!gameState || !gameState.active) {
                    gameActive = false;
                    break;
                }

                await drawMessage.edit(`${player} draws a rock.\nThe color is${dots[dotIndex]}`);

                await this.sleep(1000);
            }

            if (!gameActive) break;

            // Reveal the color in the edited message
            const color = isEliminated ? '**PURPLE**' : '**WHITE**';
            const colorEmoji = isEliminated ? '🟣' : '⚪';

            await drawMessage.edit(`${player} draws a rock.\nThe color is... ${color} ${colorEmoji}`);

            await this.sleep(1500);

            if (isEliminated) {
                // Send NEW message: Player eliminated
                let eliminationMessage;

                if (i === players.length - 1) {
                    // Last player - only rock left is purple
                    eliminationMessage = `${player}, You live to fight another day... NOT!\n` +
                                       `I'm sorry ${player}, the only rock left is purple. You have been eliminated in the worst way possible.\n\n` +
                                       `**Goodbye.**`;
                } else {
                    // Eliminated before last draw
                    eliminationMessage = `I'm sorry ${player}, you've been eliminated in the worst way possible.\n\n` +
                                       `**Goodbye.**`;
                }

                await message.channel.send(eliminationMessage);

                // Update initial message to remove stop button
                await message.edit({
                    content: message.content,
                    components: []
                });

                // Clean up game state
                message.client.rocksGames.delete(userId);
                return;
            } else {
                // Send NEW message: Player is safe
                await message.channel.send(`${player}, You live to fight another day.`);

                // If not the last player, send NEW message that next person draws
                if (i < players.length - 1) {
                    await this.sleep(500);
                    // The next iteration will handle the next player's draw
                }
            }
        }

        // Clean up if game ended without elimination (shouldn't happen, but safety)
        message.client.rocksGames.delete(userId);
    },

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    parsePlayers(input) {
        // First try comma separation
        let players = input.split(',').map(p => p.trim()).filter(p => p.length > 0);
        
        // If only one result, try space separation
        if (players.length === 1) {
            players = input.split(/\s+/).map(p => p.trim()).filter(p => p.length > 0);
        }

        // Remove duplicates while preserving order
        const uniquePlayers = [];
        const seen = new Set();
        
        for (const player of players) {
            const lowerPlayer = player.toLowerCase();
            if (!seen.has(lowerPlayer)) {
                seen.add(lowerPlayer);
                uniquePlayers.push(player);
            }
        }

        // Filter out very short names (likely typos)
        return uniquePlayers.filter(p => p.length >= 1 && p.length <= 50);
    }
};