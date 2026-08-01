/**
 * JSON column helpers
 *
 * Prisma's `Json` columns accept `Prisma.InputJsonValue`, which application
 * code rarely holds naturally — so the tempting shortcut is
 * `value as Prisma.InputJsonValue` (or, worse, `value as unknown as ...`).
 * That cast is a lie: it silences the compiler without establishing that the
 * value is actually serialisable, so `undefined`, `Date`, `Decimal`, class
 * instances or cyclic references reach the driver and fail at runtime.
 *
 * These helpers do the conversion for real.
 */

import { Prisma } from '@prisma/client';

/**
 * Normalises any value into something Prisma can store in a `Json` column.
 *
 * The value is round-tripped through `JSON.stringify`/`JSON.parse`, which is
 * exactly the transformation the database driver would apply anyway — but here
 * it happens eagerly, so non-serialisable input fails fast and with a useful
 * message. `undefined` properties, functions and symbols are dropped; `Date`
 * and `Prisma.Decimal` collapse to their `toJSON()` form.
 *
 * @throws {TypeError} if the value cannot be represented as JSON (cycles,
 *   `BigInt`) or serialises to a bare `null`/`undefined` — use
 *   {@link toNullableInputJson} when a JSON `null` is a legitimate value.
 */
export function toInputJson(value: unknown): Prisma.InputJsonValue {
  const json = serialise(value);

  if (json === undefined) {
    throw new TypeError(
      'Value serialises to JSON null or undefined; use toNullableInputJson() if that is intended',
    );
  }

  return json;
}

/**
 * Same as {@link toInputJson}, but maps "no value" onto `Prisma.JsonNull` —
 * the sentinel Prisma requires to write a JSON `null` (as opposed to
 * `Prisma.DbNull`, which writes a SQL `NULL`).
 */
export function toNullableInputJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return serialise(value) ?? Prisma.JsonNull;
}

/**
 * Returns the normalised JSON form of `value`, or `undefined` when it has no
 * JSON representation other than `null`.
 */
function serialise(value: unknown): Prisma.InputJsonValue | undefined {
  let serialised: string | undefined;

  try {
    serialised = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(
      `Value is not JSON-serialisable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // `JSON.stringify` returns undefined for undefined/function/symbol input.
  if (serialised === undefined || serialised === 'null') return undefined;

  // Safe by construction: parsing the output of `JSON.stringify` always yields
  // a JSON value, and every non-null JSON value is a `Prisma.InputJsonValue`.
  // This is the one place in the codebase where that assertion is made.
  return JSON.parse(serialised) as Prisma.InputJsonValue;
}
