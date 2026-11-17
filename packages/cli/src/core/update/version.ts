/** Owns the version decoder and semver comparison used by update. */
import { Schema } from "effect";

/** npm versions accepted at the registry boundary and for the running package. */
export const Version = Schema.String.check(
  Schema.isPattern(/^\d{1,9}\.\d{1,9}\.\d{1,9}(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/),
  Schema.isMaxLength(64),
);

function order(left: string | bigint, right: string | bigint): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Compare numeric identifiers numerically and sort them before words. */
function identifierOrder(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return order(BigInt(left), BigInt(right));
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return order(left, right);
}

/** An absent tag is a release and sorts after any prerelease. A tag that is a prefix sorts first. */
function prereleaseOrder(left: string | undefined, right: string | undefined): number {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  const leftIds = left.split(".");
  const rightIds = right.split(".");
  for (let index = 0; index < Math.max(leftIds.length, rightIds.length); index++) {
    const leftId = leftIds[index];
    const rightId = rightIds[index];
    if (leftId === undefined) return -1;
    if (rightId === undefined) return 1;
    const compared = identifierOrder(leftId, rightId);
    if (compared !== 0) return compared;
  }
  return 0;
}

function splitVersion(version: string) {
  const dash = version.indexOf("-");
  return {
    numbers: (dash < 0 ? version : version.slice(0, dash)).split("."),
    prerelease: dash < 0 ? undefined : version.slice(dash + 1),
  };
}

export function compareVersions(left: string, right: string): number {
  const leftParts = splitVersion(left);
  const rightParts = splitVersion(right);
  for (let index = 0; index < 3; index++) {
    const compared = order(
      BigInt(leftParts.numbers[index] ?? "0"),
      BigInt(rightParts.numbers[index] ?? "0"),
    );
    if (compared !== 0) return compared;
  }
  return prereleaseOrder(leftParts.prerelease, rightParts.prerelease);
}
