#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const UPLOAD_URL = "https://creator.douyin.com/creator-micro/content/upload";
const MANAGE_URL = "https://creator.douyin.com/creator-micro/content/manage";
const command = process.argv[2] || "";
const payloadPath = process.argv[3] || "";
const profileDir = process.env.DOUYIN_PROFILE_DIR || path.join(process.env.HOME || ".", ".config", "english-video-catalog", "douyin-profile");
const cdpUrl = process.env.DOUYIN_CDP_URL || "";
const cdpToken = process.env.DOUYIN_CDP_TOKEN || "";
const TYPE_DELAY_MS = 35;
const ACTION_SETTLE_MS = 350;

function emit(event, data = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...data })}\n`);
}

function readPayload() {
  if (!payloadPath) return {};
  return JSON.parse(fs.readFileSync(payloadPath, "utf8"));
}

async function launch() {
  if (cdpUrl) {
    const browser = await chromium.connectOverCDP(cdpUrl, {
      ...(cdpToken ? { headers: { authorization: `Bearer ${cdpToken}` } } : {}),
      // This is a user-owned persistent Chrome profile. Keep its browser defaults so
      // Playwright does not issue Browser.setDownloadBehavior, which is unsupported
      // by some host Chrome/default-context combinations and is unnecessary here.
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

async function ensureNoVerificationChallenge(page) {
  const body = await page.locator("body").innerText().catch(() => "");
  const challenge = [
    "请完成安全验证",
    "请完成验证",
    "滑块验证",
    "验证码",
    "访问过于频繁",
    "操作过于频繁",
    "账号存在风险",
  ].find(text => body.includes(text));
  if (challenge) {
    throw new Error(`MANUAL_REVIEW_REQUIRED：抖音页面提示“${challenge}”，自动发布已暂停，请在可见浏览器中人工处理`);
  }
}

async function hasUploadInput(page, timeout = 5000) {
  try {
    await page.locator('input[type="file"]').first().waitFor({ state: "attached", timeout });
    return true;
  } catch {
    return false;
  }
}

async function hasDouyinSession(context) {
  const cookies = await context.cookies("https://creator.douyin.com");
  const sessionNames = new Set(["sessionid", "sessionid_ss", "sid_guard", "sid_tt"]);
  return cookies.some(cookie => sessionNames.has(cookie.name) && cookie.value);
}

async function ensureUploadInput(page, timeout = 90000) {
  const deadline = Date.now() + timeout;
  let openedPublish = false;
  let openedVideo = false;
  while (Date.now() < deadline) {
    if (await hasUploadInput(page, 1500)) return page.locator('input[type="file"]').first();
    const body = await page.locator("body").innerText().catch(() => "");
    if (!openedPublish && body.includes("作品发布")) {
      const entry = page.getByText("作品发布", { exact: true }).last();
      if (await entry.count()) {
        await entry.click().catch(() => {});
        openedPublish = true;
      }
    }
    if (!openedVideo && body.includes("发布视频")) {
      const video = page.getByText("发布视频", { exact: true }).last();
      if (await video.count()) {
        await video.click().catch(() => {});
        openedVideo = true;
      }
    }
    await page.waitForTimeout(1000);
  }
  return null;
}

async function login() {
  const { context, remote } = await launch();
  const page = await context.newPage();
  emit("login_opened", { url: UPLOAD_URL });
  await page.goto(UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  if (await hasDouyinSession(context)) {
    emit("login_ready");
    await page.close();
    if (!remote) await context.close();
    return;
  }
  if (!await hasUploadInput(page, 3000)) {
    const loginButton = page.getByRole("button", { name: /登录|扫码登录/ }).first();
    if (await loginButton.count()) await loginButton.click().catch(() => {});
  }
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    if (await hasDouyinSession(context) || await hasUploadInput(page, 2000)) {
      emit("login_ready");
      await page.waitForTimeout(1500);
      await page.close();
      if (!remote) await context.close();
      return;
    }
    if (page.isClosed()) throw new Error("登录窗口已关闭，但尚未检测到登录成功");
    await page.waitForTimeout(1500);
  }
  await page.close();
  if (!remote) await context.close();
  throw new Error("等待扫码登录超时，请重新打开登录窗口");
}

async function fillText(locator, value) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
  await locator.page().waitForTimeout(ACTION_SETTLE_MS);
  await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await locator.press("Backspace");
  await locator.pressSequentially(value, { delay: TYPE_DELAY_MS });
  await locator.page().waitForTimeout(ACTION_SETTLE_MS);
}

async function firstExisting(page, selectors, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.count()) return locator;
    }
    await page.waitForTimeout(500);
  }
  return null;
}

async function waitForEditor(page) {
  await Promise.race([
    page.waitForURL(/creator-micro\/content\/(publish|post\/video)/, { timeout: 180000 }),
    page.locator('input[placeholder*="作品标题"]').first().waitFor({ state: "visible", timeout: 180000 }),
  ]).catch(() => {});
  const title = await firstExisting(page, [
    'input[placeholder="填写作品标题，为作品获得更多流量"]',
    'input[placeholder*="作品标题"]',
    'input[placeholder*="标题"]',
  ], 30000);
  if (!title) throw new Error("视频已上传，但未找到作品标题输入框；抖音页面可能已更新");
  return title;
}

async function waitForUpload(page) {
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText().catch(() => "");
    if (/上传失败|转码失败/.test(text)) throw new Error("抖音提示视频上传失败");
    if (/重新上传|上传成功|发布设置/.test(text)) return;
    await page.waitForTimeout(2000);
  }
  throw new Error("等待视频上传完成超时");
}

function formatLocalDateTime(date) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeDateTime(value) {
  const parts = String(value || "").match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!parts) return "";
  const pad = part => String(Number(part)).padStart(2, "0");
  return `${parts[1]}-${pad(parts[2])}-${pad(parts[3])} ${pad(parts[4])}:${pad(parts[5])}`;
}

async function selectScheduleDate(page, value) {
  const panel = page.locator(".semi-datepicker").filter({ visible: true }).last();
  await panel.waitFor({ state: "visible", timeout: 8000 });
  const [year, month, day] = value.split("-").map(Number);

  for (let monthOffset = 0; monthOffset < 3; monthOffset += 1) {
    const ariaTarget = panel.locator(`[role="gridcell"][aria-label="${value}"]`);
    const panelText = await panel.innerText();
    const showingTargetMonth = new RegExp(`${year}\\s*年\\s*0?${month}\\s*月`).test(panelText)
      || new RegExp(`${year}[-/]0?${month}`).test(panelText);
    const textTarget = panel.locator('[role="gridcell"], [class*="datepicker-day"]')
      .filter({ hasText: new RegExp(`^${day}$`) });
    const target = await ariaTarget.count() ? ariaTarget.first() : (showingTargetMonth ? textTarget.first() : null);
    if (target && await target.count() && await target.isVisible()) {
      if (await target.getAttribute("aria-disabled") === "true" || (await target.getAttribute("class") || "").includes("disabled")) {
        throw new Error(`抖音不允许选择日期 ${value}`);
      }
      await target.click();
      await page.waitForTimeout(ACTION_SETTLE_MS);
      return;
    }
    let nextMonth = panel.getByRole("button", { name: "Next month", exact: true });
    if (!await nextMonth.count()) {
      const navigationButtons = panel.locator('[class*="datepicker-navigation"] button');
      nextMonth = navigationButtons.last();
    }
    if (!await nextMonth.count()) break;
    await nextMonth.click();
    await page.waitForTimeout(ACTION_SETTLE_MS);
  }
  throw new Error(`日期选择器中未找到 ${value}`);
}

async function selectScheduleTime(page, hour, minute) {
  const panel = page.locator(".semi-datepicker").filter({ visible: true }).last();
  let switchToTime = panel.getByRole("button", { name: "Switch to time panel", exact: true });
  if (!await switchToTime.count()) {
    switchToTime = panel.locator('[class*="datepicker-switch-time"]:not([class*="disabled"])').first();
  }
  if (!await switchToTime.count()) throw new Error("日期选择器中未找到时间选择入口");
  await switchToTime.click();
  await page.waitForTimeout(ACTION_SETTLE_MS);

  const timePanel = panel.locator('[class*="datepicker-time"]').filter({ visible: true }).last();
  await timePanel.waitFor({ state: "visible", timeout: 8000 });
  let lists = timePanel.getByRole("listbox");
  if (await lists.count() < 2) lists = timePanel.locator("ul");
  if (await lists.count() < 2) {
    lists = timePanel.locator('[class*="scrolllist-item"]');
  }
  if (await lists.count() < 2) throw new Error("时间选择器未显示小时和分钟列表");

  const selectPart = async (list, value, label) => {
    let options = list.getByRole("option");
    if (!await options.count()) options = list.locator("li");
    const option = options.filter({ hasText: new RegExp(`^0?${Number(value)}(?:时|分)?$`) });
    if (!await option.count()) throw new Error(`时间选择器中未找到${label} ${value}`);
    const target = option.first();
    if (await target.getAttribute("aria-disabled") === "true") {
      throw new Error(`抖音不允许选择${label} ${value}`);
    }
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await page.waitForTimeout(ACTION_SETTLE_MS);
  };

  await selectPart(lists.nth(0), hour, "小时");
  await selectPart(lists.nth(1), minute, "分钟");
}

async function setSchedule(page, isoValue) {
  const publishDate = new Date(isoValue);
  if (Number.isNaN(publishDate.getTime())) throw new Error("定时发布时间无效");
  const value = formatLocalDateTime(publishDate);
  const dateValue = value.slice(0, 10);
  const hourValue = value.slice(11, 13);
  const minuteValue = value.slice(14, 16);
  const schedule = page.locator("[class^='radio']:has-text('定时发布'), label:has-text('定时发布')").first();
  if (!await schedule.count()) throw new Error("未找到“定时发布”选项；该账号可能没有网页定时发布权限");
  await schedule.scrollIntoViewIfNeeded();
  await schedule.click();
  await page.waitForTimeout(800);
  const timeInput = await firstExisting(page, [
    '.semi-input[placeholder="日期和时间"]',
    'input[placeholder="日期和时间"]',
    '.semi-datepicker-input input',
    'input[placeholder*="发布时间"]',
  ], 8000);
  if (!timeInput) throw new Error("已选择定时发布，但未找到日期和时间输入框");
  await timeInput.scrollIntoViewIfNeeded();
  await timeInput.click();
  await page.waitForTimeout(ACTION_SETTLE_MS);
  await selectScheduleDate(page, dateValue);
  if (!await page.locator(".semi-datepicker").filter({ visible: true }).count()) {
    await timeInput.click();
    await page.waitForTimeout(ACTION_SETTLE_MS);
  }
  await selectScheduleTime(page, hourValue, minuteValue);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const actual = await timeInput.inputValue().catch(() => "");
  if (normalizeDateTime(actual) !== value) {
    throw new Error(`抖音未接受定时时间 ${value}（控件实际值：${actual || "空"}）`);
  }
}

async function setAigcDeclaration(page) {
  let modal = null;
  try {
    const selected = page.getByText("内容由AI生成", { exact: true }).filter({ visible: true });
    if (await selected.count()) return true;
    const entry = page.getByText("请选择自主声明", { exact: true }).first();
    const fallback = page.getByText("自主声明", { exact: true }).first();
    const target = await entry.count() ? entry : fallback;
    if (!await target.count()) return false;
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await page.waitForTimeout(500);
    modal = page.locator('[role="modal"], [role="dialog"]').filter({ visible: true }).last();
    await modal.waitFor({ state: "visible", timeout: 5000 });
    const row = modal.locator('label:has-text("内容由AI生成")').first();
    const text = modal.getByText("内容由AI生成", { exact: true }).first();
    const option = await row.count() ? row : text;
    if (!await option.count()) return false;
    await option.click();
    await page.waitForTimeout(ACTION_SETTLE_MS);
    const confirm = modal.getByRole("button", { name: "确定", exact: true }).last();
    if (!await confirm.count()) return false;
    await confirm.click();
    await modal.waitFor({ state: "hidden", timeout: 5000 });
    return true;
  } catch {
    return false;
  } finally {
    if (modal && await modal.isVisible().catch(() => false)) {
      const cancel = modal.getByRole("button", { name: "取消", exact: true }).last();
      if (await cancel.count()) await cancel.click().catch(() => {});
      else await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(ACTION_SETTLE_MS).catch(() => {});
    }
  }
}

async function publish() {
  const job = readPayload();
  const artifactDir = path.resolve(job.artifactDir || ".");
  fs.mkdirSync(artifactDir, { recursive: true });
  const screenshot = path.join(artifactDir, `${job.jobId || "douyin"}.png`);
  const { context, remote } = await launch();
  const page = await context.newPage();
  try {
    emit("launching");
    await page.goto(UPLOAD_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await ensureNoVerificationChallenge(page);
    if (!await hasDouyinSession(context)) throw new Error("LOGIN_REQUIRED：请先点击报告中的“登录抖音”并扫码登录");
    const fileInput = await ensureUploadInput(page);
    if (!fileInput) throw new Error("已登录抖音，但发布页面一直未显示上传控件；请打开作品管理检查账号状态后重试");
    emit("uploading");
    await fileInput.setInputFiles(job.file);
    const titleInput = await waitForEditor(page);
    await fillText(titleInput, String(job.title || "").slice(0, 30));
    const description = [job.title, ...(job.topics || []).map(topic => `#${String(topic).replace(/^#+/, "")}`)].filter(Boolean).join(" ");
    const descriptionInput = await firstExisting(page, [
      ".zone-container",
      '[contenteditable="true"][data-placeholder*="作品"]',
      'textarea[placeholder*="作品描述"]',
      '[contenteditable="true"]',
    ], 15000);
    if (!descriptionInput) throw new Error("未找到作品描述输入框");
    await fillText(descriptionInput, description);
    await waitForUpload(page);
    if (job.aigc) {
      const set = await setAigcDeclaration(page);
      emit("aigc", { set });
    }
    if (job.publishAt) {
      emit("scheduling", { publishAt: job.publishAt });
      await setSchedule(page, job.publishAt);
    }
    await ensureNoVerificationChallenge(page);
    const captured = await page.screenshot({ path: screenshot, fullPage: false, timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    emit("submitting", captured ? { screenshot } : {});
    const buttonName = job.publishAt ? "定时发布" : "发布";
    let publishButton = page.getByRole("button", { name: buttonName, exact: true });
    if (!await publishButton.count()) publishButton = page.locator('button:has-text("发布")').last();
    if (!await publishButton.count()) throw new Error("未找到最终发布按钮");
    await publishButton.click();
    const success = await Promise.race([
      page.waitForURL(/creator-micro\/content\/manage/, { timeout: 120000 }).then(() => true),
      page.getByText(/发布成功|预约成功|已成功预约/).first().waitFor({ state: "visible", timeout: 120000 }).then(() => true),
    ]).catch(() => false);
    if (!success) throw new Error("点击发布后未检测到成功结果，请到作品管理确认，避免重复提交");
    emit(job.publishAt ? "scheduled" : "published", { manageUrl: MANAGE_URL, screenshot });
  } catch (error) {
    await page.screenshot({ path: screenshot, fullPage: false, timeout: 10000 }).catch(() => {});
    emit("error", {
      message: String(error?.message || error),
      ...(fs.existsSync(screenshot) ? { screenshot } : {}),
      url: page.url(),
    });
    process.exitCode = 1;
  } finally {
    await page.waitForTimeout(1200).catch(() => {});
    await page.close().catch(() => {});
    if (!remote) await context.close().catch(() => {});
  }
}

try {
  if (command === "login") await login();
  else if (command === "publish") await publish();
  else throw new Error("用法：douyin_publisher.mjs login|publish [payload.json]");
} catch (error) {
  emit("error", { message: String(error?.message || error) });
  process.exitCode = 1;
}
