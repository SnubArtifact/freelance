import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { openImageStore, supabaseHeaders } from "../images.js";

test("new Supabase secret keys go in apikey only; older JWT keys also in Authorization", () => {
  assert.deepEqual(supabaseHeaders("sb_secret_abc"), { apikey: "sb_secret_abc" });
  assert.deepEqual(supabaseHeaders("eyJhbGciOi.jwt"), {
    apikey: "eyJhbGciOi.jwt",
    Authorization: "Bearer eyJhbGciOi.jwt",
  });
});

// A stand-in for Supabase Storage that records what it receives.
async function fakeSupabase(t, { bucketExists = false, uploadStatus = 200 } = {}) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    calls.push({ method: req.method, path: req.url, headers: req.headers, body });
    const reply = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (req.method === "GET" && req.url.startsWith("/storage/v1/bucket/")) {
      return bucketExists ? reply(200, { id: "sarees" }) : reply(400, { error: "Bucket not found" });
    }
    if (req.method === "POST" && req.url === "/storage/v1/bucket") return reply(200, { name: "sarees" });
    if (req.method === "POST" && req.url.startsWith("/storage/v1/object/")) {
      return uploadStatus === 200
        ? reply(200, { Key: req.url.slice("/storage/v1/object/".length) })
        : reply(uploadStatus, { message: "new row violates row-level security policy" });
    }
    if (req.method === "DELETE") return reply(200, [{ name: "x" }]);
    reply(404, { error: "unexpected" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return { calls, url: `http://127.0.0.1:${server.address().port}` };
}

test("Supabase: creates the public bucket once, uploads, and returns the public URL", async (t) => {
  const { calls, url } = await fakeSupabase(t);
  const photos = openImageStore({ supabaseUrl: `${url}/`, supabaseKey: "sb_secret_KEY" });
  assert.equal(photos.kind, "supabase");

  const first = await photos.save({ buffer: Buffer.from("jpeg bytes"), mimetype: "image/jpeg", originalname: "Saree.JPG" });
  await photos.save({ buffer: Buffer.from("png"), mimetype: "image/png", originalname: "b.png" });

  assert.match(first, new RegExp(`^${url}/storage/v1/object/public/sarees/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.jpg$`));
  const [lookup, create, upload] = calls;
  assert.equal(lookup.method, "GET");
  assert.equal(create.path, "/storage/v1/bucket");
  const bucket = JSON.parse(create.body);
  assert.equal(bucket.public, true);
  assert.deepEqual(bucket.allowed_mime_types, ["image/*"]);
  assert.equal(upload.headers.apikey, "sb_secret_KEY");
  assert.equal(upload.headers.authorization, undefined);
  assert.equal(upload.headers["content-type"], "image/jpeg");
  assert.equal(upload.body.toString(), "jpeg bytes");
  assert.equal(calls.filter((c) => c.path === "/storage/v1/bucket").length, 1, "bucket created only once");
});

test("Supabase: deletes only this shop's photos", async (t) => {
  const { calls, url } = await fakeSupabase(t, { bucketExists: true });
  const photos = openImageStore({ supabaseUrl: url, supabaseKey: "sb_secret_KEY" });
  const ours = await photos.save({ buffer: Buffer.from("x"), mimetype: "image/png", originalname: "a.png" });

  await photos.remove(ours);
  await photos.remove("https://images.unsplash.com/photo-1");
  await photos.remove(`${url}/storage/v1/object/public/sarees/../other/secret.png`);

  const deletes = calls.filter((c) => c.method === "DELETE");
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].path, "/storage/v1/object/sarees");
  assert.deepEqual(JSON.parse(deletes[0].body).prefixes, [ours.split("/public/sarees/")[1]]);
});

test("Supabase: a refused upload is reported, not saved as a broken photo", async (t) => {
  const { url } = await fakeSupabase(t, { bucketExists: true, uploadStatus: 403 });
  const photos = openImageStore({ supabaseUrl: url, supabaseKey: "eyJ.legacy.jwt" });
  await assert.rejects(
    photos.save({ buffer: Buffer.from("x"), mimetype: "image/png", originalname: "a.png" }),
    /Supabase Storage upload failed: new row violates row-level security policy/
  );
});

test("local photos are saved in the upload folder and only its own files are deleted", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "photos-"));
  const outside = `${dir}-keep.txt`;
  fs.writeFileSync(outside, "keep");
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  });
  const photos = openImageStore({ uploadDir: dir });
  assert.equal(photos.kind, "local");

  const url = await photos.save({ buffer: Buffer.from("x"), originalname: "Photo.PNG" });
  assert.match(url, /^\/uploads\/[0-9a-f-]{36}\.png$/);
  const file = path.join(dir, path.basename(url));
  assert.ok(fs.existsSync(file));

  await photos.remove(`/uploads/../${path.basename(outside)}`);
  assert.ok(fs.existsSync(outside), "must never delete outside the upload folder");

  await photos.remove(url);
  assert.ok(!fs.existsSync(file));

  assert.match(await photos.save({ buffer: Buffer.from("x"), originalname: "evil.<script>" }), /\.jpg$/);
});
