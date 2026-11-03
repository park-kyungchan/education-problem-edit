import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** One reservation, one directory, exclusive-create artifacts. Never overwrite
 * another endpoint attempt or replace a successful response with an error. */
export async function createReservationReceiptStore(root: string, reservationId: string) {
  if (!/^res_[a-zA-Z0-9-]+$/.test(reservationId)) throw new Error("INVALID_RECEIPT_RESERVATION_ID");
  const directory = join(root, reservationId);
  await mkdir(directory, {recursive: true});
  return {
    directory,
    manifestPath: join(directory, "request-manifest.json"),
    responsePath: join(directory, "response.json"),
    failurePath: join(directory, "failure.json"),
  };
}

export async function writeReceiptExclusive(path: string, json: string) {
  await writeFile(path, json, {encoding: "utf8", flag: "wx"});
}
