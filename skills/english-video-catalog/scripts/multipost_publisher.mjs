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

async function pageNotices(page) {
  if (page.isClosed()) return [];
  const selectors = '[role="alert"], [role="status"], [aria-live="polite"], [class*="toast"], [class*="Toast"], [class*="message"], [class*="Message"], [class*="notification"], [class*="Notification"]';
  const notices = [];
  for (const frame of page.frames()) {
    const values = await frame.locator(selectors).allInnerTexts().catch(() => []);
    for (const value of values) {
      const text = String(value).replace(/\s+/g, ' ').trim();
      if (text && !notices.includes(text)) notices.push(text);
      if (notices.length >= 30) return notices;
    }
  }
  return notices;
}

async function hasFileInput(page) {
  return page.locator('input[type="file"]').count().then(count => count > 0).catch(() => false);
}

async function observePage(page) {
  if (page.isClosed()) return { url: "", body: "", hasFileInput: false };
  const [body, notices, fileInput] = await Promise.all([pageText(page), pageNotices(page), hasFileInput(page)]);
  return { url: page.url(), body, notices, hasFileInput: fileInput };
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

async function selectBilibiliRecommendedCover(page) {
  // The upload form is rendered asynchronously after Bilibili finishes transcoding.
  // Wait for its actual recommendation section instead of treating an early blank form as failure.
  const ready = await page.waitForFunction(() => {
    const visible = element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
    };
    return Array.from(document.querySelectorAll("body *")).some(element =>
      element.children.length <= 2 && /以下为系统推荐封面/.test(element.innerText || element.textContent || "") && visible(element));
  }, { timeout: 90000 }).then(() => true).catch(() => false);
  if (!ready) return { selected: false, reason: "视频上传后 90 秒仍未显示系统推荐封面区域" };

  const targets = await page.evaluate(() => {
    const visible = element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
    };
    const headings = Array.from(document.querySelectorAll("body *")).filter(element =>
      element.children.length <= 2 && /以下为系统推荐封面/.test(element.innerText || element.textContent || "") && visible(element));
    headings.sort((a, b) => (a.innerText || a.textContent || "").length - (b.innerText || b.textContent || "").length);
    const heading = headings[0];
    if (!heading) return { points: [], reason: "未能定位系统推荐封面标题" };
    const headingRect = heading.getBoundingClientRect();
    const visuals = Array.from(document.querySelectorAll("img, canvas, div.img-item-box.img-item-cover, [style*='background-image']"))
      .filter(element => {
        const rect = element.getBoundingClientRect();
        if (!visible(element) || rect.width < 100 || rect.height < 60 || rect.top < headingRect.bottom - 4 || rect.top > headingRect.bottom + 500) return false;
        // Exclude the AI-generation tile itself while retaining recommended thumbnails beside it.
        for (let node = element; node && node !== heading.parentElement; node = node.parentElement) {
          const rect = node.getBoundingClientRect();
          if (/AI生成/.test(node.innerText || node.textContent || "") && rect.width <= 500 && rect.height <= 350 && rect.width <= element.getBoundingClientRect().width * 2.5) return false;
        }
        return true;
      });
    visuals.sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return ar.top - br.top || ar.left - br.left;
    });
    const points = [];
    const seen = new Set();
    for (const visual of visuals) {
      const rect = visual.getBoundingClientRect();
      const key = `${Math.round(rect.left / 10)}:${Math.round(rect.top / 10)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      if (points.length === 3) break;
    }
    return { points, reason: points.length ? "" : "推荐封面标题已出现，但未找到推荐封面图片卡片" };
  });

  for (const candidate of targets.points) {
    await page.mouse.click(candidate.x, candidate.y);
    await page.waitForTimeout(1200);
    const selected = await page.evaluate(() => {
      const cover = document.querySelector("div.cover-main");
      if (!cover) return false;
      const hasImage = Array.from(cover.querySelectorAll("img")).some(image => {
        const rect = image.getBoundingClientRect();
        return rect.width >= 60 && rect.height >= 60 && Boolean(image.currentSrc || image.src) && !/placeholder|empty|default/i.test(image.currentSrc || image.src);
      });
      const hasBackground = Array.from(cover.querySelectorAll("div, span")).some(element => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 60 && rect.height >= 60 && getComputedStyle(element).backgroundImage !== "none";
      });
      const placeholderVisible = Array.from(cover.querySelectorAll("* > *")).some(element => {
        if (!/添加封面/.test(element.textContent || "")) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
      return (hasImage || hasBackground) && !placeholderVisible;
    });
    if (selected) return { selected: true };
  }
  return { selected: false, reason: targets.reason || "已点击推荐卡片位置，但封面预览仍为空" };
}

async function fieldRowContains(page, label, value) {
  return page.evaluate(({ label, value }) => {
    const normalize = text => String(text || "").replace(/[＊*]/g, "").replace(/\s+/g, "").trim();
    const visible = element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const labels = Array.from(document.querySelectorAll("body *")).filter(element =>
      normalize(element.innerText || element.textContent) === normalize(label) && visible(element));
    labels.sort((a, b) => (a.innerText || a.textContent || "").length - (b.innerText || b.textContent || "").length || a.children.length - b.children.length);
    const labelElement = labels[0];
    if (!labelElement) return false;
    const labelRect = labelElement.getBoundingClientRect();
    for (let row = labelElement.parentElement, depth = 0; row && depth < 6; row = row.parentElement, depth++) {
      const controls = Array.from(row.querySelectorAll("input, button, [role='combobox'], div")).filter(control => {
        if (!visible(control)) return false;
        const rect = control.getBoundingClientRect();
        return rect.width >= 100 && rect.width <= 700 && rect.height >= 30 && rect.height <= 90 &&
          rect.left >= labelRect.right - 8 && rect.top < labelRect.bottom + 24 && rect.bottom > labelRect.top - 24;
      });
      controls.sort((a, b) => {
        const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
        return Math.abs(ar.top - labelRect.top) - Math.abs(br.top - labelRect.top) || ar.left - br.left || ar.width * ar.height - br.width * br.height;
      });
      const control = controls[0];
      if (!control) continue;
      const displayedValue = control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement
        ? control.value || control.placeholder
        : control.getAttribute("aria-valuetext") || control.getAttribute("aria-label") || control.innerText || control.textContent;
      return normalize(displayedValue) === normalize(value);
    }
    return false;
  }, { label, value });
}

async function clickVisibleText(page, text, exact = true) {
  for (const frame of [...page.frames()].reverse()) {
    const matches = frame.getByText(text, { exact });
    for (let index = await matches.count() - 1; index >= 0; index--) {
      const candidate = matches.nth(index);
      const actuallyVisible = await candidate.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
      }).catch(() => false);
      if (actuallyVisible) {
        await candidate.click({ timeout: 5000 });
        return true;
      }
    }
    const point = await frame.evaluate(({ search, exact }) => {
      const normalize = value => String(value || "").replace(/\s+/g, "").trim();
      const visible = element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
      };
      const candidates = Array.from(document.querySelectorAll("body *")).filter(element => {
        const content = normalize(element.innerText || element.textContent);
        return visible(element) && (exact ? content === normalize(search) : content.includes(normalize(search))) && content.length <= 120;
      });
      candidates.sort((a, b) => {
        const at = normalize(a.innerText || a.textContent);
        const bt = normalize(b.innerText || b.textContent);
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return at.length - bt.length || ar.width * ar.height - br.width * br.height;
      });
      const target = candidates[0];
      if (!target) return null;
      target.scrollIntoView({ block: "center", inline: "nearest" });
      const rect = target.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, { search: text, exact });
    if (point) {
      let x = point.x;
      let y = point.y;
      if (frame !== page.mainFrame()) {
        const frameBox = await frame.frameElement().then(element => element.boundingBox()).catch(() => null);
        if (!frameBox) continue;
        x += frameBox.x;
        y += frameBox.y;
      }
      await page.mouse.click(x, y).catch(() => undefined);
      return true;
    }
  }
  return false;
}

async function selectBilibiliNativeOption(page, label, option) {
  for (const frame of page.frames()) {
    const index = await frame.locator("select").evaluateAll((selects, expectedLabel) => {
      const normalize = value => String(value || "").replace(/[＊*]/g, "").replace(/\s+/g, "").trim();
      return selects.findIndex(select => {
        let row = select;
        for (let depth = 0; row && depth < 6; depth++, row = row.parentElement) {
          if (normalize(row.innerText || row.textContent).includes(normalize(expectedLabel))) return true;
        }
        return false;
      });
    }, label).catch(() => -1);
    if (index < 0) continue;
    try {
      await frame.locator("select").nth(index).selectOption({ label: option }, { timeout: 3000 });
      return true;
    } catch {
      // Custom controls are handled through their visible label and option below.
    }
  }
  return false;
}

async function clickBilibiliFieldByLabel(page, label) {
  const point = await page.evaluate(labelText => {
    const normalize = text => String(text || "").replace(/[＊*]/g, "").replace(/\s+/g, "").trim();
    const isVisible = element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const labels = Array.from(document.querySelectorAll("body *")).filter(element =>
      normalize(element.innerText || element.textContent) === normalize(labelText) && isVisible(element));
    labels.sort((a, b) => (a.innerText || a.textContent || "").length - (b.innerText || b.textContent || "").length || a.children.length - b.children.length);
    const label = labels[0];
    if (!label) return null;
    const labelRect = label.getBoundingClientRect();
    for (let row = label.parentElement, depth = 0; row && depth < 6; row = row.parentElement, depth++) {
      const controls = Array.from(row.querySelectorAll("div, input, button, [role='combobox']")).filter(control => {
        if (!isVisible(control)) return false;
        const rect = control.getBoundingClientRect();
        return rect.width >= 100 && rect.height >= 30 && rect.left >= labelRect.right - 8 && rect.top < labelRect.bottom + 24 && rect.bottom > labelRect.top - 24;
      });
      controls.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      if (controls[0]) {
        const rect = controls[0].getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    return null;
  }, label);
  if (!point) return false;
  await page.mouse.click(point.x, point.y);
  return true;
}

async function prepareBilibiliUploadPage(page) {
  const isUploadReady = async () => {
    if (!(await hasFileInput(page))) return false;
    const body = await pageText(page);
    return body.includes("上传视频") || body.includes("点击上传");
  };
  const recoveryPattern = /本地浏览器存在\s*\d+\s*个未提交的视频/;
  let body = await pageText(page);
  const initialReady = await isUploadReady();
  if (initialReady && !recoveryPattern.test(body)) return { ok: true };
  // A new tab first shows a skeleton screen; wait for the creator-center navigation
  // before clicking 投稿, then wait for the uploader and any draft recovery prompt.
  if (!initialReady && !recoveryPattern.test(body)) {
    const nav = page.getByText("投稿", { exact: true }).last();
    try {
      await nav.waitFor({ state: "visible", timeout: 90000 });
    } catch {
      return { ok: false, reason: "B站创作中心一直停留在骨架加载页，未出现投稿入口" };
    }
    await nav.click({ timeout: 10000 });
  }

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && !page.isClosed()) {
    body = await pageText(page);
    if (recoveryPattern.test(body)) {
      const dismissRecovery = page.locator(".tip-btn-group > div").filter({ hasText: /^\s*不用了\s*$/ });
      if (await dismissRecovery.isVisible().catch(() => false)) {
        await dismissRecovery.click({ timeout: 10000 });
        await page.getByText(recoveryPattern).waitFor({ state: "hidden", timeout: 10000 }).catch(() => undefined);
        body = await pageText(page);
        if (recoveryPattern.test(body)) return { ok: false, reason: "未能关闭 B 站未提交视频恢复提示" };
      }
    }
    if (await isUploadReady() && !recoveryPattern.test(body)) return { ok: true };
    await page.waitForTimeout(1000);
  }
  return { ok: false, reason: "等待 90 秒后仍未出现 B站上传视频区域" };
}

async function setBilibiliRequiredMetadata(page) {
  const statement = "含AI生成内容";
  const statementInput = page.locator(".creation-statement-container .bcc-select-input-inner");
  const currentStatement = () => statementInput.evaluate(input => input.value).catch(() => "");
  if (await currentStatement() !== statement) {
    await page.locator(".creation-statement-container .bcc-select-input-wrap").click({ timeout: 10000 }).catch(() => undefined);
    const option = page.locator(".creation-statement-container .bcc-select-option-list li").filter({ hasText: new RegExp(`^${statement}$`) });
    try {
      await option.waitFor({ state: "visible", timeout: 5000 });
      await option.click({ timeout: 10000 });
      await page.waitForFunction(expected => document.querySelector(".creation-statement-container .bcc-select-input-inner")?.value === expected, statement, { timeout: 5000 });
    } catch {
      return { ok: false, reason: "创作声明选项中未能选择“含AI生成内容”" };
    }
  }
  if (await currentStatement() !== statement) {
    return { ok: false, reason: "未能确认创作声明已选择“含AI生成内容”" };
  }

  const partition = "动画";
  const partitionController = page.locator(".video-human-type .select-controller");
  const currentPartition = () => partitionController.innerText({ timeout: 5000 }).then(text => text.replace(/\s+/g, "").trim()).catch(() => "");
  if (await currentPartition() !== partition) {
    await partitionController.click({ timeout: 10000 }).catch(() => undefined);
    const option = page.locator(".video-human-type .drop-list-v2-item[title=\"动画\"]");
    try {
      await option.waitFor({ state: "visible", timeout: 5000 });
      await option.click({ timeout: 10000 });
      await page.waitForFunction(expected => document.querySelector(".video-human-type .select-controller")?.innerText.replace(/\s+/g, "").trim() === expected, partition, { timeout: 5000 });
    } catch {
      return { ok: false, reason: "分区选项中未能选择“动画”" };
    }
  }
  if (await currentPartition() !== partition) {
    return { ok: false, reason: "未能确认分区已选择“动画”" };
  }
  return { ok: true };
}

async function submitBilibili(page, logs) {
  const cover = await selectBilibiliRecommendedCover(page);
  if (!cover.selected) {
    logs.push(`PUBLISH_FAILED：B站未能选择系统推荐封面（${cover.reason}）`);
    return false;
  }
  const metadata = await setBilibiliRequiredMetadata(page);
  if (!metadata.ok) {
    logs.push(`PUBLISH_FAILED：B站必填信息未完成（${metadata.reason}）`);
    return false;
  }
  try {
    await page.locator("span.submit-add").click({ timeout: 10000 });
    logs.push("B站已确认推荐封面、创作声明和动画分区，并点击发布");
    return true;
  } catch (error) {
    logs.push(`PUBLISH_FAILED：已选封面，但未能点击发布按钮（${error instanceof Error ? error.message : error}）`);
    return false;
  }
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
    if (payload.platform === "VIDEO_BILIBILI") {
      const prepared = await prepareBilibiliUploadPage(page);
      if (!prepared.ok) {
      keepPage = remote;
      const shot = await screenshot(page, payload.artifactDir, payload.jobId);
        emit("error", { message: `PUBLISH_FAILED：${prepared.reason}`, screenshot: shot });
      return;
      }
    }
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
    if (payload.platform === "VIDEO_BILIBILI") {
      sync.deferSubmitToPublisher = true;
      sync.isAutoPublish = false;
    }
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
    if (payload.platform === "VIDEO_BILIBILI" && payload.isAutoPublish !== false) {
      const submitted = await submitBilibili(page, logs);
      if (!submitted) keepPage = remote;
    }
    const outcome = await waitForPublishOutcome({
      getState: () => observePage(page),
      wait: milliseconds => page.waitForTimeout(milliseconds),
      isClosed: () => page.isClosed(),
      logs,
      scheduled: Boolean(payload.publishAt),
      expectedMarker: payload.platform === "VIDEO_WEIXINCHANNEL" ? sync.data.content || sync.data.title || payload.title : "",
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
