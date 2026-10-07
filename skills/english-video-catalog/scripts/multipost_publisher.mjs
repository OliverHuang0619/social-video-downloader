#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";
import { multipostInjectors } from "./multipost/injectors.mjs";
import { buildSyncData, isPublishMediaRequest, isWeixinMediaSuiteWasm, publishMediaUrls, resolveMediaFulfillment, videoContentType } from "./multipost/media.mjs";
import { detectChallenge, detectLogin, waitForPublishOutcome } from "./multipost/outcome.mjs";

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
  const parts = [];
  for (const frame of page.frames()) {
    const text = await frame.locator("body").innerText({ timeout: 2000 }).catch(() => "");
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

async function hasFileInput(page) {
  return page.locator('input[type="file"]').count().then(count => count > 0).catch(() => false);
}

async function observePage(page) {
  if (page.isClosed()) return { url: "", body: "", hasFileInput: false };
  return { url: page.url(), body: await pageText(page), hasFileInput: await hasFileInput(page) };
}

async function waitForSignal(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let state = await observePage(page);
  while (Date.now() < deadline && !page.isClosed()) {
    if (state.hasFileInput || detectLogin(state) || detectChallenge(state.body)) return state;
    await page.waitForTimeout(1000);
    state = await observePage(page);
  }
  return state;
}

function hostMatches(hostname, expectedHost) {
  return !expectedHost || hostname === expectedHost || hostname.endsWith(`.${expectedHost}`);
}

async function waitForUploadAfterLogin(page, injectUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let navigated = false;
  while (Date.now() < deadline && !page.isClosed()) {
    const state = await observePage(page);
    if (state.hasFileInput && !detectLogin(state)) return true;
    if (!detectLogin(state) && !navigated) {
      navigated = true;
      await page.goto(injectUrl, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => undefined);
      continue;
    }
    await page.waitForTimeout(1500);
  }
  return false;
}

const wasmBodies = new Map();

function weixinWasmBody(requestUrl) {
  const clean = requestUrl.split("?")[0];
  if (!wasmBodies.has(clean)) {
    wasmBodies.set(clean, fetch(clean).then(async response => {
      if (!response.ok) throw new Error(`视频号编辑器组件下载失败：${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    }));
  }
  return wasmBodies.get(clean);
}

async function installPublishRoutes(page, files) {
  await page.route(url => isWeixinMediaSuiteWasm(url.href), async route => {
    try {
      const body = await weixinWasmBody(route.request().url());
      await route.fulfill({ status: 200, contentType: "application/wasm", headers: { "access-control-allow-origin": "*" }, body });
    } catch {
      wasmBodies.delete(route.request().url().split("?")[0]);
      await route.continue().catch(() => undefined);
    }
  });
  await page.route(url => isPublishMediaRequest(url.href), async route => {
    const match = resolveMediaFulfillment(route.request().url(), files);
    if (!match) return route.abort();
    return route.fulfill({ path: match.path, contentType: match.contentType });
  });
}

function loginRequiredMessage(body, keptOpen) {
  if (keptOpen && body.includes("登录视频号助手")) {
    return "LOGIN_REQUIRED：视频号还没登录。登录页已留在发布浏览器里，请用微信扫码，完成后再点重试";
  }
  if (keptOpen) return "LOGIN_REQUIRED：请先在发布浏览器中登录该平台。登录页已保留，完成后可重试";
  return "LOGIN_REQUIRED：请先在发布浏览器中登录该平台";
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

async function checkLogin(url) {
  if (!/^https?:\/\//.test(url)) throw new Error("验证地址无效");
  const { context, remote } = await launch();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    const state = await waitForSignal(page, 20000);
    const authorized = state.hasFileInput && !detectLogin(state);
    emit("login_checked", {
      status: authorized ? "authorized" : detectLogin(state) ? "needs_login" : "unknown",
      url: state.url || page.url(),
      message: authorized ? "已检测到平台创作页面" : detectLogin(state) ? "平台仍显示登录页面" : "未能确认登录状态，请检查页面后重试",
    });
  } finally {
    await page.close().catch(() => undefined);
    await disconnect(context, remote);
  }
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
  let keepPage = false;
  page.on("console", message => logs.push(message.text()));
  try {
    await installPublishRoutes(page, files);
    emit("launching");
    await page.goto(payload.injectUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    let state = await waitForSignal(page, 20000);
    const challenge = detectChallenge(state.body);
    if (challenge) {
      const shot = await screenshot(page, payload.artifactDir, payload.jobId);
      emit("error", { message: `MANUAL_REVIEW_REQUIRED：页面提示“${challenge}”，自动发布已暂停，请在可见浏览器中人工处理`, screenshot: shot });
      return;
    }
    if (!state.hasFileInput && !detectLogin(state)) state = await waitForSignal(page, 40000);
    if (detectLogin(state)) {
      emit("waiting_login", { url: state.url });
      const ready = await waitForUploadAfterLogin(page, payload.injectUrl, 5 * 60 * 1000);
      if (!ready) {
        keepPage = remote && !page.isClosed();
        const latest = page.isClosed() ? state : await observePage(page);
        const shot = await screenshot(page, payload.artifactDir, payload.jobId);
        emit("error", { message: loginRequiredMessage(latest.body || state.body, keepPage), screenshot: shot });
        return;
      }
    }
    const finalHost = new URL(page.url()).hostname;
    if (!hostMatches(finalHost, payload.injectorHost)) {
      const shot = await screenshot(page, payload.artifactDir, payload.jobId);
      emit("error", { message: `MANUAL_REVIEW_REQUIRED：发布页域名不匹配，预期 ${payload.injectorHost}，实际 ${finalHost}`, screenshot: shot });
      return;
    }
    emit("uploading");
    const sync = buildSyncData({ ...payload, videoType: files.videoType }, urls);
    if (payload.platform === "VIDEO_WEIXINCHANNEL") {
      try {
        await page.locator('input[type="file"]').first().setInputFiles(payload.file, { timeout: 20000 });
        delete sync.data.video;
      } catch (error) {
        logs.push(`本地选择视频失败: ${error instanceof Error ? error.message : error}`);
      }
    }
    let evaluateError = "";
    try {
      await page.evaluate(injector, sync);
    } catch (error) {
      evaluateError = error instanceof Error ? error.message : String(error);
    }
    if (evaluateError) logs.push(`发布过程中出错: ${evaluateError}`);
    const outcome = await waitForPublishOutcome({
      getState: () => observePage(page),
      wait: milliseconds => page.waitForTimeout(milliseconds),
      isClosed: () => page.isClosed(),
      logs,
      scheduled: Boolean(payload.publishAt),
    });
    const body = await pageText(page);
    const shot = await screenshot(page, payload.artifactDir, payload.jobId);
    if (outcome.event === "error") {
      let message = outcome.message;
      if (message.includes("LOGIN_REQUIRED")) {
        keepPage = remote && !page.isClosed();
        message = loginRequiredMessage(body, keepPage);
      }
      emit("error", { message, screenshot: shot });
    } else emit(outcome.event, { screenshot: shot });
  } finally {
    if (!keepPage) await page.close().catch(() => undefined);
    await disconnect(context, remote);
  }
}

try {
  if (command === "login") await openLogin(argument);
  else if (command === "check-login") await checkLogin(argument);
  else if (command === "publish") await publish(argument);
  else throw new Error("用法：multipost_publisher.mjs login <url> | check-login <url> | publish <payload.json>");
} catch (error) {
  emit("error", { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
