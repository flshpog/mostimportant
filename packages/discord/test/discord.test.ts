import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLayouts, loadSeasonConfig } from "@everest/board-data";
import { createBoardState } from "@everest/engine";
import { buildBoardCommand, buildRollCommand, buttonId, direction, parseButtonId, prepareBackdrops, renderBoard } from "../src";
import { narrate } from "../src/messages";
import { fakeInteraction, HOST, PEACH, rig, settle, TOAD, type Rig } from "./fakes";

const main = loadLayouts().main;

describe("message helpers", () => {
  it("button ids round-trip", () => {
    for (const a of [
      { kind: "roll", boardId: "mario-stadium" },
      { kind: "fork", boardId: "mario-stadium", next: "s79" },
      { kind: "star", boardId: "luigis-mansion", buy: true },
      { kind: "star", boardId: "luigis-mansion", buy: false },
      { kind: "shop", boardId: "warioware-inc", itemId: "mushroom" },
      { kind: "shop", boardId: "warioware-inc", itemId: null },
      { kind: "event", boardId: "warioware-inc", targetId: "100000000000000002" },
      { kind: "event", boardId: "warioware-inc", targetId: null },
    ] as const) {
      expect(parseButtonId(buttonId(a))).toEqual(a);
    }
    expect(parseButtonId("create_ticket")).toBeNull();
  });

  it("fork buttons say which way, from the layout", () => {
    expect(direction(main, "s01", "s02")).toBe("⬆️ Up");
    expect(direction(main, "s01", "s79")).toBe("⬅️ Left");
    expect(direction(main, "s03", "s15")).toBe("↖️ Up-left");
  });

  it("narration skips what the dice, prompts and pings already say", () => {
    const lines = narrate(
      [
        { type: "DiceRolled", playerId: PEACH, dice: [3], total: 3 },
        { type: "PlayerMoved", playerId: PEACH, from: "s01", to: "s02", remaining: 2 },
        { type: "LandedOnSpace", playerId: PEACH, spaceId: "s02", spaceType: "blue" },
        { type: "CoinsChanged", playerId: PEACH, delta: 3, coins: 13, reason: "blue" },
        { type: "TurnStarted", playerId: TOAD, windowOpensAt: 1, deadline: 2 },
      ],
      () => "Peach",
      (i) => i,
    );
    expect(lines).toEqual(["**Peach** landed on a blue space.", "**Peach** got 3 coins. Now 13."]);
  });

  it("command definitions are valid for Discord", () => {
    expect(buildRollCommand().toJSON().name).toBe("roll");
    const board = buildBoardCommand(loadSeasonConfig()).toJSON();
    expect(board.options?.map((o) => o.name)).toEqual(
      expect.arrayContaining(["status", "start", "pause", "resume", "send", "remove", "coins", "stars", "give", "take", "move", "star", "order", "turn", "undo", "refresh"]),
    );
  });

  it("renders the board image, with and without the Blender backdrop", async () => {
    await prepareBackdrops(["main"]);
    const state = createBoardState({ layout: main, rules: loadSeasonConfig() }, { boardId: "x", starSpace: "s62", players: [{ id: "1", name: "Peach" }] });
    const img = renderBoard({ layout: main, state, boardName: "Test", now: 0 });
    expect([img[0], img[1]]).toEqual([0xff, 0xd8]); // JPEG
    expect(img.length).toBeGreaterThan(20_000);
    const flat = renderBoard({ layout: main, state, boardName: "Test", now: 0, flat: true });
    expect(flat.length).toBeGreaterThan(20_000);
  });
});

