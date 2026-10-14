import { z } from "zod";

// Space types the engine understands. "star" is not a space type: the star sits on
// a blue space and moves at runtime. Each board's starting star space is set in
// season-config.json (boards[].starStart).
export const SpaceTypeSchema = z.enum(["blue", "red", "green", "shop", "bowser", "start"]);
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
    // True if passing (not only landing) triggers the space, e.g. shops. Bowser
    // spaces trigger on landing only.
    passEffect: z.boolean().optional(),
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
        maxPerPrompt: z.number().int().positive(),
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
      })
      .strict(),
    boards: z.array(BoardInstanceSchema).min(1),
    redemptionIsland: z
      .object({ channelId: SnowflakeSchema, layout: z.string().nullable() })
      .strict(),
  })
  .strict()
  .refine((c) => c.dice.min <= c.dice.max, { message: "dice.min must be <= dice.max" });
export type SeasonConfig = z.infer<typeof SeasonConfigSchema>;
