import { afterEach } from "vitest";
import { createStorage } from "../src/storage.js";
import { createFixture, removeTempDirs, type Fixture, type FixtureOptions } from "./helpers.js";

/** Register cleanup of every fixture created through `setup` after each test. */
export function useStorageFixtures() {
  const fixtures: Fixture[] = [];
  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
    await removeTempDirs();
  });
  return async function setup(options?: FixtureOptions) {
    const fixture = await createFixture(options);
    fixtures.push(fixture);
    return { fixture, storage: createStorage(fixture.host.zcc) };
  };
}

export type TestStorage = ReturnType<typeof createStorage>;

/** Poll until the machine's scan has finished (or failed). */
export async function waitForScan(storage: TestStorage, hostId = "host_a") {
  let response = await storage.host({ hostId });
  for (let attempt = 0; attempt < 600 && response.scan.state === "scanning"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    response = await storage.host({ hostId });
  }
  return response;
}

export async function scan(storage: TestStorage, hostId = "host_a") {
  await storage.scanHost({ hostId });
  return waitForScan(storage, hostId);
}

/** Poll a machine's response until `done` accepts it. */
export async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let value = await read();
  for (let attempt = 0; attempt < 600 && !done(value); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    value = await read();
  }
  return value;
}

export const HOUR = 3_600_000;
export const trashName = (a: string, b: string) => `.zcc-trash-${a}-${b}`;