describe("the bridge", () => {
  let r: Rig;
  beforeEach(async () => {
    r = await rig();
    await r.service.transfer(PEACH, "mario-stadium", HOST, { name: "Peach" });
    await r.service.transfer(TOAD, "mario-stadium", HOST, { name: "Toad" });
    await settle(r);
  });
  afterEach(() => r.close());

  it("keeps one board image and edits it in place", async () => {
    const images = r.channel.live().filter((m) => m.files.length);
    expect(images).toHaveLength(1);
    expect(images[0].content).toContain("Mario Stadium");
    await r.service.hostAction("mario-stadium", { type: "setCoins", playerId: PEACH, coins: 40 }, HOST);
    await settle(r);
    expect(r.channel.live().filter((m) => m.files.length)).toHaveLength(1);
  });

  it("starting the board pings the first player with a Roll button", async () => {
    await r.service.hostAction("mario-stadium", { type: "startBoard" }, HOST);
    await settle(r);
    const turn = r.channel.live().find((m) => m.content.includes("it's your turn"))!;
    expect(turn.content).toContain(`<@${PEACH}>`);
    expect(turn.content).toContain("no time limit");
    expect(turn.buttons).toEqual([{ id: "board:roll:mario-stadium:go", label: "Roll" }]);
  });

  it("a website roll still shows dice, narration and a fork prompt in Discord", async () => {
    await r.service.hostAction("mario-stadium", { type: "startBoard" }, HOST);
    r.dice.push(2);
    await r.service.roll(PEACH, "web");
    await settle(r);
    const dice = r.channel.live().find((m) => m.content.startsWith("🎲 **Peach**"))!;
    expect(dice.history[0]).toBe("🎲 **Peach** is rolling...");
    expect(dice.content).toBe("🎲 **Peach** rolled a **2**!");
    const prompt = r.channel.live().find((m) => m.content.startsWith("🔀"))!;
    expect(prompt.content).toContain(`<@${PEACH}>, you're at a fork with **2** steps left`);
    expect(prompt.buttons.map((b) => b.label)).toEqual(["⬆️ Up", "⬅️ Left"]);
    // the "your turn" Roll button is retired once the roll happens
    expect(r.channel.live().find((m) => m.content.includes("it's your turn"))!.buttons).toEqual([]);
  });

  it("only the right player can click; a good click resolves and retires the prompt", async () => {
    await r.service.hostAction("mario-stadium", { type: "startBoard" }, HOST);
    r.dice.push(2);
    await r.service.roll(PEACH, "web");
    await settle(r);
    const prompt = r.channel.live().find((m) => m.content.startsWith("🔀"))!;

    const toad = fakeInteraction(TOAD, { customId: prompt.buttons[0].id });
    await r.discord.handleButton(toad);
    expect(toad.calls).toEqual([{ type: "reply", payload: { content: "That's Peach's choice to make.", ephemeral: true } }]);

    const peach = fakeInteraction(PEACH, { customId: prompt.buttons[0].id });
    await r.discord.handleButton(peach);
    await settle(r);
    expect(peach.calls.map((c: { type: string }) => c.type)).toEqual(["deferUpdate"]);
    expect(prompt.buttons).toEqual([]); // retired
    expect(r.service.state("mario-stadium").state.players[PEACH].space).toBe("s03");
    const next = r.channel.live().find((m) => m.content.includes(`<@${TOAD}> is up next`))!;
    expect(next.content).toContain("Your turn opens <t:");
  });

  it("/roll explains problems privately and never posts them in the channel", async () => {
    const stranger = fakeInteraction("100000000000000099");
    await r.discord.handleRoll(stranger);
    expect(stranger.calls[0]).toEqual({ type: "reply", payload: { content: "You aren't on a board right now.", ephemeral: true } });

    const early = fakeInteraction(PEACH);
    await r.discord.handleRoll(early);
    expect(early.calls.map((c: { type: string }) => c.type)).toEqual(["deferReply", "editReply"]);
    expect(early.calls[1].payload).toBe("The board hasn't started yet.");

    await r.service.hostAction("mario-stadium", { type: "startBoard" }, HOST);
    const wrong = fakeInteraction(TOAD);
    await r.discord.handleRoll(wrong);
    expect(wrong.calls[1].payload).toBe("It isn't your turn yet.");
  });

  it("/roll in the board channel clears its private reply; the roll shows publicly", async () => {
    await r.service.hostAction("mario-stadium", { type: "startBoard" }, HOST);
    r.dice.push(1);
    const i = fakeInteraction(PEACH, { channelId: r.season.boards[0].channelId });
    await r.discord.handleRoll(i);
    await settle(r);
    expect(i.calls.map((c: { type: string }) => c.type)).toEqual(["deferReply", "deleteReply"]);
    expect(r.channel.texts().some((t) => t.startsWith("🎲 **Peach** rolled a **1**!"))).toBe(true);
  });

  it("host edits are silent in the channel", async () => {
    const before = r.channel.live().length;
    await r.service.hostAction("mario-stadium", { type: "setCoins", playerId: PEACH, coins: 99 }, HOST, "discord");
    await settle(r);
    expect(r.channel.live().length).toBe(before);
  });

  it("an undo tells the channel and re-pings the right player", async () => {
    await r.service.hostAction("mario-stadium", { type: "startBoard" }, HOST);
    r.dice.push(2);
    await r.service.roll(PEACH, "web");
    await r.service.undo("mario-stadium", { turn: true }, HOST);
    await settle(r);
    const texts = r.channel.texts();
    expect(texts).toContain("⏪ The hosts rewound the board.");
    expect(texts.at(-1)).toContain(`<@${PEACH}>, it's your turn!`);
    // the fork prompt from the undone roll lost its buttons
    expect(r.channel.live().find((m) => m.content.startsWith("🔀"))!.buttons).toEqual([]);
  });

  it("/board trusts the host role on the command itself", async () => {
    r.discord.stop();
    const { BoardDiscord } = await import("../src");
    const d = new BoardDiscord({
      client: {} as any,
      service: r.service,
      loadConfig: () => r.season,
      dataDir: r.dataDir,
      isHost: async () => false, // the lookup fails...
      hostRoleId: "555555555555555555",
      getChannel: async () => null,
      log: () => undefined,
    });
    const options = { getSubcommand: () => "coins", getUser: () => ({ id: PEACH, username: "peach" }), getInteger: () => 5, getString: () => null, getBoolean: () => null, getMember: () => null };
    const withRole = fakeInteraction("100000000000000077", { options, member: { roles: ["555555555555555555"] } });
    await d.handleHostCommand(withRole);
    expect(withRole.calls[1].payload).toBe("✅ **Peach** lost 5 coins (host). Now 5."); // ...but the role on the command is enough
    const without = fakeInteraction("100000000000000078", { options, member: { roles: [] } });
    await d.handleHostCommand(without);
    expect(without.calls[0].payload).toEqual({ content: "Only hosts can use /board.", ephemeral: true });
  });

  it("/board is refused for non-hosts and works for hosts", async () => {
    const options = {
      getSubcommand: () => "coins",
      getUser: () => ({ id: PEACH, username: "peach" }),
      getInteger: () => 25,
      getString: () => null,
      getBoolean: () => null,
      getMember: () => null,
    };
    const nope = fakeInteraction(PEACH, { options });
    await r.discord.handleHostCommand(nope);
    expect(nope.calls[0].payload).toEqual({ content: "Only hosts can use /board.", ephemeral: true });

    const host = fakeInteraction(HOST, { options });
    await r.discord.handleHostCommand(host);
    expect(host.calls.map((c: { type: string }) => c.type)).toEqual(["deferReply", "editReply"]);
    expect(host.calls[1].payload).toBe("✅ **Peach** got 15 coins (host). Now 25.");
    expect(r.service.state("mario-stadium").state.players[PEACH].coins).toBe(25);
  });
});

