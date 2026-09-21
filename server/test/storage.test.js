import { test } from "node:test";
import assert from "node:assert/strict";
import { checkStorage, mountPointFor } from "../storage.js";

const noDisk = [
  "overlay / overlay rw,relatime,lowerdir=/x 0 0",
  "proc /proc proc rw,nosuid 0 0",
  "tmpfs /dev tmpfs rw 0 0",
  "/dev/sda1 /etc/hosts ext4 rw 0 0",
].join("\n");
const withDisk = [
  noDisk,
  "/dev/sdb /var/data ext4 rw,relatime 0 0",
  String.raw`/dev/sdc /mnt/my\040disk ext4 rw 0 0`,
].join("\n");
const app = "/opt/render/project/src/server";

// Mirrors checkStorage's rule: kept only on a mount of its own.
const kept = (dir, mounts) => {
  const mount = mountPointFor(dir, mounts);
  return mount !== "/" && mount !== mountPointFor(app, mounts);
};

test("Render without a disk: /var/data is not kept", () => {
  assert.equal(kept("/var/data", noDisk), false);
});

test("Render with a disk at /var/data: kept, including subfolders", () => {
  assert.equal(kept("/var/data", withDisk), true);
  assert.equal(kept("/var/data/uploads", withDisk), true);
});

test("a disk is added but DATA_DIR still points inside the app: not kept", () => {
  assert.equal(kept(`${app}/data`, withDisk), false);
});

test("a look-alike path is not mistaken for the disk", () => {
  assert.equal(kept("/var/database", withDisk), false);
});

test("mount points with escaped spaces are understood", () => {
  assert.equal(mountPointFor("/mnt/my disk/photos", withDisk), "/mnt/my disk");
});

test("off Render, the local disk counts as kept", () => {
  assert.equal(checkStorage(".", ".", {}).persistent, true);
});

test("on Render, an unreadable mount table counts as not kept", () => {
  // /proc/mounts doesn't exist on Windows or macOS, which exercises this path.
  if (process.platform === "linux") return;
  assert.equal(checkStorage(".", ".", { RENDER: "true" }).persistent, false);
});
