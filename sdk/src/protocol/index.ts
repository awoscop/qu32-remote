export * from "./catalog.js";
export * from "./db.js";
export * from "./encode.js";
export * from "./parse.js";
export * from "./commands.js";

/** Canonical key for a parameter value in the state map. */
export const paramKey = (ch: number, id: number, vx: number): string => `${ch}:${id}:${vx}`;
