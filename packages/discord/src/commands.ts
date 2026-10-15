import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { SeasonConfig } from "@everest/board-data";
import { REDEMPTION_ISLAND_ID } from "@everest/server";

export function buildRollCommand() {
  return new SlashCommandBuilder().setName("roll").setDescription("Roll the dice on your board (when it's your turn).");
}

// Board choices come from season-config.json when the bot starts.
function boardChoices(config: SeasonConfig) {
  const choices = config.boards.map((b) => ({ name: b.name, value: b.id }));
  if (config.redemptionIsland.layout) choices.push({ name: "Redemption Island", value: REDEMPTION_ISLAND_ID });
  return choices;
}

// /board ... for hosts. Every reply is private.
export function buildBoardCommand(config: SeasonConfig) {
  const choices = boardChoices(config);
  const board = (o: import("discord.js").SlashCommandStringOption, required = true) =>
    o.setName("board").setDescription("Which board").setRequired(required).addChoices(...choices);
  const player = (o: import("discord.js").SlashCommandUserOption) => o.setName("player").setDescription("The player").setRequired(true);

  return new SlashCommandBuilder()
    .setName("board")
    .setDescription("Season 3 board tools (hosts only).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName("status").setDescription("Show a board: turn, timers, players.").addStringOption((o) => board(o)))
    .addSubcommand((s) => s.setName("start").setDescription("Start a board. The first player gets unlimited time.").addStringOption((o) => board(o)))
    .addSubcommand((s) => s.setName("pause").setDescription("Pause a board (freezes every timer).").addStringOption((o) => board(o)))
    .addSubcommand((s) => s.setName("resume").setDescription("Resume a paused board.").addStringOption((o) => board(o)))
    .addSubcommand((s) =>
      s
        .setName("send")
        .setDescription("Put a player on a board, or move them. Redemption Island resets them.")
        .addUserOption(player)
        .addStringOption((o) => board(o))
        .addBooleanOption((o) => o.setName("reset").setDescription("Reset coins, stars and items (default: only for Redemption Island)")),
    )
    .addSubcommand((s) => s.setName("remove").setDescription("Take a player off the board entirely.").addUserOption(player))
    .addSubcommand((s) =>
      s
        .setName("coins")
        .setDescription("Set a player's coins.")
        .addUserOption(player)
        .addIntegerOption((o) => o.setName("amount").setDescription("New coin total").setRequired(true).setMinValue(0)),
    )
    .addSubcommand((s) =>
      s
        .setName("stars")
        .setDescription("Set a player's stars.")
        .addUserOption(player)
        .addIntegerOption((o) => o.setName("amount").setDescription("New star total").setRequired(true).setMinValue(0)),
    )
    .addSubcommand((s) =>
      s
        .setName("give")
        .setDescription("Give a player an item.")
        .addUserOption(player)
        .addStringOption((o) => o.setName("item").setDescription("Item").setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("take")
        .setDescription("Take an item from a player.")
        .addUserOption(player)
        .addStringOption((o) => o.setName("item").setDescription("Item").setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("move")
        .setDescription("Move a player to a space (no space effects).")
        .addUserOption(player)
        .addStringOption((o) => o.setName("space").setDescription("Space id, e.g. s45").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("star")
        .setDescription("Move the star to a blue space.")
        .addStringOption((o) => board(o))
        .addStringOption((o) => o.setName("space").setDescription("Space id, e.g. s62").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("order")
        .setDescription("Set the turn order: mention every player on the board, in order.")
        .addStringOption((o) => board(o))
        .addStringOption((o) => o.setName("players").setDescription("@first @second @third ...").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("turn")
        .setDescription("Open the current turn now (end the cooldown), or skip the current player.")
        .addStringOption((o) => board(o))
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("What to do")
            .setRequired(true)
            .addChoices({ name: "open now (end the cooldown)", value: "open" }, { name: "skip this player", value: "skip" }),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("undo")
        .setDescription("Undo the last change, or the whole last turn.")
        .addStringOption((o) => board(o))
        .addBooleanOption((o) => o.setName("turn").setDescription("Undo the whole last turn (roll and its choices)"))
        .addIntegerOption((o) => o.setName("count").setDescription("How many changes to undo (default 1)").setMinValue(1)),
    )
    .addSubcommand((s) => s.setName("refresh").setDescription("Re-post the board image at the bottom of its channel.").addStringOption((o) => board(o)));
}
