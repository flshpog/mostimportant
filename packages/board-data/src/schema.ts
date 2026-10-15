import { z } from "zod";

// Space types the engine understands. "star" is not a space type: the star sits on
// a blue space and moves at runtime. Each board's starting star space is set in
// season-config.json (boards[].starStart).
export const SpaceTypeSchema = z.enum(["blue", "red", "green", "shop", "event", "start"]);
export type SpaceType = z.infer<typeof SpaceTypeSchema>;

const SpaceIdSchema = z.string().regex(/^s\d{2,3}$/, "space ids look like s01");

export const SpaceSchema = z
  .object({
    id: SpaceIdSchema,
    type: SpaceTypeSchema,
    // 2D layout coords, normalized 0..1 against the reference image.
    pos: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
    // Outgoing directed edges. More than one means a fork.
    next: z.array(SpaceIdSchema).min(1, "every space needs at least one exit"),
    label: z.string().optional(),
    // True if passing (not only landing) triggers the space, e.g. shops. Event
    // spaces trigger on landing only.
    passEffect: z.boolean().optional(),
    // Shop spaces: which stock they sell (a key of season-config shop.variants).
    shop: z.string().optional(),
    // Transcription flags for the owner to confirm. Cleared once confirmed.
    needsReview: z.boolean().optional(),
    reviewNote: z.string().optional(),
  })
  .strict();
export type Space = z.infer<typeof SpaceSchema>;

export const BoardSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    reference: z
      .object({ image: z.string(), width: z.number().positive(), height: z.number().positive() })
      .optional(),
    // How the 3D scene maps to this layout: world = (pixel - c) * scale, in metres, with
    // the image's y axis pointing away from the viewer. Shared by Blender and the website.
    world: z
      .object({ scale: z.number().positive(), cx: z.number(), cy: z.number(), tileY: z.number(), model: z.string() })
      .strict()
      .optional(),
    startSpace: SpaceIdSchema,
    bridges: z
      .array(z.object({ from: SpaceIdSchema, to: SpaceIdSchema, label: z.string() }).strict())
      .default([]),
    spaces: z.array(SpaceSchema).min(1),
  })
  .strict();
export type Board = z.infer<typeof BoardSchema>;

const HoursSchema = z.number().nonnegative();
const SnowflakeSchema = z.string().regex(/^\d{17,20}$/, "discord ids are 17-20 digits");

export const BoardInstanceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    layout: z.string().min(1),
    channelId: SnowflakeSchema,
    starStart: SpaceIdSchema.optional(),
  })
  .strict();
export type BoardInstance = z.infer<typeof BoardInstanceSchema>;

// What an item does. Every number lives here so hosts can retune items in config.
const Die = z.number().int().positive();
export const ItemEffectSchema = z.discriminatedUnion("kind", [
  // Roll `count` dice from min to max and add them (Mushrooms).
  z.object({ kind: z.literal("dice"), count: z.number().int().positive(), min: Die, max: Die }).strict(),
  // Roll two different numbers and pick one (Reroll Block).
  z.object({ kind: z.literal("reroll"), min: Die, max: Die }).strict(),
  // Held: takes `amount` off the next star you buy, then it's used up (Magic Lamp).
  z.object({ kind: z.literal("starDiscount"), amount: z.number().int().positive() }).strict(),
  // Shows you where the star goes next (Star Compass).
  z.object({ kind: z.literal("compass") }).strict(),
  // Held: blocks the next steal against you, then it's used up (Guard Charm).
  z.object({ kind: z.literal("guard") }).strict(),
  // Halves a tribemate's next roll (Poison Mushroom).
  z.object({ kind: z.literal("poison") }).strict(),
  // Takes `coins` from a tribemate (Boo Bell).
  z.object({ kind: z.literal("steal"), coins: z.number().int().positive() }).strict(),
]);
export type ItemEffect = z.infer<typeof ItemEffectSchema>;

export const ShopItemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    price: z.number().int().nonnegative(),
    description: z.string().optional(),
    sprite: z.string().optional(),
    effect: ItemEffectSchema,
  })
  .strict();
export type ShopItem = z.infer<typeof ShopItemSchema>;

// Event spaces: landing draws one event at random by weight (0 turns an event off).
const EventWeight = z.number().nonnegative();
export const EventsSchema = z
  .object({
    // Pick a tribemate; take one of these percentages (rolled at random) of their coins.
    coinSteal: z.object({ weight: EventWeight, percents: z.array(z.number().int().min(0).max(100)).min(1) }).strict(),
    // Pay `price` coins to take one star from a tribemate who has one.
    starSteal: z.object({ weight: EventWeight, price: z.number().int().nonnegative() }).strict(),
    // Trade board positions with any tribemate.
    swap: z.object({ weight: EventWeight }).strict(),
  })
  .strict();
export type EventsConfig = z.infer<typeof EventsSchema>;
export type EventKind = keyof EventsConfig;

export const SeasonConfigSchema = z
  .object({
    timezone: z.string(),
    coins: z
      .object({
        starting: z.number().int().nonnegative(),
        blue: z.number().int(),
        red: z.number().int(),
        green: z.number().int(),
        // Coins can never go below this.
        floor: z.number().int(),
      })
      .strict(),
    star: z
      .object({
        price: z.number().int().nonnegative(),
        // Space types the star may move to after it's bought.
        spawnOn: z.array(SpaceTypeSchema).min(1),
      })
      .strict(),
    dice: z.object({ min: z.number().int(), max: z.number().int() }).strict(),
    turns: z
      .object({
        cooldownHours: HoursSchema,
        windowHours: HoursSchema,
        firstTurnUnlimited: z.boolean(),
        // How long a fork/shop/star prompt waits before the default is taken.
        choiceTimeoutMinutes: z.number().positive(),
      })
      .strict(),
    shop: z
      .object({
        maxPerVisit: z.number().int().positive(),
        // Most items a player can carry.
        bagSize: z.number().int().positive(),
        items: z.array(ShopItemSchema),
        // Shop stock by variant; shop spaces name theirs (spaces[].shop). A shop
        // space with no variant sells every item.
        variants: z.record(z.object({ name: z.string(), colour: z.string(), items: z.array(z.string()) }).strict()).default({}),
        // Each board's tribe advantage, sold in every shop on that board, once per
        // board. Buying it doesn't go in the bag; the hosts get pinged instead.
        advantage: z
          .object({
            price: z.number().int().nonnegative(),
            perBoard: z.record(z.object({ name: z.string(), image: z.string(), description: z.string().optional() }).strict()),
          })
          .strict()
          .optional(),
      })
      .strict(),
    events: EventsSchema,
    boards: z.array(BoardInstanceSchema).min(1),
    redemptionIsland: z
      .object({
        channelId: SnowflakeSchema,
        layout: z.string().nullable(),
        // Coins a player is reset to on arrival (stars and items always reset to none).
        resetCoins: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .refine((c) => c.dice.min <= c.dice.max, { message: "dice.min must be <= dice.max" });
export type SeasonConfig = z.infer<typeof SeasonConfigSchema>;
