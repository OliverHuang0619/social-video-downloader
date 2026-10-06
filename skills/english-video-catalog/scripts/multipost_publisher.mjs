#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";
import { multipostInjectors } from "./multipost/injectors.mjs";
import { buildSyncData, publishMediaUrls, resolveMediaFulfillment, videoContentType } from "./multipost/media.mjs";
import { classifyPublishOutcome, detectChallenge, detectLogin } from "./multipost/outcome.mjs";

const command = process.argv[2] || "";
const argument = process.argv[3] || "";
const profileDir = process.env.DOUYIN_PROFILE_DIR || path.join(process.env.HOME || ".", ".config", "english-video-catalog", "douyin-profile");
const cdpUrl = process.env.DOUYIN_CDP_URL || "";
const cdpToken = process.env.DOUYIN_CDP_TOKEN || "";

function emit(event, data = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...data })}\n`);
}

async function launch() {
  if (cdpUrl) {
    const browser = await chromium.connectOverCDP(cdpUrl, {
      ...(cdpToken ? { headers: { authorization: `Bearer ${cdpToken}` } } : {}),
      noDefaults: true,
    });
    const context = browser.contexts()[0];
    if (!context) throw new Error("远程 Chromium 未提供持久浏览器上下文");
    return { context, remote: true };
  }
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1440, height: 960 },
    args: ["--start-maximized"],
  });
  return { context, remote: false };
}

async function disconnect(context, remote) {
  if (!remote) {
    await context.close().catch(() => undefined);
    return;
  }
  await context.browser()?.close().catch(() => undefined);
}

async function screenshot(page, artifactDir, jobId) {
  if (!page || !artifactDir) return undefined;
  fs.mkdirSync(artifactDir, { recursive: true });
  const file = path.join(artifactDir, `${jobId}.png`);
  try {
    await page.screenshot({ path: file });
    return file;
  } catch {
    return undefined;
  }
}

async function pageText(page) {
  return page.locator("body").innerText({ timeout: 8000 }).catch(() => "");
}

async function hasFileInput(page) {
  return page.locator('input[type="file"]').count().then(count => count > 0).catch(() => false);
}

async function openLogin(homeUrl) {
  if (!/^https?:\/\//.test(homeUrl)) throw new Error("登录地址无效");
  const { context, remote } = await launch();
  const page = await context.newPage();
  emit("launching");
  await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  emit("login_opened", { url: page.url() });
  if (remote) {
    await disconnect(context, true);
    return;
  }
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline && !page.isClosed()) await page.waitForTimeout(1000);
  await disconnect(context, false);
}

async function publish(payloadPath) {
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  const injector = multipostInjectors[payload.platform];
  if (!injector) throw new Error(`未知发布平台：${payload.platform || ""}`);
  if (!payload.injectUrl || !payload.file) throw new Error("发布载荷缺少上传页或视频文件");
  const urls = publishMediaUrls(payload.jobId || "job");
  const files = {
    videoUrl: urls.videoUrl,
    videoPath: payload.file,
    videoType: videoContentType(payload.file),
    ...(payload.coverFile ? { coverUrl: urls.coverUrl, coverPath: payload.coverFile, coverType: "image/jpeg" } : {}),
  };
  const { context, remote } = await launch();
  const page = await context.newPage();
  page.setDefaultTimeout(15 * 60 * 1000);
  const logs = [];
  page.on("console", message => logs.push(message.text()));
  try {
    await page.route("https://svd.local/publish/**", route => {
      const match = resolveMediaFulfillment(route.request().url(), files);
      if (!match) return route.abort();
      return route.fulfill({ path: match.path, contentType: match.contentType });
    });
    emit("launching");
    await page.goto(payload.injectUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    const body = await pageText(page);
    const fileInput = await hasFileInput(page);
    const challenge = detectChallenge(body);
    if (challenge) {
      const shot = await screenshot(page, payload.artifactDir, payload.jobId);
      emit("error", { message: `MANUAL_REVIEW_REQUIRED：页面提示“${challenge}”，自动发布已暂停，请在可见浏览器中人工处理`, screenshot: shot });
      return;
    }
    if (detectLogin({ url: page.url(), body, hasFileInput: fileInput })) {
      const shot = await screenshot(page, payload.artifactDir, payload.jobId);
      emit("error", { message: "LOGIN_REQUIRED：请先在发布浏览器中登录该平台", screenshot: shot });
      return;
    }
    emit("uploading");
    let evaluateError = "";
    try {
      await page.evaluate(injector, buildSyncData({ ...payload, videoType: files.videoType }, urls));
    } catch (error) {
      evaluateError = error instanceof Error ? error.message : String(error);
    }
    if (evaluateError) logs.push(`发布过程中出错: ${evaluateError}`);
    await page.waitForTimeout(1500);
    const outcome = classifyPublishOutcome({
      url: page.url(),
      body: await pageText(page),
      logs,
      scheduled: Boolean(payload.publishAt),
      hasFileInput: await hasFileInput(page),
    });
    const shot = await screenshot(page, payload.artifactDir, payload.jobId);
    if (outcome.event === "error") emit("error", { message: outcome.message, screenshot: shot });
    else emit(outcome.event, { screenshot: shot });
  } finally {
    await page.close().catch(() => undefined);
    await disconnect(context, remote);
  }
}

try {
  if (command === "login") await openLogin(argument);
  else if (command === "publish") await publish(argument);
  else throw new Error("用法：multipost_publisher.mjs login <url> | publish <payload.json>");
} catch (error) {
  emit("error", { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