describe("turn pings on the real clock", () => {
  it("pings the next player the moment their window opens", async () => {
    const r = await rig({ realClock: true });
    try {
      r.season.turns = { ...r.season.turns, cooldownHours: 0.00005 }; // 180ms
      await r.service.transfer(PEACH, "mario-stadium", HOST, { name: "Peach" });
      await r.service.transfer(TOAD, "mario-stadium", HOST, { name: "Toad" });
      await r.service.hostAction("mario-stadium", { type: "startBoard" }, HOST);
      r.dice.push(2);
      await r.service.roll(PEACH, "web");
      await r.service.chooseFork(PEACH, "s79", "web");
      await settle(r);
      expect(r.channel.texts().some((t) => t.includes(`<@${TOAD}> is up next`))).toBe(true);
      await new Promise((res) => setTimeout(res, 400));
      await settle(r);
      const ping = r.channel.live().find((m) => m.content.includes(`<@${TOAD}>, it's your turn!`));
      expect(ping?.buttons).toEqual([{ id: "board:roll:mario-stadium:go", label: "Roll" }]);
    } finally {
      r.close();
    }
  });
});

describe("updates thread", () => {
  let r: Rig;
  beforeEach(async () => {
    r = await rig({ thread: true });
    await r.service.transfer(PEACH, "mario-stadium", HOST, { name: "Peach" });
    await r.service.transfer(TOAD, "mario-stadium", HOST, { name: "Toad" });
    await settle(r);
  });
  afterEach(() => r.close());

  it("keeps only the board image in the channel and everything else in one thread", async () => {
    await r.service.hostAction("mario-stadium", { type: "startBoard" }, HOST);
    r.dice.push(2);
    await r.service.roll(PEACH, "web");
    await settle(r);
    expect(r.channel.threadsCreated.map((t) => t.name)).toEqual(["🎲 Mario Stadium updates"]);
    const thread = r.channel.threadsCreated[0];
    // channel: just the image, linking to the thread
    expect(r.channel.live()).toHaveLength(1);
    expect(r.channel.live()[0].files).toHaveLength(1);
    expect(r.channel.live()[0].content).toContain(`play in <#${thread.id}>`);
    // thread: turn ping, dice, prompt
    const texts = thread.texts();
    expect(texts.some((t) => t.includes("it's your turn"))).toBe(true);
    expect(texts.some((t) => t.startsWith("🎲 **Peach** rolled a **2**!"))).toBe(true);
    expect(texts.some((t) => t.startsWith("🔀"))).toBe(true);
  });

  it("/roll typed inside the thread clears its private reply", async () => {
    await r.service.hostAction("mario-stadium", { type: "startBoard" }, HOST);
    await settle(r);
    const thread = r.channel.threadsCreated[0];
    r.dice.push(1);
    const i = fakeInteraction(PEACH, { channelId: thread.id });
    await r.discord.handleRoll(i);
    expect(i.calls.map((c: { type: string }) => c.type)).toEqual(["deferReply", "deleteReply"]);
  });

  it("reuses the same thread, reopening it if Discord archived it", async () => {
    await r.service.hostAction("mario-stadium", { type: "startBoard" }, HOST);
    await settle(r);
    const thread = r.channel.threadsCreated[0];
    thread.archived = true;
    await r.service.hostAction("mario-stadium", { type: "pause" }, HOST);
    await r.service.hostAction("mario-stadium", { type: "resume" }, HOST);
    await settle(r);
    expect(r.channel.threadsCreated).toHaveLength(1);
    expect(thread.archived).toBe(false);
  });
});
