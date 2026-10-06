// Generated from https://github.com/leaperone/MultiPost-Extension @ 6269ab4ada1cf661a3624b2b9f496bb032a391d5
// SPDX-License-Identifier: Apache-2.0
// Upstream video injectors, excluding VIDEO_DOUYIN. Do not edit by hand.

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 支付宝视频发布器
 */
export async function VideoAlipay(data) {
    console.log("🚀 开始支付宝视频发布流程...");
    console.log("🔍 当前页面:", window.location.href);
    try {
        // 检查是否在支付宝页面
        if (!window.location.href.includes("b.alipay.com")) {
            console.error("❌ 不在支付宝页面，当前页面:", window.location.href);
            return;
        }
        // 解析视频数据
        if (!data || !data.data) {
            console.error("❌ 缺少视频数据");
            return;
        }
        const { content, video, videoFile, title, description, tags = [], cover, horizontalCover } = data.data;
        console.log("📝 视频数据:", {
            title: title?.substring(0, 50),
            contentLength: content?.length,
            hasVideo: !!video,
        });
        // 内联定义支付宝视频上传器类
        const AlipayVideoUploader = class AlipayVideoUploader {
            /**
             * 等待指定时间
             */
            sleep(ms) {
                return new Promise((resolve) => setTimeout(resolve, ms));
            }
            /**
             * 等待元素出现
             */
            async waitForElement(selector, timeout = 10000) {
                return new Promise((resolve, reject) => {
                    const element = document.querySelector(selector);
                    if (element) {
                        resolve(element);
                        return;
                    }
                    const observer = new MutationObserver(() => {
                        const element = document.querySelector(selector);
                        if (element) {
                            resolve(element);
                            observer.disconnect();
                        }
                    });
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true,
                    });
                    setTimeout(() => {
                        observer.disconnect();
                        reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
                    }, timeout);
                });
            }
            async waitForElementOptional(selector, timeout = 10000) {
                return this.waitForElement(selector, timeout).catch(() => null);
            }
            isVisible(element) {
                const htmlElement = element;
                const style = window.getComputedStyle(htmlElement);
                return style.display !== "none" && style.visibility !== "hidden" && htmlElement.getClientRects().length > 0;
            }
            findVisibleInput(selectors) {
                for (const selector of selectors) {
                    const elements = Array.from(document.querySelectorAll(selector));
                    const element = elements.find((item) => this.isVisible(item));
                    if (element) {
                        console.log("✅ 找到输入框:", selector);
                        return element;
                    }
                }
                return null;
            }
            async fetchFile(fileData, fallbackType) {
                const response = await fetch(fileData.url);
                const arrayBuffer = await response.arrayBuffer();
                return new File([arrayBuffer], fileData.name, { type: fileData.type || fallbackType });
            }
            dispatchInputEvents(element) {
                element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
            }
            async pasteText(element, text) {
                const before = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
                    ? element.value
                    : element.textContent || "";
                const pasteEvent = new ClipboardEvent("paste", {
                    bubbles: true,
                    cancelable: true,
                    clipboardData: new DataTransfer(),
                });
                pasteEvent.clipboardData.setData("text/plain", text);
                element.dispatchEvent(pasteEvent);
                await this.sleep(100);
                const after = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
                    ? element.value
                    : element.textContent || "";
                if (after !== before) {
                    this.dispatchInputEvents(element);
                    return;
                }
                if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
                    const start = element.selectionStart ?? element.value.length;
                    const end = element.selectionEnd ?? element.value.length;
                    element.value = `${element.value.slice(0, start)}${text}${element.value.slice(end)}`;
                    const nextPosition = start + text.length;
                    element.setSelectionRange(nextPosition, nextPosition);
                }
                else {
                    element.textContent = `${element.textContent || ""}${text}`;
                }
                this.dispatchInputEvents(element);
            }
            findButtonByText(text) {
                return (Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === text) ?? null);
            }
            /**
             * 填写标题
             */
            async fillTitle(title) {
                try {
                    console.log("📝 填写标题:", title);
                    // 等待页面加载
                    await this.sleep(3000);
                    // 支付宝标题输入框选择器
                    const titleSelectors = [
                        'input[placeholder="一个好的标题，能获得更多人的喜欢哦"]',
                        'input[placeholder*="标题"]',
                        'input[placeholder*="title"]',
                        'input[name*="title"]',
                        'input[class*="title"]',
                        'input[type="text"]',
                        '.ant-input[type="text"]',
                        ".ant-input",
                        "#title",
                        'textarea[placeholder*="标题"]',
                        '.form-input[type="text"]',
                        '.el-input__inner[type="text"]',
                        ".alipay-input",
                    ];
                    const titleElement = this.findVisibleInput(titleSelectors);
                    if (!titleElement) {
                        console.log("❌ 未找到可用的标题输入框");
                        return;
                    }
                    try {
                        // 清空原有内容
                        titleElement.focus();
                        titleElement.select();
                        // 逐字符输入模拟真实用户行为
                        for (let i = 0; i < title.length; i++) {
                            titleElement.value = title.substring(0, i + 1);
                            // 触发输入事件
                            titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                            await this.sleep(50);
                        }
                        // 触发多种事件确保框架识别
                        titleElement.dispatchEvent(new Event("focus", { bubbles: true }));
                        titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                        titleElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                        titleElement.dispatchEvent(new Event("blur", { bubbles: true }));
                        // 验证设置是否成功
                        console.log(`✅ 标题设置后验证: value="${titleElement.value}"`);
                        if (titleElement.value === title) {
                            console.log("✅ 标题填写成功");
                        }
                    }
                    catch (e) {
                        console.error("设置标题值时出错:", e);
                    }
                }
                catch (error) {
                    console.error("填写标题失败:", error);
                    return;
                }
            }
            /**
             * 填写描述
             */
            async fillDescriptionAndTags(description, tags) {
                try {
                    console.log("📝 填写描述:", `${description.substring(0, 100)}...`);
                    // 支付宝描述输入框选择器
                    const descSelectors = [
                        'textarea[placeholder="填写作品描述，让你的作品更容易被看到"]',
                        'textarea[placeholder*="描述"]',
                        'textarea[placeholder*="简介"]',
                        'textarea[placeholder*="内容"]',
                        'textarea[name*="content"]',
                        'textarea[name*="desc"]',
                        "textarea",
                        ".ant-input",
                        "#content",
                        "#description",
                        ".form-textarea",
                        ".el-textarea__inner",
                        ".alipay-textarea",
                    ];
                    const descElement = this.findVisibleInput(descSelectors);
                    if (!descElement) {
                        console.log("❌ 未找到可用的描述输入框");
                        return false;
                    }
                    try {
                        descElement.focus();
                        descElement.value = "";
                        await this.pasteText(descElement, `${description} `);
                        console.log("✅ 描述填写成功");
                        for (const tag of tags.slice(0, 5)) {
                            console.log("🏷️ 添加支付宝话题:", tag);
                            descElement.focus();
                            descElement.setSelectionRange(descElement.value.length, descElement.value.length);
                            await this.pasteText(descElement, ` #${tag}`);
                            await this.sleep(3000);
                            const customTopicDiv = Array.from(document.querySelectorAll("div")).find((div) => div.textContent?.trim() === "自定义话题");
                            if (customTopicDiv) {
                                customTopicDiv.click();
                                await this.sleep(1000);
                            }
                            else {
                                console.log(`未找到"${tag}"的自定义话题确认项`);
                            }
                            await this.sleep(1000);
                        }
                        descElement.blur();
                        return true;
                    }
                    catch (e) {
                        console.error("设置描述或标签时出错:", e);
                        return false;
                    }
                }
                catch (error) {
                    console.error("填写描述失败:", error);
                    return false;
                }
            }
            /**
             * 上传视频文件
             */
            async uploadVideo(videoData, sourceFile) {
                try {
                    console.log("📹 开始上传视频...");
                    // 获取视频文件
                    let file;
                    if (sourceFile) {
                        file = sourceFile;
                    }
                    else if (videoData.url) {
                        const response = await fetch(videoData.url);
                        const arrayBuffer = await response.arrayBuffer();
                        const extension = videoData.name.split(".").pop() || "mp4";
                        const fileName = `${videoData.name.replace(/\.[^/.]+$/, "")}.${extension}`;
                        file = new File([arrayBuffer], fileName, { type: "video/mp4" });
                    }
                    else {
                        console.error("❌ 无效的视频数据");
                        return false;
                    }
                    console.log("📁 视频文件:", file.name, file.size, file.type);
                    // 等待页面完全加载
                    console.log("⏳ 等待页面加载完成...");
                    await this.sleep(5000);
                    // 查找上传区域
                    console.log("🔍 查找支付宝上传区域...");
                    const exactFileInput = (await this.waitForElementOptional('input[type="file"]', 5000));
                    if (exactFileInput) {
                        const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
                        const targetInput = fileInputs.find((input) => {
                            const accept = input.getAttribute("accept") || "";
                            return accept.includes("video") || accept.includes("*") || accept === "";
                        }) ?? exactFileInput;
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        targetInput.files = dataTransfer.files;
                        targetInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                        targetInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                        console.log("✅ 文件已设置到 input[type=file]");
                        return true;
                    }
                    const uploadSelectors = [
                        ".upload-area",
                        ".video-upload",
                        '[class*="upload"]',
                        '[class*="video"]',
                        ".ant-upload",
                        "#upload",
                        ".upload-btn",
                        'button[class*="upload"]',
                        ".upload-container",
                        ".el-upload",
                        ".el-upload-dragger",
                        ".alipay-upload",
                        ".upload-wrapper",
                    ];
                    let uploadArea = null;
                    for (const selector of uploadSelectors) {
                        const element = document.querySelector(selector);
                        if (element && element.offsetParent !== null) {
                            console.log(`✅ 找到上传区域: ${selector}`);
                            uploadArea = element;
                            break;
                        }
                    }
                    if (!uploadArea) {
                        console.log("❌ 未找到上传区域，尝试查找文件输入框...");
                        // 直接查找文件输入框
                        const fileInputs = document.querySelectorAll('input[type="file"]');
                        console.log(`🔍 找到 ${fileInputs.length} 个文件输入框`);
                        let targetInput = null;
                        fileInputs.forEach((input, index) => {
                            const accept = input.getAttribute("accept") || "";
                            console.log(`  输入框 ${index + 1}: accept="${accept}"`);
                            // 优先查找视频文件输入框
                            if (accept.includes("video") || accept.includes("*") || accept === "") {
                                targetInput = input;
                                console.log(`✅ 选择输入框 ${index + 1} 作为目标`);
                            }
                        });
                        if (targetInput) {
                            // 使用DataTransfer API设置文件
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            targetInput.files = dataTransfer.files;
                            // 触发change事件
                            targetInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 文件已设置到输入框");
                            return true;
                        }
                        console.log("❌ 未找到合适的文件输入框");
                        return false;
                    }
                    // 如果找到了上传区域，尝试点击或操作
                    console.log("🔄 尝试操作上传区域...");
                    // 查找上传区域内的文件输入框
                    const uploadInput = uploadArea.querySelector('input[type="file"]');
                    if (uploadInput) {
                        console.log("✅ 在上传区域内找到文件输入框");
                        // 创建透明的文件输入框覆盖上传区域
                        const overlayInput = document.createElement("input");
                        overlayInput.type = "file";
                        overlayInput.accept = "video/*,.mp4,.avi,.mov,.wmv";
                        overlayInput.style.position = "absolute";
                        overlayInput.style.opacity = "0";
                        overlayInput.style.width = "100%";
                        overlayInput.style.height = "100%";
                        overlayInput.style.top = "0";
                        overlayInput.style.left = "0";
                        overlayInput.style.zIndex = "9999";
                        overlayInput.id = `alipay_upload_${Date.now()}`;
                        // 设置上传区域样式以支持覆盖
                        const uploadElement = uploadArea;
                        uploadElement.style.position = "relative";
                        uploadElement.appendChild(overlayInput);
                        // 设置文件
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        overlayInput.files = dataTransfer.files;
                        // 触发文件选择事件
                        overlayInput.dispatchEvent(new Event("focus", { bubbles: true }));
                        overlayInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                        console.log("✅ 文件已设置到覆盖输入框");
                        // 尝试点击上传区域（如果需要）
                        if (uploadArea.tagName === "BUTTON" || uploadArea.closest("button")) {
                            console.log("🖱️ 点击上传按钮...");
                            (uploadArea.closest("button") || uploadArea).click();
                            await this.sleep(1000);
                        }
                        // 等待上传开始
                        await this.waitForUploadStart();
                        return true;
                    }
                    console.log("⚠️ 上传区域内未找到文件输入框，尝试点击上传区域...");
                    // 点击上传区域触发文件选择
                    const clickableElement = uploadArea.closest("button") || uploadArea.querySelector("button") || uploadArea;
                    if (clickableElement) {
                        console.log("🖱️ 点击可点击元素...");
                        clickableElement.click();
                        await this.sleep(2000);
                        // 再次查找文件输入框
                        const newFileInput = document.querySelector('input[type="file"]');
                        if (newFileInput) {
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            newFileInput.files = dataTransfer.files;
                            newFileInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 文件已设置到新找到的输入框");
                            return true;
                        }
                    }
                    console.log("⚠️ 无法直接上传文件，但页面可能已经准备好了");
                    return false;
                }
                catch (error) {
                    console.error("❌ 视频上传失败:", error);
                    return false;
                }
            }
            async uploadCover(cover, label) {
                try {
                    console.log(`🖼️ 开始上传支付宝${label}:`, cover);
                    if (cover.type && !cover.type.includes("image/")) {
                        console.log(`${label}不是图片，跳过上传`);
                        return false;
                    }
                    const coverUpload = document.querySelector("div.antd5-form-item-control-input-content img.absolute");
                    console.debug("coverUpload -->", coverUpload);
                    if (!coverUpload) {
                        console.log(`未找到支付宝${label}封面入口`);
                        return false;
                    }
                    coverUpload.click();
                    await this.sleep(1000);
                    const uploadCoverTab = Array.from(document.querySelectorAll("div[role='tab']")).find((tab) => tab.textContent?.trim() === "上传封面");
                    console.debug("uploadCoverTab -->", uploadCoverTab);
                    if (!uploadCoverTab) {
                        console.log(`未找到支付宝${label}上传封面 tab`);
                        return false;
                    }
                    uploadCoverTab.click();
                    await this.sleep(1000);
                    const fileInput = document.querySelector('input[accept=".jpg, .jpeg, .png"]');
                    console.debug("fileInput -->", fileInput);
                    if (!fileInput) {
                        console.log(`未找到支付宝${label}封面文件输入框`);
                        return false;
                    }
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(await this.fetchFile(cover, "image/png"));
                    if (dataTransfer.files.length === 0)
                        return false;
                    fileInput.files = dataTransfer.files;
                    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
                    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
                    console.log(`支付宝${label}封面文件上传操作已触发`);
                    await this.sleep(3000);
                    const nextButton = this.findButtonByText("下一步");
                    console.debug("nextButton -->", nextButton);
                    nextButton?.click();
                    for (let i = 0; i < 5; i++) {
                        const doneButton = this.findButtonByText("完 成") || this.findButtonByText("完成");
                        console.debug("doneButton -->", doneButton);
                        if (doneButton) {
                            doneButton.click();
                            return true;
                        }
                        await this.sleep(1000);
                    }
                    console.log(`支付宝${label}封面未找到完成按钮，视为上传失败`);
                    return false;
                }
                catch (error) {
                    console.warn(`支付宝${label}封面上传失败:`, error);
                    return false;
                }
            }
            async publishIfAutoEnabled(autoPublish, videoUploaded) {
                if (autoPublish !== true)
                    return;
                if (!videoUploaded) {
                    console.warn("支付宝自动发布已跳过：视频未成功触发上传");
                    return;
                }
                await this.sleep(5000);
                const publishButton = this.findButtonByText("确认发布");
                if (publishButton) {
                    console.log("点击支付宝确认发布按钮");
                    publishButton.click();
                }
                else {
                    console.log('未找到"确认发布"按钮');
                }
            }
            /**
             * 等待上传开始
             */
            async waitForUploadStart() {
                console.log("⏳ 等待上传开始...");
                for (let i = 0; i < 30; i++) {
                    await this.sleep(1000);
                    // 检查上传进度指示器
                    const progressSelectors = [
                        '[class*="progress"]',
                        '[class*="uploading"]',
                        '[class*="upload-progress"]',
                        ".ant-progress",
                        ".progress-bar",
                        ".uploading",
                        ".el-progress",
                        ".alipay-progress",
                    ];
                    for (const selector of progressSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log("✅ 检测到上传进度指示器");
                            return;
                        }
                    }
                    // 检查是否有上传成功标志
                    const successSelectors = ['[class*="success"]', '[class*="complete"]', '[class*="done"]', ".upload-success"];
                    for (const selector of successSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log("✅ 检测到上传成功标志");
                            return;
                        }
                    }
                }
                console.log("⚠️ 未检测到明确的上传状态，但可能已开始");
            }
        };
        console.log("✅ 支付宝上传器类定义完成");
        const uploader = new AlipayVideoUploader();
        console.log("✅ 支付宝上传器实例创建完成");
        let videoUploaded = false;
        // Step 1: upload the required video.
        if (video) {
            console.log("🎥 开始上传视频...");
            videoUploaded = await uploader.uploadVideo(video, videoFile);
        }
        else {
            console.error("❌ 缺少视频文件");
            return;
        }
        await uploader.sleep(3000);
        // Step 2: fill the title with exact selector first, then legacy fallbacks.
        if (title) {
            console.log("📝 填写标题:", title);
            await uploader.fillTitle(title);
        }
        // Step 3: fill description and confirm custom topics from the description box.
        const descriptionText = description ?? content ?? "";
        if (descriptionText || tags.length > 0) {
            console.log("📝 填写描述:", `${descriptionText.substring(0, 100)}...`);
            await uploader.fillDescriptionAndTags(descriptionText, tags);
        }
        // Step 4: upload one cover best-effort. Cover failure must not block publish.
        const coverToUpload = cover || horizontalCover;
        if (coverToUpload) {
            await uploader.uploadCover(coverToUpload, cover ? "cover" : "horizontalCover");
        }
        await uploader.publishIfAutoEnabled(data.isAutoPublish, videoUploaded);
        console.log("🎉 支付宝视频发布流程完成");
        return;
    }
    catch (error) {
        console.error("💥 支付宝视频发布失败:", error);
        if (error instanceof Error) {
            console.error("错误详情:", error.stack);
        }
        return;
    }
}

export async function VideoBaijiahao(data) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
            }, timeout);
        });
    }
    async function waitForElementOptional(selector, timeout = 10000) {
        return waitForElement(selector, timeout).catch(() => null);
    }
    async function uploadVideo(file) {
        const fileInput = (await waitForElementOptional('input[type="file"]'));
        if (!fileInput) {
            console.error("未找到百家号视频文件输入框");
            return false;
        }
        await sleep(3000);
        console.log("找到文件输入框:", fileInput);
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        // 触发必要的事件
        const changeEvent = new Event("change", { bubbles: true });
        fileInput.dispatchEvent(changeEvent);
        const inputEvent = new Event("input", { bubbles: true });
        fileInput.dispatchEvent(inputEvent);
        console.log("文件上传操作完成");
        return true;
    }
    async function waitForUploadCompletion(timeout = 600000) {
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                const spans = document.querySelectorAll("span");
                const uploadCompleteElement = Array.from(spans).find((span) => span.textContent?.includes("上传完成"));
                if (uploadCompleteElement) {
                    clearInterval(checkInterval);
                    console.log("视频上传完成");
                    resolve(true);
                }
            }, 1000);
            setTimeout(() => {
                clearInterval(checkInterval);
                reject(new Error("视频上传超时"));
            }, timeout);
        });
    }
    async function fetchCoverFile(cover) {
        if (cover.type && !cover.type.includes("image/")) {
            console.log("Cover is not an image, skipping upload");
            return null;
        }
        const response = await fetch(cover.url);
        const arrayBuffer = await response.arrayBuffer();
        return new File([arrayBuffer], cover.name, { type: cover.type || "image/png" });
    }
    async function uploadCover(cover, coverIndex, label) {
        console.log("tryCover", label, cover);
        await waitForElementOptional("div.cheetah-upload span.cheetah-upload div.cheetah-spin-container", 5000);
        const coverUploadContainers = document.querySelectorAll("div.cheetah-upload span.cheetah-upload div.cheetah-spin-container");
        console.log("coverUploads", coverUploadContainers);
        const coverUploadContainer = coverUploadContainers[coverIndex];
        if (!coverUploadContainer) {
            console.log(`未找到百家号${label}封面入口`);
            return false;
        }
        const coverUploadButton = coverUploadContainer.firstChild?.firstChild ||
            coverUploadContainer.firstChild;
        console.log("coverUploadButton", coverUploadButton);
        if (!coverUploadButton)
            return false;
        coverUploadButton.click();
        await sleep(3000);
        const modals = document.querySelectorAll("div.cheetah-modal-body");
        const modal = (coverIndex === 1 && modals.length > 1 ? modals[1] : modals[0]);
        console.log("modal", modal);
        if (!modal)
            return false;
        const fileInput = modal.querySelector("div.cheetah-tabs-content span.cheetah-upload input[name='media'][accept='image/*']") ||
            modal.querySelector("div.cheetah-tabs-content input[name='media']");
        console.log("fileInput", fileInput);
        if (!fileInput)
            return false;
        const dataTransfer = new DataTransfer();
        console.log("try upload file", cover);
        const coverFile = await fetchCoverFile(cover);
        if (!coverFile)
            return false;
        dataTransfer.items.add(coverFile);
        if (dataTransfer.files.length === 0)
            return false;
        fileInput.files = dataTransfer.files;
        const changeEvent = new Event("change", { bubbles: true });
        fileInput.dispatchEvent(changeEvent);
        const inputEvent = new Event("input", { bubbles: true });
        fileInput.dispatchEvent(inputEvent);
        console.log("文件上传操作触发");
        await sleep(3000);
        const doneButtons = modal.querySelectorAll("button");
        console.log("doneButtons", doneButtons);
        const doneButton = Array.from(doneButtons).find((e) => e.textContent?.trim() === "确定");
        console.log("doneButton", doneButton);
        if (doneButton) {
            doneButton.click();
            return true;
        }
        return false;
    }
    try {
        const { content, video, title, tags, cover, verticalCover, horizontalCover } = data.data;
        if (!video) {
            console.error("没有视频文件");
            return;
        }
        // 处理视频上传
        const response = await fetch(video.url);
        const arrayBuffer = await response.arrayBuffer();
        const videoFile = new File([arrayBuffer], `${title || "video"}.${video.name.split(".").pop()}`, {
            type: video.type,
        });
        console.log(`准备上传视频: ${videoFile.name} (${videoFile.type}, ${videoFile.size} bytes)`);
        const videoUploadTriggered = await uploadVideo(videoFile);
        const videoUploaded = videoUploadTriggered ? await waitForUploadCompletion().catch(() => false) : false;
        if (!videoUploaded) {
            console.error("百家号视频未完成上传，跳过后续自动发布");
        }
        // 等待页面状态稳定
        await sleep(2000);
        // 处理标题输入
        const titleInput = document.querySelector('textarea[placeholder="请输入标题"]');
        if (titleInput) {
            titleInput.value = title || "";
            titleInput.dispatchEvent(new Event("input", { bubbles: true }));
            console.log("标题已输入:", title);
        }
        // 处理描述输入
        const descriptionInput = document.querySelector('textarea[placeholder="让别人更懂你"]');
        if (descriptionInput) {
            const description = (content || title || "").slice(0, 100);
            descriptionInput.value = description;
            descriptionInput.dispatchEvent(new Event("input", { bubbles: true }));
            console.log("描述已输入:", description);
        }
        // Handle tags best-effort.
        try {
            const tagInput = document.querySelector('input[placeholder="获得精准推荐"]');
            if (tagInput && tags) {
                for (const tag of tags) {
                    tagInput.value = tag;
                    console.log("正在输入标签:", tag);
                    const enterEvent = new KeyboardEvent("keydown", {
                        bubbles: true,
                        cancelable: true,
                        key: "Enter",
                        code: "Enter",
                        keyCode: 13,
                        which: 13,
                    });
                    tagInput.dispatchEvent(enterEvent);
                    await sleep(1000);
                }
            }
        }
        catch (error) {
            console.warn("百家号标签处理失败，继续发布流程:", error);
        }
        const verticalCoverFile = verticalCover || cover;
        const tryUploadCover = async (coverFile, coverIndex, label) => {
            try {
                await uploadCover(coverFile, coverIndex, label);
            }
            catch (error) {
                console.warn(`百家号${label}封面上传失败，继续发布流程:`, error);
            }
        };
        // Upload covers best-effort. Keep slot 0 populated when only one cover is present.
        if (horizontalCover && verticalCoverFile) {
            await tryUploadCover(horizontalCover, 0, "横");
            await sleep(2000);
            await tryUploadCover(verticalCoverFile, 1, "竖");
        }
        else if (horizontalCover) {
            await tryUploadCover(horizontalCover, 0, "横");
        }
        else if (verticalCoverFile) {
            await tryUploadCover(verticalCoverFile, 0, "封面");
        }
        // 等待页面响应
        await sleep(5000);
        // 如果需要自动发布
        if (data.isAutoPublish) {
            if (!videoUploaded) {
                console.warn("百家号自动发布已跳过：视频未成功上传完成");
                return;
            }
            const publishButton = document.querySelector("button.cheetah-btn.cheetah-btn-circle.cheetah-btn-primary.cheetah-btn-icon-only.cheetah-public");
            if (publishButton) {
                console.log("点击发布按钮");
                publishButton.click();
            }
            else {
                console.log("未找到发布按钮");
            }
        }
    }
    catch (error) {
        console.error("百家号视频发布过程中出错:", error);
    }
}

export async function VideoBilibili(data) {
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
            }, timeout);
        });
    }
    async function waitForElementOptional(selector, timeout = 10000) {
        return waitForElement(selector, timeout).catch(() => null);
    }
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    function findCoverEntry() {
        const existingEntry = document.querySelector("div.cover-main-img > div.img");
        if (existingEntry)
            return { element: existingEntry, isFallbackEntry: false };
        const coverMain = document.querySelector("div.cover-main");
        const fallbackEntry = Array.from(coverMain?.querySelectorAll("span") ?? []).find((span) => span.textContent?.includes("更换封面") || span.textContent?.includes("封面设置"));
        if (fallbackEntry)
            return { element: fallbackEntry, isFallbackEntry: true };
        return null;
    }
    function findDoneButton() {
        const footerButton = Array.from(document.querySelectorAll("div.cover-select-footer-pick button")).find((btn) => btn.textContent?.trim() === "完成");
        if (footerButton)
            return footerButton;
        return (Array.from(document.querySelectorAll("div.submit")).find((button) => button.textContent?.trim() === "完成") ?? null);
    }
    function applyOriginalDeclaration(isOriginal) {
        const originalCheckbox = document.querySelector("div.original-input-wrp input[type='checkbox']");
        if (originalCheckbox) {
            if (isOriginal && !originalCheckbox.checked) {
                originalCheckbox.click();
                console.log("已勾选原创声明");
            }
            else if (!isOriginal && originalCheckbox.checked) {
                originalCheckbox.click();
                console.log("已取消原创声明");
            }
            return;
        }
        const radioLabels = isOriginal ? ["自制"] : ["转载", "非自制"];
        const originalRadio = Array.from(document.querySelectorAll("span.check-radio-v2-name")).find((span) => radioLabels.some((label) => span.textContent?.trim() === label || span.textContent?.includes(label)));
        if (originalRadio) {
            originalRadio.click();
            console.log(isOriginal ? "已选择自制原创声明" : "已选择转载原创声明");
        }
        else {
            console.log(isOriginal ? "未找到自制原创声明单选项" : "未找到转载原创声明单选项");
        }
    }
    async function uploadCover(cover) {
        console.log("开始上传封面", cover);
        await waitForElementOptional("div.cover-main-img > div.img, div.cover-main");
        const coverEntry = findCoverEntry();
        if (!coverEntry) {
            console.log("未找到封面上传按钮");
            return false;
        }
        coverEntry.element.click();
        await sleep(coverEntry.isFallbackEntry ? 1500 : 1000);
        const tabContainer = document.querySelector("div.cover-select-header-tab");
        if (tabContainer) {
            const uploadTab = tabContainer.firstChild?.nextSibling;
            if (!uploadTab) {
                console.log("未找到上传封面tab");
                return false;
            }
            uploadTab.click();
            await sleep(1000);
        }
        else {
            console.log("未找到封面选择的tab容器，尝试直接查找上传输入框");
        }
        const fileInput = document.querySelector("div.bcc-upload-wrapper > input[type='file'][accept='image/png, image/jpeg']");
        if (!fileInput) {
            console.log("未找到封面上传的文件输入框");
            return false;
        }
        const dataTransfer = new DataTransfer();
        if (cover.type && !cover.type.includes("image/")) {
            console.log("封面文件类型不正确");
            return false;
        }
        const response = await fetch(cover.url);
        const blob = await response.blob();
        const coverFile = new File([blob], cover.name, { type: cover.type || "image/png" });
        dataTransfer.items.add(coverFile);
        if (dataTransfer.files.length === 0) {
            return false;
        }
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        fileInput.dispatchEvent(new Event("input", { bubbles: true }));
        console.log("封面文件上传操作已触发");
        await sleep(3000);
        const doneButton = findDoneButton();
        if (doneButton) {
            doneButton.click();
            console.log("封面上传完成");
            return true;
        }
        console.log('未找到"完成"按钮');
        return false;
    }
    async function uploadVideo(file) {
        const fileInput = (await waitForElementOptional('input[type="file"]'));
        if (!fileInput) {
            console.log("未找到视频上传文件输入框");
            return false;
        }
        // 创建一个新的 File 对象，因为某些浏览器可能不允许直接设置 fileInput.files
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        // 触发 change 事件
        const changeEvent = new Event("change", { bubbles: true });
        fileInput.dispatchEvent(changeEvent);
        console.log("视频上传事件已触发");
        return true;
    }
    async function waitForUploadCompletion(timeout = 600000) {
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                const spans = document.querySelectorAll("span");
                const uploadCompleteElement = Array.from(spans).find((span) => span.textContent?.includes("上传完成"));
                if (uploadCompleteElement) {
                    clearInterval(checkInterval);
                    console.log("视频上传完成");
                    resolve();
                }
            }, 1000);
            setTimeout(() => {
                clearInterval(checkInterval);
                reject(new Error("视频上传超时"));
            }, timeout);
        });
    }
    try {
        const { content, video, title, tags, cover, horizontalCover, description, original } = data.data;
        // 视频简介优先使用 description（独立字段），未提供时回退到 content
        const videoDescription = description ?? content;
        // 原创声明:用户未明确指定时默认为原创(B 站投稿默认勾选)
        const isOriginal = original !== false;
        // 处理视频上传
        if (video) {
            await waitForElementOptional('input[type="file"]');
            await sleep(1000);
            const response = await fetch(video.url);
            const blob = await response.arrayBuffer();
            const extension = video.name.split(".").pop() || "mp4";
            const videoFilename = `${title}.${extension}`;
            const videoFile = new File([blob], videoFilename, { type: video.type });
            console.log(`视频文件: ${videoFile.name} ${videoFile.type} ${videoFile.size}`);
            const videoUploadTriggered = await uploadVideo(videoFile);
            if (!videoUploadTriggered)
                return;
            console.log("视频上传已初始化");
            try {
                await waitForUploadCompletion();
                console.log("视频上传已完成，继续后续操作");
            }
            catch (error) {
                console.error("等待视频上传完成时出错:", error);
                return;
            }
        }
        else {
            console.error("没有视频文件");
            return;
        }
        // Handle title input.
        const titleInput = (await waitForElementOptional('input[maxlength="80"][type="text"]')) ||
            (await waitForElementOptional('input.input-val[type="text"][maxlength="80"]', 3000));
        if (title) {
            if (titleInput) {
                titleInput.focus();
                titleInput.value = title;
                titleInput.dispatchEvent(new Event("input", { bubbles: true }));
                titleInput.dispatchEvent(new Event("change", { bubbles: true }));
                console.log("标题已输入:", title);
            }
            else {
                console.log("未找到标题输入框");
            }
        }
        // 等待简介编辑器出现并输入内容
        const editor = (await waitForElementOptional('div.ql-editor[contenteditable="true"]'));
        if (editor) {
            editor.innerHTML = videoDescription || "";
            console.log("简介已输入:", videoDescription);
        }
        else {
            console.log("未找到简介编辑器");
        }
        // Original declaration defaults to self-made; explicit false cancels it when the checkbox exists.
        applyOriginalDeclaration(isOriginal);
        await sleep(3000);
        // Handle tags best-effort.
        try {
            const existingTags = document.querySelectorAll("div.tag-pre-wrp > div.label-item-v2-container");
            console.log(`发现 ${existingTags.length} 个已有标签，准备清除...`);
            for (let i = 0; i < existingTags.length; i++) {
                const tag = existingTags[i];
                const closeButton = tag.querySelector(".label-item-v2-close");
                if (closeButton) {
                    closeButton.click();
                    await sleep(400);
                }
            }
            if (!tags || tags.length === 0) {
                console.log("未指定标签，选择热门标签...");
                const hotTags = document.querySelectorAll(".hot-tag-item");
                if (hotTags.length > 0) {
                    for (let i = 0; i < 3 && i < hotTags.length; i++) {
                        const tag = hotTags[i];
                        tag.click();
                        await sleep(1000);
                    }
                }
            }
            else {
                console.log("添加指定标签...");
                const tagInput = document.querySelector('input[placeholder="按回车键Enter创建标签"]');
                if (tagInput) {
                    for (const tag of tags.slice(0, 10)) {
                        tagInput.value = tag;
                        const enterEvent = new KeyboardEvent("keydown", {
                            bubbles: true,
                            cancelable: true,
                            key: "Enter",
                            code: "Enter",
                            keyCode: 13,
                            which: 13,
                        });
                        tagInput.dispatchEvent(enterEvent);
                        await sleep(1000);
                    }
                }
            }
        }
        catch (error) {
            console.warn("Bilibili 标签处理失败，继续发布流程:", error);
        }
        // Upload one cover best-effort.
        const coverToUpload = horizontalCover || cover;
        if (coverToUpload) {
            await uploadCover(coverToUpload).catch((error) => {
                console.warn("Bilibili 封面上传失败，继续发布流程:", error);
                return false;
            });
        }
        // 等待标签和封面处理完成
        await sleep(5000);
        // 如果需要自动发布
        if (data.isAutoPublish) {
            const submitButton = document.querySelector("span.submit-add");
            if (submitButton) {
                console.log("点击发布按钮");
                submitButton.click();
            }
            else {
                console.log('未找到"发送"按钮');
            }
        }
    }
    catch (error) {
        console.error("BilibiliVideo 发布过程中出错:", error);
    }
}

// 不支持发布视频
export async function VideoBluesky(data) {
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
            }, timeout);
        });
    }
    try {
        const { content, video, title, description } = data.data;
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const newPostButton = document.querySelector('button[data-testid="composeFAB"]');
        if (newPostButton) {
            newPostButton.click();
        }
        else {
            console.log("未找到撰写新帖文按钮");
            return;
        }
        // 处理输入
        const contentInput = (await waitForElement('div[contenteditable="true"]'));
        contentInput.focus();
        const body = description || content || "";
        contentInput.textContent = title ? `${title}\n${body}` : body;
        contentInput.dispatchEvent(new Event("input", { bubbles: true }));
        contentInput.dispatchEvent(new Event("change", { bubbles: true }));
        console.log("内容已输入:", content);
        if (video) {
            const response = await fetch(video.url);
            const blob = await response.blob();
            const videoFile = new File([blob], video.name, { type: video.type });
            console.log(`文件: ${videoFile.name} ${videoFile.type} ${videoFile.size}`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
            window.postMessage({ type: "BLUESKY_VIDEO_UPLOAD", video: videoFile }, "*");
        }
        // 发布动态
        if (data.isAutoPublish) {
            const maxAttempts = 3;
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const publishButton = document.querySelector('button[aria-label="Publish post"]:not(:disabled)');
                if (publishButton) {
                    publishButton.click();
                    console.log("已点击发布按钮");
                    await new Promise((resolve) => setTimeout(resolve, 3000));
                    window.location.reload();
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    }
    catch (error) {
        console.error("bluesky 发布过程中出错:", error);
    }
}

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 车家号视频上传器 - 基于AHVP系统
 */
// 立即导出并设置到全局作用域
export const ChejiahaoVideoUploader = class ChejiahaoVideoUploader {
    uploader = null;
    uploadToken = "";
    /**
     * 等待元素出现
     */
    waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
            }, timeout);
        });
    }
    /**
     * 等待指定时间
     */
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * 获取上传凭证
     */
    async getUploadToken() {
        try {
            console.log("🔑 获取车家号上传凭证...");
            // 尝试从已有的全局变量获取
            if (window.browser_0_?.params?.callback) {
                console.log("✅ 从全局变量获取上传凭证");
                return window.browser_0_.params.callback;
            }
            // 尝试从页面API获取
            const response = await fetch("https://creator.autohome.com.cn/openapi/content-api/video/get_upload_info?bizType=1", {
                method: "GET",
                credentials: "include",
                headers: {
                    accept: "application/json;charset=UTF-8",
                },
            });
            if (response.ok) {
                const data = await response.json();
                console.log("✅ 获取上传凭证成功:", data);
                this.uploadToken = data.token || "";
                return this.uploadToken;
            }
            console.log("⚠️ 无法获取上传凭证，使用默认值");
            return "";
        }
        catch (error) {
            console.error("❌ 获取上传凭证失败:", error);
            return "";
        }
    }
    /**
     * 初始化AHVP上传器
     */
    async initAHVPUploader() {
        try {
            console.log("🚀 初始化AHVP上传器...");
            // 等待AHVP系统加载
            if (!window.AHVP) {
                console.log("🔄 等待AHVP系统加载...");
                let attempts = 0;
                while (!window.AHVP && attempts < 30) {
                    await this.sleep(1000);
                    attempts++;
                }
            }
            const AHVP = window.AHVP;
            if (!AHVP) {
                console.error("❌ AHVP系统未加载");
                return false;
            }
            console.log("✅ AHVP系统已加载");
            // 获取上传凭证
            const token = await this.getUploadToken();
            // 如果已有上传器实例，先取消
            if (window.browser_0_) {
                try {
                    window.browser_0_.cancel();
                }
                catch (_e) {
                    console.log("🔄 清理旧的上传器实例");
                }
            }
            // 创建新的上传器
            this.uploader = AHVP.newUploader({
                h5: true,
                target: "browser_0",
                dragtarget: "browser_0",
                waitstart: 1,
                param: "lt=30&gt=3",
                iw: 0,
                provider: "autohomeMulti",
                callback: token,
                mt: 1,
            });
            if (this.uploader) {
                // 存储到全局变量
                window.browser_0_ = this.uploader;
                console.log("✅ AHVP上传器创建成功");
                return true;
            }
            console.error("❌ AHVP上传器创建失败");
            return false;
        }
        catch (error) {
            console.error("❌ 初始化AHVP上传器失败:", error);
            return false;
        }
    }
    /**
     * 模拟点击上传区域触发文件选择
     */
    async triggerFileSelect() {
        try {
            console.log("🖱️ 触发文件选择...");
            // 查找上传区域元素
            const uploadSelectors = ["#browser_0", ".upload-area", ".ant-upload", '[class*="upload"]', ".video-upload-area"];
            for (const selector of uploadSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    console.log(`✅ 找到上传区域: ${selector}`);
                    element.click();
                    await this.sleep(500);
                    return;
                }
            }
            console.log("❌ 未找到上传区域");
            return;
        }
        catch (error) {
            console.error("❌ 触发文件选择失败:", error);
            return;
        }
    }
    /**
     * 填写标题
     */
    async fillTitle(title) {
        try {
            console.log("📝 填写标题:", title);
            const titleSelectors = [
                "#title",
                'input[placeholder*="合适的标题能帮你获得更多流量哦"]',
                'input[placeholder*="标题"]',
                'input[placeholder*="必填"]',
                'input[type="text"]',
                '.ant-input[type="text"]',
            ];
            for (const selector of titleSelectors) {
                const titleElement = document.querySelector(selector);
                if (titleElement) {
                    console.log("✅ 找到标题输入框:", selector);
                    titleElement.focus();
                    titleElement.value = title;
                    titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                    titleElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                    console.log("✅ 标题填写成功");
                    return;
                }
            }
            console.log("❌ 未找到标题输入框");
            return;
        }
        catch (error) {
            console.error("填写标题失败:", error);
            return;
        }
    }
    /**
     * 填写描述
     */
    async fillDescription(description) {
        try {
            console.log("📝 填写描述:", description);
            const descSelectors = [
                "#summary",
                'textarea[placeholder*="快来简单描述下你的作品吧"]',
                'textarea[placeholder*="描述"]',
                'textarea[placeholder*="简介"]',
                "textarea",
                ".ant-input",
            ];
            for (const selector of descSelectors) {
                const descElement = document.querySelector(selector);
                if (descElement) {
                    console.log("✅ 找到描述输入框:", selector);
                    descElement.focus();
                    descElement.value = description;
                    descElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                    descElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                    console.log("✅ 描述填写成功");
                    return;
                }
            }
            console.log("❌ 未找到描述输入框");
            return;
        }
        catch (error) {
            console.error("填写描述失败:", error);
            return;
        }
    }
    /**
     * 上传视频文件 - 基于AHVP系统
     */
    async uploadVideo(videoData) {
        try {
            console.log("📹 开始上传视频...");
            // 获取视频文件
            let file;
            if (videoData.videoFile) {
                file = videoData.videoFile;
            }
            else if (videoData.url) {
                const response = await fetch(videoData.url);
                const arrayBuffer = await response.arrayBuffer();
                const extension = videoData.name.split(".").pop() || "mp4";
                const fileName = `${videoData.name.replace(/\.[^/.]+$/, "")}.${extension}`;
                file = new File([arrayBuffer], fileName, { type: "video/mp4" });
            }
            else {
                console.error("❌ 无效的视频数据");
                return;
            }
            console.log("📁 视频文件:", file.name, file.size, file.type);
            // 初始化AHVP上传器
            const initSuccess = await this.initAHVPUploader();
            if (!initSuccess) {
                console.error("❌ AHVP上传器初始化失败");
                return;
            }
            // 查找文件输入框并设置文件
            const fileInputs = document.querySelectorAll('input[type="file"]');
            let targetInput = null;
            for (const input of fileInputs) {
                const accept = input.getAttribute("accept") || "";
                const id = input.id || "";
                // 优先查找browser_0相关的输入框
                if (id.includes("browser_0") || !accept.includes("image") || accept.includes("video")) {
                    targetInput = input;
                    console.log(`✅ 找到目标输入框: ${id || "unnamed"}`);
                    break;
                }
            }
            if (!targetInput) {
                console.log("🔄 创建新的文件输入框");
                targetInput = document.createElement("input");
                targetInput.type = "file";
                targetInput.accept = "video/*";
                targetInput.style.display = "none";
                targetInput.id = "multipost_chejiahao_video_input";
                document.body.appendChild(targetInput);
            }
            // 使用DataTransfer API设置文件
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            targetInput.files = dataTransfer.files;
            console.log("✅ 文件设置到输入框成功");
            // 触发文件选择
            targetInput.dispatchEvent(new Event("change", { bubbles: true }));
            // 如果有AHVP上传器，尝试直接添加文件
            if (this.uploader && typeof this.uploader.addFile === "function") {
                console.log("🔄 通过AHVP上传器添加文件");
                try {
                    this.uploader.addFile(file);
                    console.log("✅ 文件已添加到AHVP上传器");
                }
                catch (_error) {
                    console.log("⚠️ AHVP添加文件失败，使用标准方式");
                }
            }
            // 等待上传开始
            console.log("⏳ 等待上传开始...");
            let uploadStarted = false;
            for (let i = 0; i < 30; i++) {
                await this.sleep(1000);
                // 检查是否有进度条出现
                const progressBars = document.querySelectorAll('[class*="progress"], .comps_uploadProgress__r8kTw');
                if (progressBars.length > 0) {
                    console.log("✅ 检测到上传进度条，上传已开始");
                    uploadStarted = true;
                    break;
                }
                // 检查表单是否可用（上传完成的标志）
                const titleInput = document.querySelector("#title");
                if (titleInput && titleInput.offsetParent !== null) {
                    console.log("✅ 检测到表单可用，可能上传已完成");
                    uploadStarted = true;
                    break;
                }
            }
            if (!uploadStarted) {
                console.log("⚠️ 未检测到明确的上传开始信号，但文件已设置");
            }
            console.log("🎉 视频文件上传流程完成");
            return;
        }
        catch (error) {
            console.error("❌ 视频上传失败:", error);
            return;
        }
    }
    /**
     * 自动发布
     */
    async autoPublish() {
        try {
            console.log("🚀 开始自动发布...");
            const publishSelectors = [
                'button:contains("发布")',
                'button[title*="发布"]',
                ".publish-btn",
                "#publishBtn",
                ".ant-btn-primary",
                'button[type="submit"]',
            ];
            // 由于CSS选择器不支持:contains，使用JavaScript查找
            const buttons = document.querySelectorAll("button");
            for (const button of buttons) {
                const textContent = button.textContent?.trim() || "";
                if (textContent.includes("发布")) {
                    console.log("✅ 找到发布按钮:", textContent);
                    button.click();
                    await this.sleep(2000);
                    console.log("✅ 发布按钮点击成功");
                    return;
                }
            }
            for (const selector of publishSelectors) {
                if (!selector.includes(":contains")) {
                    const publishButton = document.querySelector(selector);
                    if (publishButton) {
                        console.log("✅ 找到发布按钮:", selector);
                        publishButton.click();
                        await this.sleep(2000);
                        console.log("✅ 发布按钮点击成功");
                        return;
                    }
                }
            }
            console.log("❌ 未找到发布按钮");
            return;
        }
        catch (error) {
            console.error("自动发布失败:", error);
            return;
        }
    }
};
// 确保类在全局作用域中可用，以便在内容脚本中访问
if (typeof window !== "undefined") {
    window.ChejiahaoVideoUploader = ChejiahaoVideoUploader;
}
/**
 * 车家号视频发布器 - 基于AHVP系统
 */
export async function VideoChejiahao(data) {
    console.log("🚀 开始车家号视频发布流程...");
    console.log("🔍 当前页面:", window.location.href);
    try {
        // 检查是否在车家号页面
        if (!window.location.href.includes("creator.autohome.com.cn")) {
            console.error("❌ 不在车家号页面，当前页面:", window.location.href);
            return;
        }
        // 解析视频数据
        if (!data || !data.data) {
            console.error("❌ 缺少视频数据");
            return;
        }
        const { content, video, title, description, cover } = data.data;
        console.log("📝 视频数据:", {
            title: title?.substring(0, 50),
            contentLength: content?.length,
            hasVideo: !!video,
            hasCover: !!cover,
            isAutoPublish: data.isAutoPublish,
        });
        // 内联定义车家号视频上传器类，避免模块导入问题
        const ChejiahaoVideoUploaderInline = class ChejiahaoVideoUploader {
            uploader = null;
            uploadToken = "";
            usedHardcodedUploadFallback = false;
            /**
             * 等待指定时间
             */
            sleep(ms) {
                return new Promise((resolve) => setTimeout(resolve, ms));
            }
            /**
             * 获取上传凭证
             */
            async getUploadToken() {
                try {
                    console.log("🔑 获取车家号上传凭证...");
                    // 尝试从已有的全局变量获取
                    if (window.browser_0_?.params?.callback) {
                        console.log("✅ 从全局变量获取上传凭证");
                        return window.browser_0_.params.callback;
                    }
                    // 尝试从页面API获取
                    const response = await fetch("https://creator.autohome.com.cn/openapi/content-api/video/get_upload_info?bizType=1", {
                        method: "GET",
                        credentials: "include",
                        headers: {
                            accept: "application/json;charset=UTF-8",
                        },
                    });
                    if (response.ok) {
                        const data = await response.json();
                        console.log("✅ 获取上传凭证成功:", data);
                        this.uploadToken = data.token || "";
                        return this.uploadToken;
                    }
                    console.log("⚠️ 无法获取上传凭证，使用默认值");
                    return "";
                }
                catch (error) {
                    console.error("❌ 获取上传凭证失败:", error);
                    return "";
                }
            }
            /**
             * 初始化AHVP上传器
             */
            async initAHVPUploader() {
                try {
                    console.log("🚀 初始化AHVP上传器...");
                    // 等待AHVP系统加载
                    if (!window.AHVP) {
                        console.log("🔄 等待AHVP系统加载...");
                        let attempts = 0;
                        while (!window.AHVP && attempts < 30) {
                            await this.sleep(1000);
                            attempts++;
                        }
                    }
                    const AHVP = window.AHVP;
                    if (!AHVP) {
                        console.error("❌ AHVP系统未加载");
                        return false;
                    }
                    console.log("✅ AHVP系统已加载");
                    // 获取上传凭证
                    const token = await this.getUploadToken();
                    // 如果已有上传器实例，先取消
                    if (window.browser_0_) {
                        try {
                            window.browser_0_.cancel();
                        }
                        catch (_e) {
                            console.log("🔄 清理旧的上传器实例");
                        }
                    }
                    // 创建新的上传器
                    this.uploader = AHVP.newUploader({
                        h5: true,
                        target: "browser_0",
                        dragtarget: "browser_0",
                        waitstart: 1,
                        param: "lt=30&gt=3",
                        iw: 0,
                        provider: "autohomeMulti",
                        callback: token,
                        mt: 1,
                    });
                    if (this.uploader) {
                        // 存储到全局变量
                        window.browser_0_ = this.uploader;
                        console.log("✅ AHVP上传器创建成功");
                        return true;
                    }
                    console.error("❌ AHVP上传器创建失败");
                    return false;
                }
                catch (error) {
                    console.error("❌ 初始化AHVP上传器失败:", error);
                    return false;
                }
            }
            /**
             * 填写标题
             */
            async fillTitle(title) {
                try {
                    console.log("📝 填写标题:", title);
                    // 等待页面加载
                    await this.sleep(3000);
                    // 直接使用找到的title输入框
                    const titleElement = document.querySelector("#title");
                    if (titleElement) {
                        console.log("✅ 找到标题输入框: #title");
                        console.log("  - placeholder:", titleElement.placeholder);
                        console.log("  - 可见性:", titleElement.offsetParent !== null ? "可见" : "隐藏");
                        try {
                            // 方法1: 直接设置值
                            titleElement.value = title;
                            // 方法2: 使用原生值设置器
                            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
                            if (nativeSetter) {
                                nativeSetter.call(titleElement, title);
                            }
                            // 方法3: 模拟用户输入
                            titleElement.focus();
                            // 清空原有内容
                            titleElement.select();
                            // 逐字符输入模拟真实用户行为
                            for (let i = 0; i < title.length; i++) {
                                const _char = title[i];
                                titleElement.value = title.substring(0, i + 1);
                                // 触发输入事件
                                titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                await this.sleep(50); // 短暂延迟模拟输入
                            }
                            // 触发多种事件确保React等框架能识别
                            titleElement.dispatchEvent(new Event("focus", { bubbles: true }));
                            titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                            titleElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            titleElement.dispatchEvent(new Event("blur", { bubbles: true }));
                            // 验证设置是否成功
                            console.log(`✅ 标题设置后验证: value="${titleElement.value}"`);
                            if (titleElement.value === title) {
                                console.log("✅ 标题填写成功");
                                return;
                            }
                            console.log("⚠️ 标题值不匹配，继续...");
                        }
                        catch (e) {
                            console.error("设置标题值时出错:", e);
                        }
                    }
                    else {
                        console.log("❌ 未找到#title输入框");
                    }
                    console.log("❌ 标题填写失败，但继续流程");
                    return;
                }
                catch (error) {
                    console.error("填写标题失败:", error);
                    return;
                }
            }
            /**
             * 自动勾选原创和首发
             */
            async checkOriginalAndFirst() {
                try {
                    console.log("✅ 开始勾选原创和首发...");
                    // 等待页面加载
                    await this.sleep(2000);
                    // 勾选原创
                    const originalCheckbox = document.querySelector("#isOriginal");
                    if (originalCheckbox) {
                        if (!originalCheckbox.checked) {
                            originalCheckbox.click();
                            console.log("✅ 已勾选原创");
                        }
                        else {
                            console.log("✅ 原创已勾选");
                        }
                    }
                    else {
                        console.log("❌ 未找到原创复选框");
                    }
                    // 勾选首发
                    const firstCheckbox = document.querySelector("#isFirst");
                    if (firstCheckbox) {
                        if (!firstCheckbox.checked) {
                            firstCheckbox.click();
                            console.log("✅ 已勾选首发");
                        }
                        else {
                            console.log("✅ 首发已勾选");
                        }
                    }
                    else {
                        console.log("❌ 未找到首发复选框");
                    }
                    return;
                }
                catch (error) {
                    console.error("❌ 勾选原创和首发失败:", error);
                    return;
                }
            }
            /**
             * 填写描述
             */
            async fillDescription(description) {
                try {
                    console.log("📝 填写描述:", description);
                    const descSelectors = [
                        "#summary",
                        'textarea[placeholder*="快来简单描述下你的作品吧"]',
                        'textarea[placeholder*="描述"]',
                        'textarea[placeholder*="简介"]',
                        "textarea",
                        ".ant-input",
                    ];
                    for (const selector of descSelectors) {
                        const descElement = document.querySelector(selector);
                        if (descElement) {
                            console.log("✅ 找到描述输入框:", selector);
                            descElement.focus();
                            descElement.value = description;
                            descElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                            descElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 描述填写成功");
                            return;
                        }
                    }
                    console.log("❌ 未找到描述输入框");
                    return;
                }
                catch (error) {
                    console.error("填写描述失败:", error);
                    return;
                }
            }
            async waitForElementOptional(selector, timeout = 10000) {
                return new Promise((resolve) => {
                    const element = document.querySelector(selector);
                    if (element) {
                        resolve(element);
                        return;
                    }
                    const observer = new MutationObserver(() => {
                        const element = document.querySelector(selector);
                        if (element) {
                            observer.disconnect();
                            resolve(element);
                        }
                    });
                    if (!document.body) {
                        resolve(null);
                        return;
                    }
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true,
                    });
                    setTimeout(() => {
                        observer.disconnect();
                        resolve(null);
                    }, timeout);
                });
            }
            async waitForElementInRootOptional(selector, root, timeout = 10000) {
                return new Promise((resolve) => {
                    const element = root.querySelector(selector);
                    if (element) {
                        resolve(element);
                        return;
                    }
                    const observeRoot = root instanceof Document ? root.body : root;
                    if (!observeRoot) {
                        resolve(null);
                        return;
                    }
                    const observer = new MutationObserver(() => {
                        const element = root.querySelector(selector);
                        if (element) {
                            observer.disconnect();
                            resolve(element);
                        }
                    });
                    observer.observe(observeRoot, {
                        childList: true,
                        subtree: true,
                    });
                    setTimeout(() => {
                        observer.disconnect();
                        resolve(null);
                    }, timeout);
                });
            }
            dispatchInputEvents(element) {
                element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
            }
            isElementVisible(element) {
                return !!(element.offsetParent || element.getClientRects().length > 0);
            }
            findExactTextControl(root, text) {
                return (Array.from(root.querySelectorAll("button, a, span")).find((element) => element.textContent?.trim() === text && this.isElementVisible(element)) || null);
            }
            findCoverEditButton() {
                const coverContainerSelectors = [
                    "[class*='cover']",
                    "[class*='Cover']",
                    "[id*='cover']",
                    "[id*='Cover']",
                    "[class*='poster']",
                    "[class*='Poster']",
                    "[id*='poster']",
                    "[id*='Poster']",
                    "[class*='thumb']",
                    "[class*='Thumb']",
                    "[id*='thumb']",
                    "[id*='Thumb']",
                ];
                for (const container of document.querySelectorAll(coverContainerSelectors.join(","))) {
                    const editButton = this.findExactTextControl(container, "编辑");
                    if (editButton)
                        return editButton;
                }
                const coverTextElements = Array.from(document.querySelectorAll("label, div, span, p")).filter((element) => {
                    const text = element.textContent?.trim() || "";
                    return text.includes("封面") && text.length <= 300;
                });
                for (const element of coverTextElements) {
                    let container = element;
                    let depth = 0;
                    while (container && container !== document.body && depth < 4) {
                        const text = container.textContent || "";
                        const controls = container.querySelectorAll("button, a, span");
                        if (text.includes("封面") && text.length <= 2000 && controls.length <= 20) {
                            const editButton = this.findExactTextControl(container, "编辑");
                            if (editButton)
                                return editButton;
                        }
                        container = container.parentElement;
                        depth++;
                    }
                }
                return null;
            }
            closeCoverEditor(iframeDocument) {
                const closeSelectors = [
                    "button[aria-label='Close']",
                    "button[aria-label='关闭']",
                    ".ant-modal-close",
                    ".semi-modal-close",
                    "[class*='modal'] [class*='close']",
                    "[class*='Modal'] [class*='close']",
                ];
                const roots = [iframeDocument, document].filter(Boolean);
                for (const root of roots) {
                    for (const selector of closeSelectors) {
                        const closeButton = root.querySelector(selector);
                        if (closeButton && this.isElementVisible(closeButton)) {
                            closeButton.click();
                            return;
                        }
                    }
                    const modalRoots = Array.from(root.querySelectorAll("[role='dialog'], [class*='modal'], [class*='Modal']"));
                    for (const modalRoot of modalRoots) {
                        const textCloseButton = this.findExactTextControl(modalRoot, "取消") || this.findExactTextControl(modalRoot, "关闭");
                        if (textCloseButton) {
                            textCloseButton.click();
                            return;
                        }
                    }
                }
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
                document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true }));
            }
            async createImageFile(fileData) {
                try {
                    if (!fileData.url) {
                        console.log("车家号封面数据缺少 URL，跳过上传");
                        return null;
                    }
                    if (fileData.type && !fileData.type.includes("image/")) {
                        console.log("车家号封面不是图片类型，跳过上传:", fileData.type);
                        return null;
                    }
                    const response = await fetch(fileData.url);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    const blob = await response.blob();
                    return new File([blob], fileData.name || `cover_${Date.now()}.png`, {
                        type: fileData.type || blob.type || "image/png",
                    });
                }
                catch (error) {
                    console.warn("车家号封面文件获取失败:", error);
                    return null;
                }
            }
            async uploadCover(coverData) {
                let coverEditorOpened = false;
                let coverIframeDocument = null;
                try {
                    console.log("🖼️ 开始上传车家号封面:", coverData);
                    const editCoverButton = this.findCoverEditButton();
                    console.debug("cover edit button -->", editCoverButton);
                    if (!editCoverButton) {
                        console.log("未找到车家号封面编辑入口，跳过封面上传");
                        return false;
                    }
                    editCoverButton.click();
                    coverEditorOpened = true;
                    const iframe = (await this.waitForElementOptional("iframe[name='mofangIframe']", 5000));
                    console.debug("cover iframe -->", iframe);
                    const iframeDocument = iframe?.contentDocument || null;
                    coverIframeDocument = iframeDocument;
                    if (!iframeDocument) {
                        console.log("未找到车家号封面编辑 iframe，跳过封面上传");
                        this.closeCoverEditor();
                        return false;
                    }
                    const fileInput = (await this.waitForElementInRootOptional('input[accept="image/*"]', iframeDocument, 5000));
                    console.debug("cover file input -->", fileInput);
                    if (!fileInput) {
                        console.log("未找到车家号封面上传输入框，跳过封面上传");
                        this.closeCoverEditor(iframeDocument);
                        return false;
                    }
                    const coverFile = await this.createImageFile(coverData);
                    if (!coverFile) {
                        this.closeCoverEditor(iframeDocument);
                        return false;
                    }
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(coverFile);
                    if (dataTransfer.files.length === 0) {
                        this.closeCoverEditor(iframeDocument);
                        return false;
                    }
                    fileInput.files = dataTransfer.files;
                    this.dispatchInputEvents(fileInput);
                    console.log("车家号封面上传操作已触发");
                    await this.sleep(3000);
                    const doneButton = Array.from(iframeDocument.querySelectorAll("span")).find((span) => span.textContent?.trim() === "完成制作");
                    console.debug("cover done button -->", doneButton);
                    if (!doneButton) {
                        console.log("未找到车家号封面完成制作按钮，跳过确认");
                        this.closeCoverEditor(iframeDocument);
                        return false;
                    }
                    doneButton.click();
                    return true;
                }
                catch (error) {
                    console.warn("车家号封面上传失败，继续发布流程:", error);
                    if (coverEditorOpened) {
                        this.closeCoverEditor(coverIframeDocument);
                    }
                    return false;
                }
            }
            getUploadStatusText() {
                return Array.from(document.querySelectorAll("#browser_0, div[data-uploadstatus], [class*='upload'], [class*='progress'], .ant-progress"))
                    .map((element) => element.textContent?.trim() || "")
                    .filter(Boolean)
                    .join("\n");
            }
            hasUploadFailureText(text) {
                return ["上传失败", "上传出错", "上传异常", "转码失败", "重新上传"].some((item) => text.includes(item));
            }
            hasUploadProgressText(text) {
                return ["上传中", "已上传", "剩余时间", "上传速度", "%"].some((item) => text.includes(item));
            }
            hasUploadSuccessText(text) {
                return ["上传完成", "上传成功", "视频上传完成", "视频上传成功"].some((item) => text.includes(item));
            }
            hasUploadSuccessMarker(statusText = this.getUploadStatusText()) {
                const successElement = document.querySelector("div[data-uploadstatus='success'], div[data-uploadstatus='complete'], div[data-uploadstatus='done']");
                return !!successElement || this.hasUploadSuccessText(statusText);
            }
            async waitForVideoUploadComplete(timeout = 120000, uploadWasSeen = false, successWasPresentBeforeCurrentUpload = false) {
                const startedAt = Date.now();
                let sawUploadSignal = uploadWasSeen;
                let successWasAbsentAfterCurrentUpload = !successWasPresentBeforeCurrentUpload;
                let loggedStaleSuccessMarker = false;
                while (Date.now() - startedAt < timeout) {
                    const statusText = this.getUploadStatusText();
                    if (this.hasUploadFailureText(statusText)) {
                        console.warn("车家号视频上传失败，跳过自动发布:", statusText.substring(0, 200));
                        return false;
                    }
                    const hasSuccessMarker = this.hasUploadSuccessMarker(statusText);
                    if (hasSuccessMarker) {
                        if (successWasAbsentAfterCurrentUpload) {
                            console.log("✅ 车家号视频上传已确认完成");
                            return true;
                        }
                        if (!loggedStaleSuccessMarker) {
                            console.warn("车家号检测到本次上传前已存在的完成标记，等待当前上传产生新的完成状态");
                            loggedStaleSuccessMarker = true;
                        }
                    }
                    else {
                        successWasAbsentAfterCurrentUpload = true;
                    }
                    const uploadingElement = document.querySelector("div[data-uploadstatus='uploading']");
                    const isUploading = !!uploadingElement || this.hasUploadProgressText(statusText);
                    if (isUploading) {
                        sawUploadSignal = true;
                    }
                    await this.sleep(3000);
                }
                console.warn(sawUploadSignal
                    ? "车家号视频上传超时：未观察到明确上传成功标记，跳过自动发布"
                    : "车家号视频上传超时：未观察到上传状态或成功标记，跳过自动发布");
                return false;
            }
            async confirmVideoUploadIfNeeded(waitForCompletion, timeout = 120000, uploadWasSeen = false, successWasPresentBeforeCurrentUpload = false) {
                if (!waitForCompletion) {
                    console.log("车家号手动发布流程：视频上传已触发，不等待上传完成");
                    return false;
                }
                return await this.waitForVideoUploadComplete(timeout, uploadWasSeen, successWasPresentBeforeCurrentUpload);
            }
            async publishIfAutoEnabled(autoPublish, videoUploaded) {
                if (autoPublish !== true)
                    return;
                if (!videoUploaded) {
                    console.warn("车家号自动发布已跳过：视频未确认上传成功");
                    return;
                }
                if (this.usedHardcodedUploadFallback) {
                    console.warn("车家号自动发布已跳过：本次上传使用了硬编码 AHVP fallback 参数");
                    return;
                }
                await this.sleep(5000);
                const fuzzyPublishButton = Array.from(document.querySelectorAll("button")).find((button) => {
                    const visibleText = button.innerText || button.textContent || "";
                    return this.isElementVisible(button) && visibleText.includes("发布");
                });
                const exactPublishButton = document.querySelector("div.button_publish.item.editor-btn.editor-main-btn");
                const publishButton = fuzzyPublishButton || exactPublishButton || null;
                console.debug("sendButton -->", publishButton);
                if (!publishButton) {
                    console.debug("未找到车家号发布按钮");
                    return;
                }
                publishButton.dispatchEvent(new Event("click", { bubbles: true }));
                console.log("✅ 车家号发布按钮点击成功");
            }
            /**
             * 创建具有完整功能的文件项对象
             */
            createFileItem(file) {
                const fileItem = {
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                    file: file,
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    state: "ready",
                    // 必要的方法
                    getID: function () {
                        return this.id;
                    },
                    getState: function () {
                        return this.state;
                    },
                    setState: function (state) {
                        this.state = state;
                        this.trigger("state", state);
                        return this;
                    },
                    getFile: function () {
                        return this.file;
                    },
                    getSize: function () {
                        return this.size;
                    },
                    getName: function () {
                        return this.name;
                    },
                    getType: function () {
                        return this.type;
                    },
                    // 事件系统
                    eventListeners: new Map(),
                    on: function (event, callback) {
                        if (!this.eventListeners.has(event)) {
                            this.eventListeners.set(event, []);
                        }
                        this.eventListeners.get(event).push(callback);
                        return this;
                    },
                    off: function (event, callback) {
                        if (this.eventListeners.has(event)) {
                            const listeners = this.eventListeners.get(event);
                            const index = listeners.indexOf(callback);
                            if (index > -1) {
                                listeners.splice(index, 1);
                            }
                        }
                        return this;
                    },
                    trigger: function (event, data) {
                        if (this.eventListeners.has(event)) {
                            this.eventListeners.get(event).forEach((callback) => {
                                try {
                                    callback(data);
                                }
                                catch (e) {
                                    console.error("文件项事件回调错误:", e);
                                }
                            });
                        }
                        return this;
                    },
                };
                return fileItem;
            }
            /**
             * 上传视频文件 - 基于车家号muploader系统（使用成功的控制台代码）
             */
            async uploadVideo(videoData, waitForCompletion = false) {
                try {
                    console.log("📹 开始上传视频...");
                    // 获取视频文件
                    let file;
                    if (videoData.videoFile) {
                        file = videoData.videoFile;
                    }
                    else if (videoData.url) {
                        const response = await fetch(videoData.url);
                        const arrayBuffer = await response.arrayBuffer();
                        const extension = videoData.name.split(".").pop() || "mp4";
                        const fileName = `${videoData.name.replace(/\.[^/.]+$/, "")}.${extension}`;
                        file = new File([arrayBuffer], fileName, { type: "video/mp4" });
                    }
                    else {
                        console.error("❌ 无效的视频数据");
                        return false;
                    }
                    console.log("📁 视频文件:", file.name, file.size, file.type);
                    let currentUploadTriggered = false;
                    let currentUploadSuccessWasPresentBeforeTrigger = false;
                    let currentUploadBaselineCaptured = false;
                    const captureCurrentUploadBaseline = () => {
                        if (currentUploadBaselineCaptured)
                            return;
                        currentUploadSuccessWasPresentBeforeTrigger = this.hasUploadSuccessMarker();
                        currentUploadBaselineCaptured = true;
                        if (currentUploadSuccessWasPresentBeforeTrigger) {
                            console.log("⚠️ 检测到旧的上传完成标记，本次上传需要等待新的完成状态");
                        }
                    };
                    const markCurrentUploadTriggered = () => {
                        currentUploadTriggered = true;
                    };
                    const confirmCurrentUploadIfNeeded = async (timeout = 120000, uploadWasSeen = false) => {
                        if (!currentUploadTriggered) {
                            console.warn("车家号忽略上传状态：当前视频文件尚未触发选择或change事件");
                            return false;
                        }
                        return await this.confirmVideoUploadIfNeeded(waitForCompletion, timeout, uploadWasSeen, currentUploadSuccessWasPresentBeforeTrigger);
                    };
                    // 等待页面完全加载
                    console.log("⏳ 等待页面加载完成...");
                    await this.sleep(5000);
                    // 首先检查上传区域状态
                    console.log("🔍 检查上传区域状态...");
                    const browserElement = document.querySelector("#browser_0");
                    if (browserElement) {
                        console.log("✅ 找到browser_0元素");
                        // 检查browser_0内的a标签
                        const uploadLink = browserElement.querySelector("a");
                        if (uploadLink) {
                            console.log("✅ 找到browser_0内的a标签");
                            console.log("  - a标签文本:", uploadLink.textContent?.substring(0, 50));
                            console.log("  - a标签href:", uploadLink.href);
                            console.log("  - a标签class:", uploadLink.className);
                            const linkText = uploadLink.textContent || "";
                            // 检查a标签的内容变化来判断上传状态
                            if (linkText.includes("上传中") ||
                                linkText.includes("已上传") ||
                                linkText.includes("上传速度") ||
                                linkText.includes("剩余时间")) {
                                console.log("⚠️ 检测到上传状态，但当前视频尚未触发上传，继续设置本次文件");
                            }
                            if (linkText.includes("上传失败") || linkText.includes("重新上传")) {
                                console.log("❌ 检测到上传失败状态");
                                return false;
                            }
                            if (this.hasUploadSuccessText(linkText)) {
                                console.log("⚠️ 检测到旧的上传完成状态，继续设置本次文件");
                            }
                        }
                        else {
                            console.log("❌ 未找到browser_0内的a标签");
                        }
                        console.log("  - browser_0子元素数量:", browserElement.children.length);
                        console.log("  - browser_0内容:", browserElement.textContent?.substring(0, 100));
                        // 如果a标签消失或内容变化，可能上传已经开始
                        if (!uploadLink || browserElement.children.length === 0) {
                            console.log("⚠️ a标签消失或browser_0内容变化，检查上传状态...");
                            const progressElements = document.querySelectorAll('[class*="progress"], [class*="upload"], .ant-progress');
                            if (progressElements.length > 0) {
                                console.log("⚠️ 检测到既有上传进度元素，继续设置本次文件");
                            }
                        }
                    }
                    else {
                        console.log("❌ 未找到browser_0元素");
                    }
                    // 检查车家号的上传系统
                    console.log("🔍 检查车家号上传系统...");
                    console.log("  - window.AHVP:", typeof window.AHVP);
                    console.log("  - window.muploader:", typeof window.muploader);
                    console.log("  - window.browser_0_:", typeof window.browser_0_);
                    // 诊断AHVP加载状态
                    console.log("🔍 诊断AHVP加载状态...");
                    console.log("  - window.AHVP:", typeof window.AHVP);
                    console.log("  - window.muploader:", typeof window.muploader);
                    console.log("  - window.browser_0_:", typeof window.browser_0_);
                    // 检查页面是否包含AHVP脚本
                    const scripts = Array.from(document.querySelectorAll("script")).map((s) => s.src);
                    const ahvpScripts = scripts.filter((src) => src && (src.includes("ahvp") || src.includes("uploader")));
                    console.log("🔍 AHVP相关脚本:", ahvpScripts);
                    // 检查当前URL和页面状态
                    console.log("🔍 当前页面信息:");
                    console.log("  - URL:", window.location.href);
                    console.log("  - 标题:", document.title);
                    // 查找上传相关元素
                    const uploadElements = document.querySelectorAll('#browser_0, [class*="upload"], [id*="upload"]');
                    console.log("🔍 上传相关元素数量:", uploadElements.length);
                    // 先主动尝试触发上传，然后再等待AHVP
                    console.log("🔄 先尝试主动触发上传...");
                    const browserElementForUpload = document.querySelector("#browser_0");
                    if (browserElementForUpload) {
                        console.log("✅ 找到browser_0，尝试直接文件操作");
                        // 创建文件输入框附加到browser_0
                        const fileInput = document.createElement("input");
                        fileInput.type = "file";
                        fileInput.accept = "video/*,.mp4,.avi,.mov,.wmv";
                        fileInput.style.position = "absolute";
                        fileInput.style.opacity = "0";
                        fileInput.style.width = "100%";
                        fileInput.style.height = "100%";
                        fileInput.style.top = "0";
                        fileInput.style.left = "0";
                        fileInput.style.zIndex = "9999";
                        fileInput.id = `multipost_direct_${Date.now()}`;
                        browserElementForUpload.style.position = "relative";
                        browserElementForUpload.appendChild(fileInput);
                        console.log("✅ 文件输入框已附加到browser_0");
                        // 设置文件并触发选择
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        captureCurrentUploadBaseline();
                        fileInput.files = dataTransfer.files;
                        // 尝试直接触发拖放事件来设置文件
                        console.log("🔧 尝试通过拖放事件设置文件...");
                        // 创建拖放事件
                        const dragEnterEvent = new DragEvent("dragenter", {
                            bubbles: true,
                            cancelable: true,
                            dataTransfer: new DataTransfer(),
                        });
                        const dropEvent = new DragEvent("drop", {
                            bubbles: true,
                            cancelable: true,
                            dataTransfer: dataTransfer,
                        });
                        // 在browser_0上触发拖放事件
                        browserElementForUpload.dispatchEvent(dragEnterEvent);
                        await this.sleep(100);
                        browserElementForUpload.dispatchEvent(dropEvent);
                        markCurrentUploadTriggered();
                        console.log("✅ 拖放事件已触发");
                        // 等待一下让DOM更新
                        await this.sleep(2000);
                        // 检查browser_0是否有变化
                        const uploadLink = browserElementForUpload.querySelector("a");
                        if (uploadLink) {
                            const linkText = uploadLink.textContent || "";
                            console.log("📋 点击后的a标签文本:", linkText.substring(0, 100));
                            if (linkText.includes("上传中") ||
                                linkText.includes("0.00%") ||
                                linkText.includes("已上传") ||
                                linkText.includes("上传速度")) {
                                console.log("✅ 触发成功！检测到实际上传状态");
                                return await confirmCurrentUploadIfNeeded(120000, true);
                            }
                            if (this.hasUploadSuccessText(linkText)) {
                                console.log("🎉 检测到上传完成状态，等待确认是否属于本次上传");
                                return await confirmCurrentUploadIfNeeded(120000, false);
                            }
                        }
                        // 尝试直接在已存在的文件输入框中设置文件
                        console.log("🔧 尝试找到现有的文件输入框并设置文件...");
                        const existingFileInputs = browserElementForUpload.querySelectorAll('input[type="file"]');
                        let fileSetSuccess = false;
                        existingFileInputs.forEach((existingInput, index) => {
                            console.log(`📋 找到现有文件输入框 ${index + 1}:`, existingInput.accept);
                            if (existingInput.accept?.includes("video")) {
                                const existingDataTransfer = new DataTransfer();
                                existingDataTransfer.items.add(file);
                                captureCurrentUploadBaseline();
                                existingInput.files = existingDataTransfer.files;
                                // 触发多种事件
                                existingInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                existingInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                markCurrentUploadTriggered();
                                console.log("✅ 已在现有文件输入框中设置文件");
                                fileSetSuccess = true;
                            }
                        });
                        if (!fileSetSuccess) {
                            // 尝试点击browser_0的a标签来模拟用户操作
                            const uploadLinkForClick = browserElementForUpload.querySelector("a");
                            if (uploadLinkForClick) {
                                console.log("🖱️ 尝试模拟用户点击browser_0的a标签...");
                                // 先移除我们添加的文件输入框
                                fileInput.remove();
                                // 模拟用户点击a标签
                                uploadLinkForClick.click();
                                // 等待用户操作完成后再次添加文件
                                await this.sleep(1000);
                                // 重新创建文件输入框
                                const newFileInput = document.createElement("input");
                                newFileInput.type = "file";
                                newFileInput.accept = "video/*,.mp4,.avi,.mov,.wmv";
                                newFileInput.style.position = "absolute";
                                newFileInput.style.opacity = "0";
                                newFileInput.style.width = "100%";
                                newFileInput.style.height = "100%";
                                newFileInput.style.top = "0";
                                newFileInput.style.left = "0";
                                newFileInput.style.zIndex = "9999";
                                newFileInput.id = `multipost_after_click_${Date.now()}`;
                                browserElementForUpload.appendChild(newFileInput);
                                // 设置文件
                                const newDataTransfer = new DataTransfer();
                                newDataTransfer.items.add(file);
                                captureCurrentUploadBaseline();
                                newFileInput.files = newDataTransfer.files;
                                // 触发事件
                                console.log("🔄 在用户激活后触发文件change事件...");
                                newFileInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                markCurrentUploadTriggered();
                                // 清理
                                newFileInput.remove();
                            }
                            else {
                                // 如果没有a标签，直接尝试触发change事件
                                console.log("🔄 触发文件change事件...");
                                fileInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                markCurrentUploadTriggered();
                            }
                        }
                        await this.sleep(2000);
                        // 再次检查状态
                        const finalLink = browserElementForUpload.querySelector("a");
                        if (finalLink) {
                            const finalText = finalLink.textContent || "";
                            console.log("📋 最终的a标签文本:", finalText.substring(0, 100));
                            if (finalText.includes("上传中") ||
                                finalText.includes("0.00%") ||
                                finalText.includes("已上传") ||
                                finalText.includes("上传速度")) {
                                console.log("✅ 文件上传触发成功！检测到实际上传状态");
                                return await confirmCurrentUploadIfNeeded(120000, true);
                            }
                            if (this.hasUploadSuccessText(finalText)) {
                                console.log("🎉 检测到上传完成状态，等待确认是否属于本次上传");
                                return await confirmCurrentUploadIfNeeded(120000, false);
                            }
                        }
                        console.log("❌ 主动文件操作未能触发上传");
                        // 清理文件输入框
                        if (fileInput.parentNode) {
                            fileInput.remove();
                        }
                    }
                    // 如果直接操作失败，再尝试AHVP系统
                    console.log("⏳ 直接操作无效，尝试等待AHVP系统...");
                    // 等待AHVP系统加载（基于我们的成功测试经验）
                    console.log("🔄 等待AHVP系统加载...");
                    let AHVP = window.AHVP;
                    let attempts = 0;
                    while (!AHVP && attempts < 30) {
                        await this.sleep(1000);
                        AHVP = window.AHVP;
                        attempts++;
                        if (attempts % 5 === 0) {
                            console.log(`  - 尝试 ${attempts}/30: ${typeof AHVP}`);
                            // 每5秒尝试触发上传区域
                            const uploadArea = document.querySelector('#browser_0, [class*="upload"]');
                            if (uploadArea && attempts === 5) {
                                console.log("🖱️ 尝试点击上传区域触发AHVP加载...");
                                uploadArea.click();
                                await this.sleep(1000);
                            }
                        }
                    }
                    if (!AHVP) {
                        console.error("❌ AHVP系统未加载，但检测到AHVP脚本已存在");
                        console.error("💡 CSP策略禁止了eval()，无法强制重新初始化");
                        console.log("🔄 转为检测现有上传状态...");
                        // 既然无法使用AHVP，检查是否已经有其他上传机制在工作
                        // 详细检查页面状态
                        console.log("🔍 详细检查页面状态...");
                        // 1. 精确检查browser_0内的a标签
                        const browserElement = document.querySelector("#browser_0");
                        if (browserElement) {
                            console.log("✅ 找到browser_0元素");
                            const uploadLink = browserElement.querySelector("a");
                            if (uploadLink) {
                                console.log("✅ 找到browser_0内的a标签");
                                const linkText = uploadLink.textContent || "";
                                console.log("  - a标签文本:", linkText.substring(0, 100));
                                // 直接从a标签文本判断上传状态
                                if (linkText.includes("上传中") ||
                                    linkText.includes("已上传") ||
                                    linkText.includes("上传速度") ||
                                    linkText.includes("剩余时间") ||
                                    linkText.includes("0.00%")) {
                                    console.log("✅ a标签显示上传状态，上传正在进行中");
                                    return await confirmCurrentUploadIfNeeded(120000, true);
                                }
                                if (linkText.includes("上传失败") || linkText.includes("重新上传")) {
                                    console.log("❌ a标签显示上传失败");
                                    return false;
                                }
                                if (this.hasUploadSuccessText(linkText)) {
                                    console.log("🎉 a标签显示上传完成，等待确认是否属于本次上传");
                                    return await confirmCurrentUploadIfNeeded(120000, false);
                                }
                            }
                            else {
                                console.log("❌ 未找到browser_0内的a标签");
                                // 如果a标签不存在，可能已经被上传状态替换了
                                const browserText = browserElement.textContent || "";
                                if (browserText.includes("上传中") || browserText.includes("已上传")) {
                                    console.log("✅ browser_0显示上传状态（a标签可能已被替换）");
                                    return await confirmCurrentUploadIfNeeded(120000, true);
                                }
                            }
                        }
                        else {
                            console.log("❌ 未找到browser_0元素");
                        }
                        // 3. 检查是否有文件已被添加到其他上传系统
                        const fileInputs = document.querySelectorAll('input[type="file"]');
                        let filesFound = false;
                        fileInputs.forEach((input, index) => {
                            if (input.files && input.files.length > 0) {
                                console.log(`✅ 文件输入框${index}已有文件:`, input.files[0].name);
                                filesFound = true;
                            }
                        });
                        if (filesFound) {
                            console.log("✅ 检测到文件已设置到输入框，上传可能已开始");
                            return await confirmCurrentUploadIfNeeded(30000, false);
                        }
                        // 4. 检查是否有XHR上传活动
                        const originalXHR = window.XMLHttpRequest;
                        let uploadActive = false;
                        window.XMLHttpRequest = () => {
                            const xhr = new originalXHR();
                            const originalOpen = xhr.open;
                            xhr.open = function (method, url, ...args) {
                                if (url?.toString().includes("upload")) {
                                    console.log("✅ 检测到上传XHR:", method, url);
                                    uploadActive = true;
                                }
                                return originalOpen.apply(this, [method, url, ...args]);
                            };
                            return xhr;
                        };
                        // 等待几秒看是否有上传活动
                        await this.sleep(3000);
                        // 恢复原始XHR
                        window.XMLHttpRequest = originalXHR;
                        if (uploadActive) {
                            console.log("✅ 检测到上传活动");
                            return await confirmCurrentUploadIfNeeded(120000, true);
                        }
                        // 5. 检查页面文本内容中的上传状态
                        console.log("🔄 检查页面文本中的上传状态...");
                        const bodyText = document.body.textContent || "";
                        const uploadStatusIndicators = [
                            "上传中",
                            "已上传",
                            "上传速度",
                            "剩余时间",
                            "上传进度",
                            "上传失败",
                            "重新上传",
                        ];
                        let uploadDetected = false;
                        for (const indicator of uploadStatusIndicators) {
                            if (bodyText.includes(indicator)) {
                                console.log(`✅ 在页面文本中找到上传状态指示: "${indicator}"`);
                                uploadDetected = true;
                            }
                        }
                        if (uploadDetected) {
                            console.log("✅ 检测到页面显示上传状态，上传正在进行中");
                            // 进一步检查具体的上传状态
                            if (bodyText.includes("上传中")) {
                                console.log("📊 状态: 上传进行中");
                                return await confirmCurrentUploadIfNeeded(120000, true);
                            }
                            if (bodyText.includes("上传失败") || bodyText.includes("重新上传")) {
                                console.log("❌ 状态: 上传失败");
                                return false;
                            }
                            if (this.hasUploadSuccessText(bodyText)) {
                                console.log("🎉 状态: 上传完成，等待确认是否属于本次上传");
                                return await confirmCurrentUploadIfNeeded(120000, false);
                            }
                            return await confirmCurrentUploadIfNeeded(120000, true);
                        }
                        // 6. 最后检查：查找上传/发布按钮
                        console.log("🔄 检查上传/发布按钮...");
                        const uploadButtons = document.querySelectorAll('button, [class*="upload"], [class*="submit"], div, span');
                        for (const button of uploadButtons) {
                            const text = button.textContent?.trim() || "";
                            if (text.includes("上传") || text.includes("发布") || text.includes("提交")) {
                                console.log("✅ 找到上传/发布按钮:", text);
                                // 分析按钮文本判断状态
                                if (text.includes("上传失败") || text.includes("重新上传")) {
                                    console.log("❌ 检测到上传失败状态");
                                    return false;
                                }
                                if (text.includes("上传中") || text.includes("已上传")) {
                                    console.log("✅ 检测到上传进行中状态");
                                    return await confirmCurrentUploadIfNeeded(120000, true);
                                }
                                if (this.hasUploadSuccessText(text)) {
                                    console.log("🎉 检测到上传完成状态，等待确认是否属于本次上传");
                                    return await confirmCurrentUploadIfNeeded(120000, false);
                                }
                            }
                        }
                        console.log("❌ 无法检测到明确的上传活动");
                        console.log("🔧 建议: AHVP系统可能需要手动触发或页面刷新后重试");
                        return false;
                    }
                    console.log("✅ AHVP系统已加载");
                    // 验证AHVP功能
                    console.log("🔍 验证AHVP功能...");
                    console.log("  - AHVP.newUploaderManager:", typeof AHVP.newUploaderManager);
                    console.log("  - AHVP.UPLOADER_EVENT:", !!AHVP.UPLOADER_EVENT);
                    this.usedHardcodedUploadFallback = true;
                    console.warn("⚠️ 车家号视频上传进入硬编码 AHVP fallback 路径；本次流程将禁止自动发布，避免使用默认参数直接发布");
                    // 创建上传manager（按照成功的控制台代码模式）
                    console.log("🔧 创建上传manager...");
                    const manager = new AHVP.newUploaderManager(2);
                    window.muploader = manager;
                    console.log("✅ 创建manager成功");
                    // 使用成功的配置参数
                    const config = {
                        isvr: 0,
                        target: "browser_0",
                        dragtarget: "browser_0",
                        userid: "0A33363922E51BDE",
                        _timestamp: Math.floor(Date.now() / 1000),
                        _appid: "chejiahao_extension",
                        _sign: "extension_sign",
                        h5: true,
                        waitstart: 1,
                        param: "lt=30&gt=3",
                        iw: 0,
                        provider: "autohome",
                        callback: "http://creator-content-api.corpautohome.com/public/video/transcoding",
                        update: (callback, config) => {
                            // 更新认证参数
                            const newConfig = {
                                ...config,
                                _timestamp: Math.floor(Date.now() / 1000),
                                callback: "http://creator-content-api.corpautohome.com/public/video/transcoding",
                            };
                            callback(newConfig);
                        },
                    };
                    // 创建browser
                    console.log("🔧 创建browser...");
                    const browser = manager.createBrowser(config);
                    if (!browser) {
                        console.error("❌ 创建browser失败");
                        return false;
                    }
                    console.log("✅ 创建browser成功");
                    // 添加视频过滤器
                    browser.addFileFilter("video");
                    console.log("✅ 添加视频过滤器成功");
                    // 创建完整的文件项对象
                    const fileItem = this.createFileItem(file);
                    console.log("✅ 创建文件项对象:", fileItem);
                    // 设置事件监听
                    browser.on(AHVP.UPLOADER_EVENT.ITEMSELECTED, (item) => {
                        console.log("🎯 文件被选择:", item);
                    });
                    browser.on(AHVP.UPLOADER_EVENT.PROGRESS, (_item, progress) => {
                        console.log("📊 上传进度:", `${Math.round(progress * 100)}%`);
                    });
                    browser.on(AHVP.UPLOADER_EVENT.SUCCESS, (_item, response) => {
                        console.log("✅ 上传成功:", response);
                    });
                    browser.on(AHVP.UPLOADER_EVENT.ERROR, (_item, error) => {
                        console.error("❌ 上传失败:", error);
                    });
                    // 添加文件到manager
                    console.log("📁 添加文件到manager...");
                    manager.addItem(fileItem);
                    console.log("✅ 文件添加到manager");
                    // 开始上传
                    console.log("🚀 开始上传...");
                    manager.start();
                    markCurrentUploadTriggered();
                    if (!waitForCompletion) {
                        console.log("车家号手动发布流程：AHVP fallback 上传已启动，不等待上传完成");
                        return false;
                    }
                    // Wait for explicit AHVP completion only in auto-publish mode.
                    return new Promise((resolve) => {
                        let uploadCompleted = false;
                        const finish = (succeeded) => {
                            if (uploadCompleted)
                                return;
                            uploadCompleted = true;
                            resolve(succeeded);
                        };
                        // 监听上传完成事件
                        browser.on(AHVP.UPLOADER_EVENT.COMPLETED, (_item, response) => {
                            console.log("🎉 上传完成:", response);
                            finish(true);
                        });
                        browser.on(AHVP.UPLOADER_EVENT.ERROR, (_item, error) => {
                            console.error("❌ 上传失败:", error);
                            finish(false);
                        });
                        // 超时处理
                        setTimeout(() => {
                            if (!uploadCompleted) {
                                console.warn("⏰ 车家号视频上传超时，未视为成功，跳过自动发布");
                                finish(false);
                            }
                        }, 120000); // 2分钟超时
                    });
                }
                catch (error) {
                    console.error("❌ 视频上传失败:", error);
                    console.error("错误详情:", error.stack);
                    return false;
                }
            }
        };
        console.log("✅ 上传器类定义完成");
        const uploader = new ChejiahaoVideoUploaderInline();
        console.log("✅ 上传器实例创建完成");
        // 步骤1: 填写标题
        if (title) {
            console.log("📝 填写标题:", title);
            await uploader.fillTitle(title);
        }
        // 步骤2: 自动勾选原创和首发
        console.log("✅ 自动勾选原创和首发...");
        await uploader.checkOriginalAndFirst();
        // 步骤3: 填写描述
        if (content) {
            console.log("📝 填写描述:", `${content.substring(0, 100)}...`);
            await uploader.fillDescription(description ?? content);
        }
        let videoUploaded = false;
        // Step 4: upload the required video.
        if (video) {
            console.log("🎥 开始上传视频...");
            videoUploaded = await uploader.uploadVideo(video, data.isAutoPublish === true);
        }
        else {
            console.error("❌ 缺少视频文件");
            return;
        }
        // Step 5: upload cover best-effort. Cover failure must not block publish.
        if (cover) {
            await uploader.uploadCover(cover).catch((error) => {
                console.warn("车家号封面上传异常，继续发布流程:", error);
                return false;
            });
        }
        // Step 6: auto-publish only after the video upload is confirmed.
        await uploader.publishIfAutoEnabled(data.isAutoPublish, videoUploaded);
        console.log("🎉 车家号视频发布流程完成");
        return;
    }
    catch (error) {
        console.error("💥 车家号视频发布失败:", error);
        console.error("错误详情:", error.stack);
        return;
    }
}

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 大鱼号视频发布器
 */
export async function VideoDayu(data) {
    console.log("🚀 开始大鱼号视频发布流程...");
    console.log("🔍 当前页面:", window.location.href);
    try {
        // 检查是否在大鱼号页面
        if (!window.location.href.includes("mp.dayu.com")) {
            console.error("❌ 不在大鱼号页面，当前页面:", window.location.href);
            return;
        }
        // 解析视频数据
        if (!data || !data.data) {
            console.error("❌ 缺少视频数据");
            return;
        }
        const { content, video, title, tags, cover, verticalCover, description } = data.data;
        console.log("📝 视频数据:", {
            title: title?.substring(0, 50),
            contentLength: content?.length,
            hasVideo: !!video,
            hasTags: tags && tags.length > 0,
            hasCover: !!cover,
            hasVerticalCover: !!verticalCover,
        });
        // 内联定义大鱼号视频上传器类
        const DayuVideoUploader = class DayuVideoUploader {
            /**
             * 等待指定时间
             */
            sleep(ms) {
                return new Promise((resolve) => setTimeout(resolve, ms));
            }
            /**
             * 填写标题
             */
            async fillTitle(title) {
                try {
                    console.log("📝 填写标题:", title);
                    // 等待页面加载
                    await this.sleep(3000);
                    // 大鱼号标题输入框选择器
                    const titleSelectors = [
                        'input[placeholder*="标题"]',
                        'input[placeholder*="title"]',
                        'input[name*="title"]',
                        'input[class*="title"]',
                        'input[type="text"]',
                        '.ant-input[type="text"]',
                        ".ant-input",
                        "#title",
                        'textarea[placeholder*="标题"]',
                        '.form-input[type="text"]',
                        '.el-input__inner[type="text"]',
                        ".dayu-input",
                    ];
                    for (const selector of titleSelectors) {
                        const titleElement = document.querySelector(selector);
                        if (titleElement && titleElement.offsetParent !== null) {
                            console.log("✅ 找到标题输入框:", selector);
                            try {
                                // 清空原有内容
                                titleElement.focus();
                                titleElement.select();
                                // 逐字符输入模拟真实用户行为
                                for (let i = 0; i < title.length; i++) {
                                    const _char = title[i];
                                    titleElement.value = title.substring(0, i + 1);
                                    // 触发输入事件
                                    titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                    await this.sleep(50);
                                }
                                // 触发多种事件确保框架识别
                                titleElement.dispatchEvent(new Event("focus", { bubbles: true }));
                                titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                titleElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                titleElement.dispatchEvent(new Event("blur", { bubbles: true }));
                                // 验证设置是否成功
                                console.log(`✅ 标题设置后验证: value="${titleElement.value}"`);
                                if (titleElement.value === title) {
                                    console.log("✅ 标题填写成功");
                                    return;
                                }
                            }
                            catch (e) {
                                console.error("设置标题值时出错:", e);
                            }
                        }
                    }
                    console.log("❌ 未找到可用的标题输入框");
                    return;
                }
                catch (error) {
                    console.error("填写标题失败:", error);
                    return;
                }
            }
            /**
             * 填写描述
             */
            async fillDescription(description) {
                try {
                    console.log("📝 填写描述:", `${description.substring(0, 100)}...`);
                    // 大鱼号描述输入框选择器
                    const descSelectors = [
                        'textarea[placeholder*="描述"]',
                        'textarea[placeholder*="简介"]',
                        'textarea[placeholder*="内容"]',
                        'textarea[name*="content"]',
                        'textarea[name*="desc"]',
                        "textarea",
                        ".ant-input",
                        "#content",
                        "#description",
                        ".form-textarea",
                        ".el-textarea__inner",
                        ".dayu-textarea",
                    ];
                    for (const selector of descSelectors) {
                        const descElement = document.querySelector(selector);
                        if (descElement && descElement.offsetParent !== null) {
                            console.log("✅ 找到描述输入框:", selector);
                            try {
                                descElement.focus();
                                descElement.value = description;
                                // 触发多种事件
                                descElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                descElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                console.log("✅ 描述填写成功");
                                return;
                            }
                            catch (e) {
                                console.error("设置描述值时出错:", e);
                            }
                        }
                    }
                    console.log("❌ 未找到可用的描述输入框");
                    return;
                }
                catch (error) {
                    console.error("填写描述失败:", error);
                    return;
                }
            }
            /**
             * 上传视频文件
             */
            async uploadVideo(videoData) {
                try {
                    console.log("📹 开始上传视频...");
                    // 获取视频文件
                    let file;
                    if (videoData.videoFile) {
                        file = videoData.videoFile;
                    }
                    else if (videoData.url) {
                        const response = await fetch(videoData.url);
                        const arrayBuffer = await response.arrayBuffer();
                        const extension = videoData.name.split(".").pop() || "mp4";
                        const fileName = `${videoData.name.replace(/\.[^/.]+$/, "")}.${extension}`;
                        file = new File([arrayBuffer], fileName, { type: "video/mp4" });
                    }
                    else {
                        console.error("❌ 无效的视频数据");
                        return;
                    }
                    console.log("📁 视频文件:", file.name, file.size, file.type);
                    // 等待页面完全加载
                    console.log("⏳ 等待页面加载完成...");
                    await this.sleep(5000);
                    // 查找上传区域
                    console.log("🔍 查找大鱼号上传区域...");
                    const uploadSelectors = [
                        ".upload-area",
                        ".video-upload",
                        '[class*="upload"]',
                        '[class*="video"]',
                        ".ant-upload",
                        "#upload",
                        ".upload-btn",
                        'button[class*="upload"]',
                        ".upload-container",
                        ".el-upload",
                        ".el-upload-dragger",
                        ".dayu-upload",
                        ".upload-wrapper",
                    ];
                    let uploadArea = null;
                    for (const selector of uploadSelectors) {
                        const element = document.querySelector(selector);
                        if (element && element.offsetParent !== null) {
                            console.log(`✅ 找到上传区域: ${selector}`);
                            uploadArea = element;
                            break;
                        }
                    }
                    if (!uploadArea) {
                        console.log("❌ 未找到上传区域，尝试查找文件输入框...");
                        // 直接查找文件输入框
                        const fileInputs = document.querySelectorAll('input[type="file"]');
                        console.log(`🔍 找到 ${fileInputs.length} 个文件输入框`);
                        let targetInput = null;
                        fileInputs.forEach((input, index) => {
                            const accept = input.getAttribute("accept") || "";
                            console.log(`  输入框 ${index + 1}: accept="${accept}"`);
                            // 优先查找视频文件输入框
                            if (accept.includes("video") || accept.includes("*") || accept === "") {
                                targetInput = input;
                                console.log(`✅ 选择输入框 ${index + 1} 作为目标`);
                            }
                        });
                        if (targetInput) {
                            // 使用DataTransfer API设置文件
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            targetInput.files = dataTransfer.files;
                            // 触发change事件
                            targetInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 文件已设置到输入框");
                            return;
                        }
                        console.log("❌ 未找到合适的文件输入框");
                        return;
                    }
                    // 如果找到了上传区域，尝试点击或操作
                    console.log("🔄 尝试操作上传区域...");
                    // 查找上传区域内的文件输入框
                    const uploadInput = uploadArea.querySelector('input[type="file"]');
                    if (uploadInput) {
                        console.log("✅ 在上传区域内找到文件输入框");
                        // 创建透明的文件输入框覆盖上传区域
                        const overlayInput = document.createElement("input");
                        overlayInput.type = "file";
                        overlayInput.accept = "video/*,.mp4,.avi,.mov,.wmv";
                        overlayInput.style.position = "absolute";
                        overlayInput.style.opacity = "0";
                        overlayInput.style.width = "100%";
                        overlayInput.style.height = "100%";
                        overlayInput.style.top = "0";
                        overlayInput.style.left = "0";
                        overlayInput.style.zIndex = "9999";
                        overlayInput.id = `dayu_upload_${Date.now()}`;
                        // 设置上传区域样式以支持覆盖
                        const uploadElement = uploadArea;
                        uploadElement.style.position = "relative";
                        uploadElement.appendChild(overlayInput);
                        // 设置文件
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        overlayInput.files = dataTransfer.files;
                        // 触发文件选择事件
                        overlayInput.dispatchEvent(new Event("focus", { bubbles: true }));
                        overlayInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                        console.log("✅ 文件已设置到覆盖输入框");
                        // 尝试点击上传区域（如果需要）
                        if (uploadArea.tagName === "BUTTON" || uploadArea.closest("button")) {
                            console.log("🖱️ 点击上传按钮...");
                            const button = uploadArea.closest("button") || uploadArea;
                            button.click();
                            await this.sleep(1000);
                        }
                        // 等待上传开始
                        await this.waitForUploadStart();
                        return;
                    }
                    console.log("⚠️ 上传区域内未找到文件输入框，尝试点击上传区域...");
                    // 点击上传区域触发文件选择
                    const clickableElement = uploadArea.closest("button") || uploadArea.querySelector("button") || uploadArea;
                    if (clickableElement) {
                        console.log("🖱️ 点击可点击元素...");
                        clickableElement.click();
                        await this.sleep(2000);
                        // 再次查找文件输入框
                        const newFileInput = document.querySelector('input[type="file"]');
                        if (newFileInput) {
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            newFileInput.files = dataTransfer.files;
                            newFileInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 文件已设置到新找到的输入框");
                            return;
                        }
                    }
                    console.log("⚠️ 无法直接上传文件，但页面可能已经准备好了");
                    return;
                }
                catch (error) {
                    console.error("❌ 视频上传失败:", error);
                    return;
                }
            }
            /**
             * 处理横版封面 - 基于实际HTML结构实现
             */
            async uploadHorizontalCover(coverData) {
                console.log("📐 开始处理横版封面...", coverData);
                if (!coverData || !coverData.url) {
                    console.log("⚠️ 未提供横版封面图片");
                    return;
                }
                try {
                    // 获取图片文件
                    let file;
                    if (coverData.coverFile) {
                        file = coverData.coverFile;
                    }
                    else if (coverData.url) {
                        const response = await fetch(coverData.url);
                        const arrayBuffer = await response.arrayBuffer();
                        const extension = coverData.name?.split(".").pop() || "jpg";
                        const fileName = `${coverData.name?.replace(/\.[^/.]+$/, "") || "cover"}.${extension}`;
                        file = new File([arrayBuffer], fileName, { type: "image/jpeg" });
                    }
                    else {
                        console.error("❌ 无效的封面数据");
                        return;
                    }
                    console.log("📁 横版封面文件:", file.name, file.size, file.type);
                    // 等待页面加载完成
                    console.log("⏳ 等待页面加载完成...");
                    await this.sleep(3000);
                    // 基于实际HTML结构查找横版封面上传区域
                    console.log("🔍 查找横版封面上传区域...");
                    const coverSelectors = [
                        // 横版封面特定选择器（根据提供的HTML结构）
                        "#coverImg",
                        ".article-write_box-coverImg",
                        ".article-write_box-form-coverImg",
                        '.w-form-field:has(label:contains("视频封面"))',
                        ".w-form-field.article-write_box-cover",
                        // 通用选择器作为备选
                        ".upload-area",
                        ".cover-upload",
                        ".image-upload",
                        ".thumb-upload",
                        '[class*="upload"]',
                        '[class*="cover"]',
                    ];
                    let uploadArea = null;
                    // 遍历所有选择器查找上传区域
                    for (const selector of coverSelectors) {
                        // 处理 contains 选择器
                        if (selector.includes(":contains")) {
                            const baseSelector = selector.split(":")[0];
                            const elements = Array.from(document.querySelectorAll(baseSelector));
                            for (const elem of elements) {
                                const label = elem.querySelector("label");
                                if (label && (label.textContent?.includes("视频封面") || label.textContent?.includes("封面"))) {
                                    console.log(`✅ 通过标签文本找到横版封面上传区域: ${baseSelector}`);
                                    uploadArea = elem;
                                    break;
                                }
                            }
                        }
                        else {
                            const element = document.querySelector(selector);
                            if (element && element.offsetParent !== null) {
                                console.log(`✅ 找到横版封面上传区域: ${selector}`);
                                uploadArea = element;
                                break;
                            }
                        }
                        if (uploadArea)
                            break;
                    }
                    if (!uploadArea) {
                        // 尝试直接查找文件输入框
                        const fileInputs = document.querySelectorAll('input[type="file"]');
                        console.log(`🔍 找到 ${fileInputs.length} 个文件输入框`);
                        // 优先查找图片文件输入框
                        const fileInputArray = Array.from(fileInputs);
                        for (const input of fileInputArray) {
                            const accept = input.getAttribute("accept") || "";
                            if (accept.includes("image") || accept.includes("jpg") || accept.includes("png")) {
                                uploadArea = input;
                                console.log("✅ 找到图片文件输入框作为横版封面上传区域");
                                break;
                            }
                        }
                    }
                    if (!uploadArea) {
                        console.log("❌ 未找到横版封面上传区域");
                        return;
                    }
                    // 执行封面上传
                    console.log("🚀 开始执行横版封面上传...");
                    await this.performCoverUpload(uploadArea, file, "horizontal");
                    console.log("✅ 横版封面上传完成");
                    return;
                }
                catch (error) {
                    console.error("横版封面上传失败:", error);
                    return;
                }
            }
            /**
             * 处理竖版封面 - 基于实际HTML结构实现
             */
            async uploadVerticalCover(coverData) {
                console.log("📱 开始处理竖版封面...", coverData);
                if (!coverData || !coverData.url) {
                    console.log("⚠️ 未提供竖版封面图片");
                    return;
                }
                try {
                    // 获取图片文件
                    let file;
                    if (coverData.verticalCoverFile) {
                        file = coverData.verticalCoverFile;
                    }
                    else if (coverData.url) {
                        const response = await fetch(coverData.url);
                        const arrayBuffer = await response.arrayBuffer();
                        const extension = coverData.name?.split(".").pop() || "jpg";
                        const fileName = `${coverData.name?.replace(/\.[^/.]+$/, "") || "vertical_cover"}.${extension}`;
                        file = new File([arrayBuffer], fileName, { type: "image/jpeg" });
                    }
                    else {
                        console.error("❌ 无效的竖版封面数据");
                        return;
                    }
                    console.log("📁 竖版封面文件:", file.name, file.size, file.type);
                    // 等待页面加载完成
                    console.log("⏳ 等待页面加载完成...");
                    await this.sleep(3000);
                    // 基于实际HTML结构查找竖版封面上传区域
                    console.log("🔍 查找竖版封面上传区域...");
                    let uploadArea = null;
                    // 方法1: 通过精确的层级结构查找
                    console.log("🔍 方法1: 通过层级结构查找...");
                    const verticalFieldContainer = document.querySelector(".w-form-field.article-write_box-vertical-cover");
                    if (verticalFieldContainer) {
                        console.log("✅ 找到竖版封面字段容器");
                        const fileInput = verticalFieldContainer.querySelector('input[type="file"]');
                        if (fileInput) {
                            uploadArea = fileInput;
                            console.log("✅ 在容器内找到文件输入框");
                        }
                        else {
                            // 找到外层容器，由 performCoverUpload 内部查找
                            uploadArea = verticalFieldContainer.querySelector(".article-write_box-form-coverImg");
                            if (uploadArea) {
                                console.log("✅ 找到封面图片区域");
                            }
                        }
                    }
                    // 方法2: 通过标签文本查找
                    if (!uploadArea) {
                        console.log("🔍 方法2: 通过标签文本查找...");
                        const allFieldLabels = document.querySelectorAll(".w-form-field label");
                        for (const label of Array.from(allFieldLabels)) {
                            if (label.textContent?.includes("竖版封面")) {
                                console.log("✅ 通过标签文本找到竖版封面容器");
                                uploadArea = label.closest(".w-form-field");
                                break;
                            }
                        }
                    }
                    // 方法3: 通过竖版特定类名查找
                    if (!uploadArea) {
                        console.log("🔍 方法3: 通过类名查找...");
                        const candidates = document.querySelectorAll('[class*="vertical-cover"], [class*="form_vertical"]');
                        for (const elem of Array.from(candidates)) {
                            if (elem.offsetParent !== null) {
                                console.log("✅ 找到竖版封面候选元素:", {
                                    tagName: elem.tagName,
                                    className: elem.className,
                                });
                                uploadArea = elem;
                                break;
                            }
                        }
                    }
                    // 方法4: 通用文件输入框查找（最后备选）
                    if (!uploadArea) {
                        console.log("🔍 方法4: 查找所有文件输入框...");
                        const fileInputs = document.querySelectorAll('input[type="file"]');
                        console.log(`🔍 找到 ${fileInputs.length} 个文件输入框`);
                        const fileInputArray = Array.from(fileInputs);
                        for (const input of fileInputArray) {
                            const accept = input.getAttribute("accept") || "";
                            console.log(`  输入框: accept="${accept}"`);
                            if (accept.includes("image") || accept.includes("jpg") || accept.includes("png")) {
                                // 检查输入框是否在竖版封面容器内
                                const parent = input.closest(".article-write_box-vertical-cover, .article-write_box-form_vertical");
                                if (parent) {
                                    uploadArea = input;
                                    console.log("✅ 找到竖版封面图片文件输入框");
                                    break;
                                }
                            }
                        }
                    }
                    if (!uploadArea) {
                        console.log("❌ 未找到竖版封面上传区域");
                        return;
                    }
                    // 执行封面上传
                    console.log("🚀 开始执行竖版封面上传...");
                    await this.performCoverUpload(uploadArea, file, "vertical");
                    console.log("✅ 竖版封面上传完成");
                    return;
                }
                catch (error) {
                    console.error("竖版封面上传失败:", error);
                    return;
                }
            }
            /**
             * 处理视频标签 - 基于实际HTML结构实现
             */
            async uploadVideoTags(tags) {
                console.log("🏷️ 开始处理视频标签...", tags);
                if (!tags || tags.length === 0) {
                    console.log("⚠️ 未提供视频标签");
                    return;
                }
                try {
                    // 等待页面加载
                    console.log("⏳ 等待页面加载完成...");
                    await this.sleep(3000);
                    // 基于实际HTML结构查找标签输入框
                    console.log("🔍 查找视频标签输入框...");
                    let tagInput = null;
                    // 方法1: 使用Vue.js框架层面的方法
                    console.log("🔍 方法1: 使用Vue.js框架层面操作...");
                    const tagContainer = document.querySelector(".article-write_video-tags.form-control");
                    if (tagContainer) {
                        console.log("✅ 找到标签容器");
                        // 首先点击 wm-icon-question 图标来激活输入框（基于用户提供的widgets-tips组件）
                        console.log("🖱️ 点击 wm-icon-question 图标来激活输入框...");
                        const questionIcon = tagContainer.querySelector(".wm-icon-question");
                        if (questionIcon) {
                            console.log("✅ 找到 question 图标，点击激活输入框");
                            questionIcon.click();
                            await this.sleep(1000);
                            // 等待Vue.js响应并渲染输入框
                            console.log("⏳ 等待Vue.js组件响应...");
                            await this.sleep(2000);
                        }
                        else {
                            console.log("⚠️ 未找到 question 图标，可能需要其他方式激活");
                        }
                        // 查找所有输入框（基于用户提供的正确结构：div > input[type="text"]）
                        console.log("🔍 查找所有标签输入框...");
                        const allInputDivs = tagContainer.querySelectorAll('div > input[type="text"]');
                        console.log(`✅ 找到 ${allInputDivs.length} 个输入框`);
                        if (allInputDivs.length >= 1) {
                            tagInput = allInputDivs[0];
                            console.log("✅ 找到标签输入框，使用Vue.js标准方法", {
                                tagName: tagInput.tagName,
                                type: tagInput.type,
                                maxlength: tagInput.maxlength || "N/A",
                                placeholder: tagInput.placeholder || "N/A",
                            });
                            // 尝试直接通过Vue.js的change事件来设置值
                            try {
                                // 使用Vue.js的$nextTick或类似机制确保DOM更新
                                console.log("🔧 使用Vue.js标准方式设置值...");
                                for (const inputDiv of allInputDivs) {
                                    const input = inputDiv;
                                    console.log("🔍 输入框信息:", {
                                        maxlength: input.maxLength,
                                        value: input.value,
                                        placeholder: input.placeholder,
                                    });
                                }
                            }
                            catch (_e) {
                                console.log("⚠️ Vue.js标准方式设置失败，使用DOM操作");
                            }
                        }
                        else {
                            console.log("⚠️ 未找到输入框，等待更长时间或使用备选方案");
                            await this.sleep(3000);
                            // 重新尝试查找
                            const retryInputDivs = tagContainer.querySelectorAll('div > input[type="text"]');
                            if (retryInputDivs.length >= 1) {
                                tagInput = retryInputDivs[0];
                                console.log("✅ 延迟后找到输入框");
                            }
                            else {
                                console.log("❌ 延迟后仍未找到输入框");
                            }
                        }
                    }
                    // 方法2: 搜索所有可能的输入框
                    if (!tagInput) {
                        console.log("🔍 方法2: 搜索页面所有输入框...");
                        const allInputs = document.querySelectorAll('input[type="text"], textarea');
                        for (const input of Array.from(allInputs)) {
                            const elem = input;
                            if (elem.offsetParent === null)
                                continue;
                            const placeholder = elem.getAttribute("placeholder") || "";
                            const name = elem.getAttribute("name") || "";
                            const id = elem.getAttribute("id") || "";
                            const className = elem.className || "";
                            // 检查输入框是否在标签相关容器附近
                            const parent = elem.closest('.article-write_video-tags, [class*="tag"]');
                            if (parent) {
                                console.log("✅ 通过父容器找到标签输入框", {
                                    placeholder,
                                    name,
                                    className,
                                });
                                tagInput = elem;
                                break;
                            }
                            // 检查输入框属性是否包含标签关键词
                            const text = `${placeholder} ${name} ${id} ${className}`.toLowerCase();
                            if (text.includes("tag") || text.includes("标签")) {
                                console.log("✅ 通过属性关键词找到标签输入框", {
                                    placeholder,
                                    name,
                                    className,
                                });
                                tagInput = elem;
                                break;
                            }
                        }
                    }
                    // 方法3: 通过标签文本定位后的兄弟元素（仅当是INPUT/TEXTAREA时）
                    if (!tagInput) {
                        console.log("🔍 方法3: 通过标签文本定位...");
                        const tagLabels = document.querySelectorAll(".article-write_video-tags-label, .w-form-field-label");
                        for (const label of Array.from(tagLabels)) {
                            if (label.textContent?.includes("标签")) {
                                console.log("✅ 找到标签说明文本");
                                // 查找下一个兄弟元素或父容器的兄弟容器
                                const fieldContent = label.closest(".w-form-field-content") ||
                                    label.closest(".w-form-field")?.nextElementSibling;
                                if (fieldContent) {
                                    // 严格检查：只接受INPUT或TEXTAREA元素
                                    const input = fieldContent.querySelector("input, textarea");
                                    if (input &&
                                        input.offsetParent !== null &&
                                        (input.tagName === "INPUT" || input.tagName === "TEXTAREA")) {
                                        console.log("✅ 找到标签输入框（通过标签文本定位）", {
                                            tagName: input.tagName,
                                            type: input.type,
                                            className: input.className,
                                        });
                                        tagInput = input;
                                        break;
                                    }
                                    console.log("⚠️ 找到的元素不是INPUT或TEXTAREA，跳过");
                                }
                            }
                        }
                    }
                    // 方法4: 查找隐藏的输入框或Vue组件（仅INPUT）
                    if (!tagInput) {
                        console.log("🔍 方法4: 查找隐藏的标签输入框...");
                        // Vue.js 组件可能使用隐藏的 input
                        const hiddenInputs = document.querySelectorAll('input[type="hidden"]');
                        for (const input of Array.from(hiddenInputs)) {
                            const name = input.getAttribute("name") || "";
                            const className = input.className || "";
                            const text = `${name} ${className}`.toLowerCase();
                            if (text.includes("tag") || text.includes("标签")) {
                                console.log("✅ 找到隐藏的标签输入框");
                                tagInput = input;
                                break;
                            }
                        }
                    }
                    // 方法5: 查找所有可编辑元素（禁用 - 避免错误设置DIV）
                    if (!tagInput) {
                        console.log("🔍 方法5: 跳过可编辑元素查找（避免设置错误的DIV元素）");
                        console.log("⚠️ 为避免设置错误的contenteditable元素，跳过此方法");
                        // 注意: 用户明确指出contenteditable是错误的，所以跳过此方法
                    }
                    // 方法6: 查找Vue.js特有的元素（仅INPUT/TEXTAREA）
                    if (!tagInput) {
                        console.log("🔍 方法6: 查找Vue.js特有元素...");
                        // Vue.js 组件可能有 data-v-xxx 属性
                        const vueElements = document.querySelectorAll("[data-v-]");
                        for (const elem of Array.from(vueElements)) {
                            const parent = elem.closest('.article-write_video-tags, [class*="tag"]');
                            if (parent &&
                                elem.offsetParent !== null &&
                                (elem.tagName === "INPUT" || elem.tagName === "TEXTAREA")) {
                                console.log("✅ 找到Vue.js标签组件:", {
                                    tagName: elem.tagName,
                                    className: elem.className,
                                    "data-v-": elem.getAttribute("data-v-"),
                                });
                                tagInput = elem;
                                break;
                            }
                        }
                    }
                    // 方法7: 查找标签容器内的所有子元素（仅INPUT/TEXTAREA）
                    if (!tagInput && tagContainer) {
                        console.log("🔍 方法7: 深度搜索标签容器内所有元素...");
                        const allChildren = tagContainer.querySelectorAll("*");
                        for (const child of Array.from(allChildren)) {
                            if (child === tagContainer)
                                continue;
                            const elem = child;
                            if (elem.offsetParent === null)
                                continue;
                            const tagName = elem.tagName;
                            const className = elem.className || "";
                            const id = elem.id || "";
                            const role = elem.getAttribute("role") || "";
                            // 严格限制：只接受INPUT或TEXTAREA元素
                            if (tagName === "INPUT" || tagName === "TEXTAREA") {
                                console.log("🔍 检查子元素:", {
                                    tagName: tagName,
                                    className: className,
                                    id: id,
                                    role: role,
                                });
                                const text = `${className} ${id} ${role}`.toLowerCase();
                                if (text.includes("tag") ||
                                    text.includes("label") ||
                                    text.includes("input") ||
                                    tagName === "INPUT" ||
                                    tagName === "TEXTAREA") {
                                    console.log("✅ 在容器内找到INPUT/TEXTAREA元素");
                                    tagInput = elem;
                                    break;
                                }
                            }
                        }
                    }
                    // 如果没找到输入框，尝试等待和触发（仅INPUT/TEXTAREA）
                    if (!tagInput) {
                        console.log("⚠️ 未在预期位置找到标签输入框，尝试动态触发...");
                        // 尝试点击标签容器看是否能触发输入框出现
                        if (tagContainer) {
                            console.log("🖱️ 点击标签容器尝试触发输入框...");
                            tagContainer.click();
                            await this.sleep(2000);
                            // 再次查找输入框（仅INPUT/TEXTAREA）
                            const dynamicInput = tagContainer.querySelector("input, textarea");
                            if (dynamicInput &&
                                dynamicInput.offsetParent !== null &&
                                (dynamicInput.tagName === "INPUT" || dynamicInput.tagName === "TEXTAREA")) {
                                console.log("✅ 点击后找到标签输入框");
                                tagInput = dynamicInput;
                            }
                        }
                        // 尝试点击标签说明文本
                        if (!tagInput) {
                            const tagLabel = document.querySelector(".article-write_video-tags-label");
                            if (tagLabel) {
                                console.log("🖱️ 点击标签说明文本...");
                                tagLabel.click();
                                await this.sleep(2000);
                                const dynamicInput2 = document.querySelector(".article-write_video-tags input, .article-write_video-tags textarea");
                                if (dynamicInput2 &&
                                    dynamicInput2.offsetParent !== null &&
                                    (dynamicInput2.tagName === "INPUT" || dynamicInput2.tagName === "TEXTAREA")) {
                                    console.log("✅ 点击标签文本后找到输入框");
                                    tagInput = dynamicInput2;
                                }
                            }
                        }
                        // 尝试查找任何可能新出现的元素（仅INPUT/TEXTAREA）
                        if (!tagInput) {
                            console.log("🔍 搜索所有可能的新元素...");
                            const allElements = document.querySelectorAll("input, textarea");
                            for (const elem of Array.from(allElements)) {
                                const element = elem;
                                if (element.offsetParent === null)
                                    continue;
                                const placeholder = element.placeholder || "";
                                const className = element.className || "";
                                const id = element.id || "";
                                const text = `${placeholder} ${className} ${id}`.toLowerCase();
                                if (text.includes("tag") || text.includes("标签")) {
                                    console.log("✅ 搜索到标签相关元素:", {
                                        tagName: element.tagName,
                                        placeholder: placeholder,
                                        className: className,
                                        id: id,
                                    });
                                    // 严格检查：只接受INPUT或TEXTAREA
                                    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
                                        tagInput = element;
                                        break;
                                    }
                                    console.log("⚠️ 找到的元素不是INPUT或TEXTAREA，跳过");
                                }
                            }
                        }
                    }
                    // 格式化标签字符串
                    console.log("🏷️ 格式化标签字符串:", tags.join(", "));
                    const tagString = tags.join(", ");
                    // 填写标签
                    console.log("📝 填写标签:", tagString);
                    console.log("📝 标签数组:", tags);
                    // 检查是否有输入框可以填写
                    if (tagInput) {
                        console.log("✅ 找到标签输入框，开始填写...", {
                            tagName: tagInput.tagName,
                            className: tagInput.className,
                            id: tagInput.id,
                        });
                        // 清空原有内容
                        tagInput.focus();
                        await this.sleep(500);
                        // 根据输入框类型填写
                        if (tagInput.tagName === "INPUT" || tagInput.tagName === "TEXTAREA") {
                            console.log("✅ 使用INPUT/TEXTAREA方式填写标签");
                            // 重新查找所有标签输入框（确保获取最新的）
                            const tagContainer = document.querySelector(".article-write_video-tags.form-control");
                            const allInputDivs = tagContainer ? tagContainer.querySelectorAll('div > input[type="text"]') : [];
                            console.log(`✅ 找到 ${allInputDivs.length} 个标签输入框，将分配 ${tags.length} 个标签`);
                            if (allInputDivs.length === 0) {
                                console.log("❌ 未找到任何输入框，可能Vue.js组件未正确激活");
                                return;
                            }
                            // ✅ 正确的实现：逐个输入标签，每次按回车键触发下一个输入框
                            let filledCount = 0;
                            console.log(`📋 将处理 ${tags.length} 个标签（逐个输入，按回车键触发下一个）`);
                            // 逐个处理每个标签
                            for (let i = 0; i < tags.length; i++) {
                                const tag = tags[i];
                                console.log(`\n📝 === 处理第 ${i + 1} 个标签: "${tag}" ===`);
                                try {
                                    // 1. 查找当前可见的输入框
                                    const currentInputs = tagContainer.querySelectorAll('div > input[type="text"]');
                                    const currentInput = currentInputs[i]; // 第i个输入框
                                    if (!currentInput) {
                                        console.log(`❌ 未找到第 ${i + 1} 个输入框`);
                                        continue;
                                    }
                                    // 确保输入框可见
                                    if (currentInput.offsetParent === null) {
                                        console.log(`❌ 第 ${i + 1} 个输入框不可见`);
                                        continue;
                                    }
                                    console.log(`🎯 找到第 ${i + 1} 个输入框，开始输入`);
                                    // 2. 聚焦到输入框
                                    currentInput.focus();
                                    await this.sleep(300);
                                    // 3. 清空输入框
                                    currentInput.value = "";
                                    currentInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                    await this.sleep(200);
                                    // 4. 输入标签（逐字符）
                                    console.log(`⌨️ 开始输入 "${tag}"`);
                                    for (let j = 0; j < tag.length; j++) {
                                        const char = tag[j];
                                        currentInput.value += char;
                                        // 触发事件
                                        currentInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                        currentInput.dispatchEvent(new InputEvent("input", {
                                            inputType: "insertText",
                                            data: char,
                                            bubbles: true,
                                            composed: true,
                                        }));
                                        await this.sleep(80);
                                    }
                                    console.log(`📊 输入完成，当前值: "${currentInput.value}"`);
                                    // 5. 触发change事件
                                    currentInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                    await this.sleep(300);
                                    // 6. **关键步骤：按回车键触发下一个输入框**
                                    if (i < tags.length - 1) {
                                        // 不是最后一个标签
                                        console.log(`⏎ 按回车键触发第 ${i + 2} 个输入框...`);
                                        currentInput.dispatchEvent(new KeyboardEvent("keydown", {
                                            key: "Enter",
                                            code: "Enter",
                                            keyCode: 13,
                                            which: 13,
                                            bubbles: true,
                                            composed: true,
                                        }));
                                        currentInput.dispatchEvent(new KeyboardEvent("keyup", {
                                            key: "Enter",
                                            code: "Enter",
                                            keyCode: 13,
                                            which: 13,
                                            bubbles: true,
                                            composed: true,
                                        }));
                                        currentInput.dispatchEvent(new KeyboardEvent("keypress", {
                                            key: "Enter",
                                            code: "Enter",
                                            keyCode: 13,
                                            which: 13,
                                            bubbles: true,
                                            composed: true,
                                        }));
                                        // 等待下一个输入框出现
                                        console.log("⏳ 等待下一个输入框出现...");
                                        await this.sleep(1500);
                                        // 验证下一个输入框是否出现
                                        const nextInputs = tagContainer.querySelectorAll('div > input[type="text"]');
                                        console.log(`📊 按回车后输入框数量: ${nextInputs.length}`);
                                        if (nextInputs.length > currentInputs.length) {
                                            console.log(`✅ 成功触发第 ${i + 2} 个输入框`);
                                        }
                                        else {
                                            console.log("⚠️ 可能未成功触发下一个输入框，但继续处理");
                                        }
                                    }
                                    else {
                                        console.log("✅ 最后一个标签，处理完成");
                                    }
                                    // 7. 验证当前标签是否成功
                                    if (currentInput.value === tag) {
                                        filledCount++;
                                        console.log(`✅ 第 ${i + 1} 个标签输入成功 ✅`);
                                    }
                                    else {
                                        console.log(`⚠️ 第 ${i + 1} 个标签值不匹配，尝试强制设置`);
                                        // 强制设置
                                        currentInput.focus();
                                        await this.sleep(200);
                                        currentInput.value = tag;
                                        currentInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                        currentInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                        await this.sleep(200);
                                        if (currentInput.value === tag) {
                                            filledCount++;
                                            console.log(`✅ 第 ${i + 1} 个标签强制设置成功 ✅`);
                                        }
                                    }
                                }
                                catch (e) {
                                    console.error(`❌ 第 ${i + 1} 个标签处理出错:`, e);
                                }
                                // 在处理下一个标签前等待
                                if (i < tags.length - 1) {
                                    console.log("⏳ 等待500ms后处理下一个标签...");
                                    await this.sleep(500);
                                }
                            }
                            console.log(`\n📊 标签填写完成统计: ${filledCount}/${tags.length} 个成功`);
                            // 如果有剩余输入框，清空它们
                            for (let i = tags.length; i < (tagContainer ? tagContainer.querySelectorAll('div > input[type="text"]').length : 0); i++) {
                                const remainingInput = tagContainer.querySelectorAll('div > input[type="text"]')[i];
                                if (remainingInput) {
                                    remainingInput.value = "";
                                    remainingInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                    console.log(`🧹 清空第 ${i + 1} 个剩余输入框`);
                                }
                            }
                            console.log(`✅ 标签填写完成，成功填写 ${filledCount}/${tags.length} 个标签`);
                            if (filledCount === 0) {
                                console.log("❌ 所有标签输入都失败");
                                return;
                            }
                            return;
                        }
                        // 错误的方法 - 用户明确指出这是错误的
                        console.log("❌ 发现错误的contentEditable方法，这会导致错误的HTML结构");
                        console.log("💡 应该使用Vue.js框架提供的多个INPUT输入框，而不是contenteditable div");
                        console.log("⚠️ 跳过错误的contentEditable处理，使用备选方案");
                        // 标记为需要手动处理
                        console.log("ℹ️ 标签处理需要手动完成（使用框架方法）");
                        return;
                    }
                    // 如果仍然没有找到输入框，尝试使用其他方法
                    console.log("⚠️ 仍未找到可编辑的标签输入框");
                    console.log("💡 尝试将标签写入剪贴板，方便手动粘贴...");
                    // 尝试复制到剪贴板
                    try {
                        await navigator.clipboard.writeText(tagString);
                        console.log("✅ 标签已复制到剪贴板: ", tagString);
                        console.log("💡 提示: 请手动粘贴到标签输入框中");
                    }
                    catch (_err) {
                        console.log("⚠️ 剪贴板复制失败，请手动输入标签");
                    }
                    // 标记为成功（因为可能是需要手动输入的区域）
                    console.log("ℹ️ 标签处理标记为完成（可能需要手动输入）");
                }
                catch (error) {
                    console.error("视频标签处理失败:", error);
                    return;
                }
            }
            /**
             * 执行封面上传操作 - 通用方法
             */
            async performCoverUpload(uploadArea, file, coverType) {
                try {
                    console.log(`🚀 执行${coverType}封面上传...`);
                    console.log("📍 上传区域信息:", {
                        tagName: uploadArea.tagName,
                        className: uploadArea.className,
                        id: uploadArea.id,
                    });
                    // 如果是文件输入框，直接设置文件
                    if (uploadArea.tagName === "INPUT" && uploadArea.type === "file") {
                        console.log(`✅ 找到${coverType}封面文件输入框`);
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        uploadArea.files = dataTransfer.files;
                        // 触发完整的文件选择事件序列
                        console.log("🔧 触发文件选择事件序列...");
                        uploadArea.dispatchEvent(new Event("focus", { bubbles: true }));
                        uploadArea.dispatchEvent(new Event("click", { bubbles: true }));
                        uploadArea.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                        uploadArea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                        console.log(`✅ ${coverType}封面文件已设置到输入框`);
                        // 等待文件处理和弹框出现
                        console.log("⏳ 等待文件处理和弹框出现...");
                        await this.sleep(3000);
                        // 处理裁剪弹窗
                        await this.handleImageCropDialog();
                        return;
                    }
                    // 如果是容器元素，查找内部的文件输入框
                    const fileInput = uploadArea.querySelector('input[type="file"]');
                    if (fileInput) {
                        console.log(`✅ 在${coverType}封面上传区域内找到文件输入框`);
                        console.log("📍 文件输入框信息:", {
                            accept: fileInput.accept,
                            multiple: fileInput.multiple,
                            className: fileInput.className,
                        });
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        fileInput.files = dataTransfer.files;
                        // 触发完整的文件选择事件序列
                        console.log("🔧 触发文件选择事件序列...");
                        fileInput.dispatchEvent(new Event("focus", { bubbles: true }));
                        fileInput.dispatchEvent(new Event("click", { bubbles: true }));
                        fileInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                        fileInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                        console.log(`✅ ${coverType}封面文件已设置到输入框`);
                        // 等待文件处理和弹框出现
                        console.log("⏳ 等待文件处理和弹框出现...");
                        await this.sleep(3000);
                        // 处理裁剪弹窗
                        await this.handleImageCropDialog();
                        return;
                    }
                    console.log(`❌ 无法处理${coverType}封面上传`);
                    return;
                }
                catch (error) {
                    console.error(`${coverType}封面上传失败:`, error);
                    return;
                }
            }
            /**
             * 处理图片裁剪弹窗
             */
            async handleImageCropDialog() {
                try {
                    console.log("🖼️ 开始处理图片裁剪弹窗...");
                    console.log("⏳ 等待5秒确保文件处理完成...");
                    await new Promise((resolve) => setTimeout(resolve, 5000));
                    console.log("🔍 开始扫描页面弹框...");
                    // 检查各种可能的弹框
                    const dialogSelectors = [
                        ".article-material-image-dialog",
                        ".image-dialog",
                        ".material-image-dialog",
                        ".crop-dialog",
                        ".w-dialog",
                        ".w-modal",
                        '[role="dialog"]',
                        '[class*="dialog"]',
                        '[class*="modal"]',
                        '[class*="crop"]',
                    ];
                    let foundDialog = false;
                    for (const selector of dialogSelectors) {
                        const dialog = document.querySelector(selector);
                        if (dialog && dialog.offsetParent !== null) {
                            console.log(`✅ 发现弹框: ${selector}`);
                            foundDialog = true;
                            break;
                        }
                    }
                    if (foundDialog) {
                        console.log("✅ 发现弹框，开始处理保存操作");
                        await this.executeConfirmStrategy();
                        console.log("✅ 图片裁剪弹窗保存完成");
                    }
                    else {
                        console.log("⚠️ 未发现裁剪弹窗，可能不需要裁剪或已直接应用");
                    }
                    console.log("⚠️ 图片裁剪弹窗保存未完成，但继续后续流程");
                }
                catch (error) {
                    console.error("💥 视频封面保存过程出错:", error);
                }
            }
            /**
             * 执行确认保存策略
             */
            async executeConfirmStrategy() {
                console.log("🎯 执行确认保存策略...");
                try {
                    // 策略1: 查找主要保存按钮
                    const primarySelectors = [
                        ".article-material-image-dialog .w-btn.w-btn_primary",
                        ".w-btn.w-btn_primary",
                        "button.w-btn_primary",
                        ".w-btn_primary",
                    ];
                    for (const selector of primarySelectors) {
                        const buttons = Array.from(document.querySelectorAll(selector));
                        for (const button of buttons) {
                            const btn = button;
                            if (btn.offsetParent !== null) {
                                const text = btn.textContent?.trim() || "";
                                if (text.includes("保存") || text.includes("确定") || text.includes("完成") || text.includes("确认")) {
                                    console.log(`✅ 找到保存按钮: "${text}" | ${selector}`);
                                    btn.click();
                                    await this.sleep(1000);
                                    return;
                                }
                            }
                        }
                    }
                    // 策略2: 按文本查找所有按钮
                    const allButtons = Array.from(document.querySelectorAll('button, .w-btn, [role="button"]'));
                    for (const button of allButtons) {
                        const btn = button;
                        if (btn.offsetParent !== null) {
                            const text = btn.textContent?.trim() || "";
                            if (text.includes("保存") || text.includes("确定") || text.includes("完成") || text.includes("确认")) {
                                console.log(`✅ 通过文本找到保存按钮: "${text}"`);
                                btn.click();
                                await this.sleep(1000);
                                return;
                            }
                        }
                    }
                    console.log("❌ 未找到保存按钮");
                    return;
                }
                catch (error) {
                    console.error("保存策略执行失败:", error);
                    return;
                }
            }
            /**
             * 等待上传开始
             */
            async waitForUploadStart() {
                console.log("⏳ 等待上传开始...");
                for (let i = 0; i < 30; i++) {
                    await this.sleep(1000);
                    // 检查上传进度指示器
                    const progressSelectors = [
                        '[class*="progress"]',
                        '[class*="uploading"]',
                        '[class*="upload-progress"]',
                        ".ant-progress",
                        ".progress-bar",
                        ".uploading",
                        ".el-progress",
                        ".dayu-progress",
                    ];
                    for (const selector of progressSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log("✅ 检测到上传进度指示器");
                            return;
                        }
                    }
                    // 检查是否有上传成功标志
                    const successSelectors = ['[class*="success"]', '[class*="complete"]', '[class*="done"]', ".upload-success"];
                    for (const selector of successSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log("✅ 检测到上传成功标志");
                            return;
                        }
                    }
                }
                console.log("⚠️ 未检测到明确的上传状态，但可能已开始");
            }
            /**
             * 选择信息来源（默认：无需标注）
             */
            async selectVideoSource() {
                try {
                    console.log("📋 开始选择信息来源...");
                    // 等待页面加载完成
                    await this.sleep(2000);
                    // 查找信息来源选项
                    const sourceSelectors = [
                        'input[value="无需标注"]',
                        '.source-remark-detail input[value="无需标注"]',
                        '.ant-radio-group input[value="无需标注"]',
                        '.article-write_box-form-filed-required + .ant-radio-group input[value="无需标注"]',
                    ];
                    let sourceInput = null;
                    for (const selector of sourceSelectors) {
                        const input = document.querySelector(selector);
                        if (input && input.offsetParent !== null) {
                            console.log("✅ 找到信息来源选项:", selector);
                            sourceInput = input;
                            break;
                        }
                    }
                    if (!sourceInput) {
                        console.log("⚠️ 未找到信息来源选项，可能页面结构变化");
                        return;
                    }
                    // 检查是否已经选中
                    if (sourceInput.checked) {
                        console.log('✅ 信息来源已经选择为"无需标注"');
                        return;
                    }
                    // 点击选择
                    console.log('🖱️ 点击选择"无需标注"...');
                    sourceInput.click();
                    await this.sleep(500);
                    // 触发change事件
                    sourceInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                    await this.sleep(500);
                    // 验证选择是否成功
                    if (sourceInput.checked) {
                        console.log('✅ 信息来源选择成功: "无需标注"');
                        return;
                    }
                    console.log("⚠️ 信息来源选择可能失败，但继续...");
                    return; // 标记为成功以继续后续流程
                }
                catch (error) {
                    console.error("❌ 信息来源选择失败:", error);
                    return;
                }
            }
        };
        console.log("✅ 大鱼号上传器类定义完成");
        const uploader = new DayuVideoUploader();
        console.log("✅ 大鱼号上传器实例创建完成");
        // 步骤1: 填写标题
        if (title) {
            console.log("📝 填写标题:", title);
            await uploader.fillTitle(title);
        }
        // 步骤2: 填写描述
        if (content) {
            console.log("📝 填写描述:", `${content.substring(0, 100)}...`);
            await uploader.fillDescription(description ?? content);
        }
        // 步骤3: 上传视频
        if (video) {
            console.log("🎥 开始上传视频...");
            await uploader.uploadVideo(video);
        }
        else {
            console.error("❌ 缺少视频文件");
            return;
        }
        // 步骤4: 上传横版封面
        if (cover) {
            console.log("🖼️ 开始上传横版封面...");
            await uploader.uploadHorizontalCover(cover);
        }
        else {
            console.log("⚠️ 未提供横版封面图片，跳过横版封面上传");
        }
        // 步骤5: 上传竖版封面
        // 如果没有提供竖版封面，使用横版封面（同一张图片）
        const verticalCoverData = verticalCover || (cover ? { ...cover, name: `vertical_${cover.name || "cover.jpg"}` } : null);
        if (verticalCoverData) {
            console.log("📱 开始上传竖版封面...");
            await uploader.uploadVerticalCover(verticalCoverData);
        }
        else {
            console.log("⚠️ 未提供竖版封面图片，跳过竖版封面上传");
        }
        // 步骤6: 处理视频标签
        if (tags && tags.length > 0) {
            console.log("🏷️ 开始处理视频标签...");
            await uploader.uploadVideoTags(tags);
        }
        else {
            console.log("⚠️ 未提供视频标签，跳过标签处理");
        }
        // 步骤7: 选择信息来源（默认：无需标注）
        console.log("📋 开始设置信息来源...");
        await uploader.selectVideoSource();
        console.log("🎉 大鱼号视频发布流程完成");
        return;
    }
    catch (error) {
        console.error("💥 大鱼号视频发布失败:", error);
        console.error("错误详情:", error.stack);
        return;
    }
}

export async function VideoDewu(data) {
    // 简化说明：此版本专注于拖动策略，其他复杂策略已注释或移除以减少干扰
    console.log("🎬 VideoDewu函数被调用");
    console.log("📥 接收到的data参数:", data);
    // 防止重复执行
    if (window.__dewuRunning) {
        console.log("⚠️ Dewu脚本已在运行中，跳过重复执行");
        return;
    }
    window.__dewuRunning = true;
    console.log("🚀 开始执行Dewu视频发布脚本");
    /**
     * 创建一个在指定毫秒数后解析的 Promise
     * @param {number} ms - 等待的毫秒数
     * @returns {Promise<void>} 在指定时间后解析的 Promise
     */
    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    async function getVideoMetadata() {
        // 基于用户反馈，直接使用 1280x720 作为默认尺寸
        return {
            duration: 0,
            width: 1280,
            height: 720,
        };
    }
    async function uploadVideo(file) {
        console.log("🎬 开始视频上传流程");
        await sleep(3000);
        // 确保在"发布视频"标签页
        const videoTab = document.querySelector("#rc-tabs-0-tab-1");
        if (videoTab && !videoTab.classList.contains("pd-tabs-tab-active")) {
            console.log("🖱️ 点击发布视频标签页");
            videoTab.click();
            await sleep(2000);
        }
        const fileInputs = document.querySelectorAll('input[type="file"]');
        console.log(`🔍 找到 ${fileInputs.length} 个文件输入框`);
        if (fileInputs.length === 0) {
            throw new Error("页面上没有找到任何文件输入框");
        }
        const videoInput = fileInputs[0];
        console.log("✅ 使用第一个文件输入框");
        console.log("📁 准备上传视频文件:", file.name, file.type, file.size);
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        videoInput.files = dataTransfer.files;
        const changeEvent = new Event("change", { bubbles: true });
        videoInput.dispatchEvent(changeEvent);
        console.log("✅ 视频文件设置完成，开始上传...");
        // 立即返回，不等待上传完成
        return;
    }
    async function waitForUploadCompletion(timeout = 30000) {
        console.log("⏳ 等待视频上传完成...");
        await sleep(timeout);
        console.log("✅ 视频上传等待完成，继续执行");
    }
    async function fillTitle(title) {
        console.log("🔍 开始填写标题:", title);
        // 等待页面完全加载
        await sleep(3000);
        // 直接使用 id="title" 填充
        const titleInput = document.getElementById("title");
        if (titleInput) {
            titleInput.value = title;
            titleInput.dispatchEvent(new Event("input", { bubbles: true }));
            titleInput.dispatchEvent(new Event("change", { bubbles: true }));
            console.log("✅ 标题已填写:", title);
            return;
        }
        console.log("⚠️ 未找到标题输入框");
    }
    async function fillDescription(content) {
        console.log("🔍 开始填写描述:", content);
        // 等待页面完全加载
        await sleep(5000);
        // 创建临时元素来处理HTML标签
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = content;
        const plainText = tempDiv.textContent || tempDiv.innerText || "";
        console.log("🔍 查找描述输入框，目标内容:", plainText);
        // 使用简单的选择器找到描述输入框
        const descriptionSelectors = [
            'div[contenteditable="true"][data-placeholder="填写完整的描述信息"]',
            'div[contenteditable="true"]',
            '[data-placeholder*="描述"]',
            '[data-placeholder*="内容"]',
            '[data-placeholder*="动态"]',
            "textarea",
        ];
        for (const selector of descriptionSelectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                const el = element;
                if (el.offsetParent !== null) {
                    console.log(`✅ 找到描述输入框: ${selector}`);
                    // 根据元素类型选择填写方式
                    if (el.contentEditable === "true") {
                        // contenteditable div
                        el.innerText = plainText;
                    }
                    else if (el.tagName === "TEXTAREA") {
                        // textarea
                        el.value = plainText;
                    }
                    else {
                        // 其他输入框
                        el.value = plainText;
                    }
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                    el.dispatchEvent(new Event("change", { bubbles: true }));
                    el.dispatchEvent(new Event("blur", { bubbles: true }));
                    console.log("✅ 描述已填写:", `${plainText.substring(0, 100)}...`);
                    return;
                }
            }
        }
        console.log("⚠️ 未找到描述输入框");
    }
    async function uploadCover(cover, videoAspectRatio) {
        console.log("🖼️ 开始上传封面:", cover);
        try {
            // 步骤1: 点击"编辑封面"按钮
            console.log("🔍 查找编辑封面按钮...");
            // 通过文本内容查找按钮，避免使用动态CSS类
            const buttons = document.querySelectorAll("button");
            let editCoverButton = null;
            for (const button of buttons) {
                const text = button.textContent?.trim();
                if (text?.includes("编辑封面")) {
                    editCoverButton = button;
                    console.log("✅ 通过文本找到编辑封面按钮");
                    break;
                }
            }
            if (!editCoverButton) {
                console.log('❌ 未找到编辑封面按钮，尝试查找包含"封面"的按钮...');
                for (const button of buttons) {
                    const text = button.textContent?.trim();
                    if (text?.includes("封面")) {
                        editCoverButton = button;
                        console.log("✅ 通过部分文本找到编辑封面按钮");
                        break;
                    }
                }
            }
            if (!editCoverButton) {
                console.log("❌ 未找到编辑封面按钮");
                return;
            }
            console.log("✅ 点击编辑封面按钮");
            editCoverButton.click();
            await sleep(3000);
            // 步骤2: 点击"上传封面"标签页
            console.log("🔍 查找上传封面标签页...");
            const uploadCoverTabSelectors = [
                "#rc-tabs-1-tab-2", // 具体的ID
                'div[role="tab"]:contains("上传封面")', // 通过文本查找
                '.pd-tabs-tab:contains("上传封面")', // 通过类和文本查找
            ];
            let uploadCoverTab = null;
            for (const selector of uploadCoverTabSelectors) {
                if (selector.includes(":contains")) {
                    const tabs = document.querySelectorAll('[role="tab"]');
                    for (const tab of tabs) {
                        if (tab.textContent?.includes("上传封面")) {
                            uploadCoverTab = tab;
                            console.log("✅ 通过文本找到上传封面标签页");
                            break;
                        }
                    }
                }
                else {
                    uploadCoverTab = document.querySelector(selector);
                }
                if (uploadCoverTab) {
                    console.log(`✅ 找到上传封面标签页: ${selector}`);
                    break;
                }
            }
            if (uploadCoverTab) {
                console.log("✅ 点击上传封面标签页");
                uploadCoverTab.click();
                await sleep(2000);
            }
            // 步骤3: 查找上传区域并触发文件上传
            console.log("🔍 查找上传区域...");
            // 查找包含上传文本的元素
            const uploadTextElements = Array.from(document.querySelectorAll("*")).filter((el) => {
                const text = el.textContent?.trim();
                return text?.includes("将文件拖拽到这里") && text.includes("支持jpg");
            });
            let uploadArea = null;
            if (uploadTextElements.length > 0) {
                // 找到包含上传文本的元素，然后向上查找其父级容器
                uploadArea = uploadTextElements[0].closest("div");
                console.log("✅ 通过文本找到上传区域");
            }
            else {
                // 备用方案：查找包含上传图标的区域
                const uploadImages = Array.from(document.querySelectorAll("img")).filter((img) => {
                    const src = img.src.toLowerCase();
                    return src.includes("upload") || src.includes("add") || src.includes("plus");
                });
                if (uploadImages.length > 0) {
                    uploadArea = uploadImages[0].closest("div");
                    console.log("✅ 通过图标找到上传区域");
                }
            }
            if (!uploadArea) {
                console.log("❌ 未找到上传区域，尝试所有可能的div容器...");
                // 最后的备用方案：查找模态框内的大div
                const modalDivs = Array.from(document.querySelectorAll('.modal *, .dialog *, [role="dialog"] *'));
                for (const div of modalDivs) {
                    if (div.tagName === "DIV" && div.children.length > 0) {
                        uploadArea = div;
                        console.log("✅ 使用模态框内的div作为上传区域");
                        break;
                    }
                }
            }
            if (!uploadArea) {
                console.log("❌ 未找到上传区域");
                return;
            }
            // 步骤4: 准备封面文件
            console.log("📁 准备封面文件...");
            const response = await fetch(cover.url);
            const arrayBuffer = await response.arrayBuffer();
            const coverFile = new File([arrayBuffer], cover.name, {
                type: cover.type || "image/jpeg",
            });
            console.log("📁 封面文件信息:", coverFile.name, coverFile.size, coverFile.type);
            // 方法1: 查找现有的文件输入框
            console.log("🔍 查找现有的文件输入框...");
            const fileInputs = uploadArea.querySelectorAll('input[type="file"]');
            let targetFileInput = null;
            if (fileInputs.length > 0) {
                targetFileInput = fileInputs[0];
                console.log("✅ 找到现有文件输入框");
            }
            else {
                // 方法2: 创建文件输入框
                console.log("📝 创建新的文件输入框...");
                targetFileInput = document.createElement("input");
                targetFileInput.type = "file";
                targetFileInput.accept = "image/*,.jpg,.jpeg,.png,.webp";
                targetFileInput.style.display = "none";
                targetFileInput.id = `dewu_cover_upload_${Date.now()}`;
                document.body.appendChild(targetFileInput);
            }
            // 设置文件
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(coverFile);
            targetFileInput.files = dataTransfer.files;
            // 触发文件选择事件
            console.log("📤 触发文件选择事件...");
            targetFileInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
            await sleep(1000);
            // 方法3: 直接点击上传区域触发文件选择
            console.log("🖱️ 尝试直接点击上传区域...");
            uploadArea.click();
            await sleep(1000);
            // 清理临时创建的文件输入框
            if (targetFileInput.id.startsWith("dewu_cover_upload_")) {
                targetFileInput.remove();
            }
            console.log("✅ 封面文件设置完成");
            // 步骤5: 等待上传完成并选择封面比例
            console.log("⏳ 等待封面上传完成...");
            await sleep(5000);
            // 根据视频比例选择合适的封面裁剪比例
            console.log("🎯 根据视频比例选择封面裁剪比例:", videoAspectRatio.toFixed(2));
            await selectCoverAspectRatio(videoAspectRatio);
        }
        catch (error) {
            console.error("❌ 封面上传失败:", error);
        }
    }
    // 关闭封面上传模态框的独立函数
    async function closeCoverModal() {
        console.log("🔍 查找模态框确定按钮...");
        const confirmButtonSelectors = [
            'button:contains("确定")', // 通过文本查找
            ".pd-modal-footer .pd-btn-primary", // 模态框 footer 中的主要按钮
            ".ant-modal-footer .ant-btn-primary", // Ant Design 模态框
            '[class*="modal"] [class*="confirm"]', // 包含确认类名的按钮
            '.pd-btn-primary:contains("确定")', // 主要按钮且包含确定文本
        ];
        let confirmButton = null;
        for (const selector of confirmButtonSelectors) {
            if (selector.includes(":contains")) {
                const buttons = document.querySelectorAll("button");
                for (const button of buttons) {
                    if (button.textContent?.includes("确定") && button.textContent?.length <= 10) {
                        // 确保按钮文本相对简短，避免匹配到其他包含"确定"的长文本
                        confirmButton = button;
                        console.log("✅ 通过文本找到确定按钮");
                        break;
                    }
                }
            }
            else {
                confirmButton = document.querySelector(selector);
            }
            if (confirmButton && confirmButton.offsetParent !== null) {
                console.log(`✅ 找到确定按钮: ${selector}`);
                break;
            }
        }
        if (confirmButton) {
            console.log("✅ 点击确定按钮完成封面上传");
            confirmButton.click();
            await sleep(3000);
            console.log("🎉 封面上传完成");
        }
        else {
            console.log("⚠️ 未找到确定按钮，可能需要手动确认");
        }
    }
    async function selectCoverAspectRatio(videoAspectRatio) {
        console.log("🎯 开始选择封面裁剪比例，视频比例:", videoAspectRatio.toFixed(2));
        try {
            // 根据视频比例确定推荐的封面裁剪比例
            let recommendedRatio = "";
            if (videoAspectRatio >= 1.5) {
                // 横版视频 (3:2 或更宽)
                recommendedRatio = "4:3"; // 横版视频优先选择 4:3
            }
            else if (videoAspectRatio >= 0.8) {
                // 接近正方形的视频
                recommendedRatio = "1:1";
            }
            else {
                // 竖版视频
                recommendedRatio = "3:4"; // 竖版视频选择 3:4
            }
            console.log("📏 推荐封面裁剪比例:", recommendedRatio);
            // 查找并选择推荐的比例
            const allElements = document.querySelectorAll("*");
            let selectedOption = null;
            // 优先选择推荐比例
            for (const element of allElements) {
                const text = element.textContent?.trim();
                if (text === recommendedRatio) {
                    selectedOption = element;
                    console.log(`✅ 找到推荐比例: ${recommendedRatio}`);
                    break;
                }
            }
            // 如果没找到推荐比例，选择4:3（对于横版视频）
            if (!selectedOption && recommendedRatio === "4:3") {
                for (const element of allElements) {
                    const text = element.textContent?.trim();
                    if (text === "4:3") {
                        selectedOption = element;
                        console.log("✅ 找到4:3比例");
                        break;
                    }
                }
            }
            // 点击选择的选项
            if (selectedOption) {
                console.log("✅ 点击封面裁剪比例选项");
                selectedOption.click();
                await sleep(3000); // 增加等待时间，确保裁剪界面完全加载
                console.log("✅ 封面裁剪比例选择完成");
                // 执行智能撑满和居中策略，确保cropper完全初始化
                console.log("🎯 开始执行智能裁剪框调整...");
                await smartExpandAndCenterCropBox();
                console.log("✅ 智能裁剪框调整完成");
                // 在智能裁剪完成后再关闭模态框
                await closeCoverModal();
            }
            else {
                console.log("⚠️ 未找到封面裁剪比例选择选项，跳过此步骤");
                // 即使没有选择比例，也要尝试关闭模态框
                await closeCoverModal();
            }
        }
        catch (error) {
            console.error("❌ 封面裁剪比例选择失败:", error);
        }
    }
    // 智能撑满和居中策略 - 纯Cropper API
    async function smartExpandAndCenterCropBox() {
        console.log("🎯 开始使用Cropper API撑满和居中裁剪框...");
        // 等待cropper完全初始化，并尝试多次查找实例
        let cropperInstance = null;
        let attempts = 0;
        const maxAttempts = 10;
        while (!cropperInstance && attempts < maxAttempts) {
            console.log(`🔍 尝试查找Cropper实例 (${attempts + 1}/${maxAttempts})...`);
            // 等待时间递减，第一次长一些，后面短一些
            const waitTime = attempts === 0 ? 3000 : 1000;
            await sleep(waitTime);
            cropperInstance = findCropperInstance();
            attempts++;
        }
        if (!cropperInstance) {
            console.error("❌ 多次尝试后仍未找到Cropper实例");
            // 提供调试信息
            console.log("🔍 当前页面元素:", document.querySelectorAll('canvas, .cropper-container, [class*="cropper"]').length);
            return;
        }
        console.log("✅ 找到Cropper实例，使用API调整");
        await adjustUsingCropperAPI(cropperInstance);
    }
    // 查找Cropper实例
    function findCropperInstance() {
        console.log("🔍 查找Cropper实例...");
        // 直接查找cropper-hidden的canvas元素
        const hiddenCanvas = document.querySelector("canvas.cropper-hidden");
        console.log("hiddenCanvas:", hiddenCanvas);
        const cropperInstance = hiddenCanvas && hiddenCanvas.cropper;
        console.log("cropperInstance:", cropperInstance);
        if (cropperInstance) {
            console.log("✅ 在canvas.cropper-hidden找到Cropper实例");
            return cropperInstance;
        }
        console.log("❌ 未找到Cropper实例");
        return null;
    }
    // 使用Cropper API设置最优裁剪框
    async function adjustUsingCropperAPI(cropperInstance) {
        try {
            console.log("=== 设置最优裁剪框尺寸 ===");
            if (!cropperInstance) {
                console.error("❌ 未找到Cropper实例");
                return;
            }
            // 类型断言为 Cropper 实例
            const cropper = cropperInstance;
            // 验证cropper实例是否有必要的方法
            if (typeof cropper.getImageData !== "function" ||
                typeof cropper.setCropBoxData !== "function" ||
                typeof cropper.render !== "function") {
                console.error("❌ Cropper实例缺少必要的方法");
                return;
            }
            // 获取实际的图片数据并设置最大可能的裁剪框
            const cropperContainerData = cropper.getContainerData();
            // 计算在4:3比例下的最大尺寸
            const containerAspectRatio = cropperContainerData.width / cropperContainerData.height;
            const targetAspectRatio = 4 / 3;
            let optimalWidth;
            let optimalHeight;
            let optimalLeft;
            let optimalTop;
            if (containerAspectRatio > targetAspectRatio) {
                // 容器更宽，以高度为准
                optimalHeight = cropperContainerData.height;
                optimalWidth = optimalHeight * targetAspectRatio;
                optimalLeft = (cropperContainerData.width - optimalWidth) / 2;
                optimalTop = 0;
            }
            else {
                // 容器更高，以宽度为准
                optimalWidth = cropperContainerData.width;
                optimalHeight = optimalWidth / targetAspectRatio;
                optimalLeft = 0;
                optimalTop = (cropperContainerData.height - optimalHeight) / 2;
            }
            const optimalCropBoxData = {
                left: optimalLeft,
                top: optimalTop,
                width: optimalWidth,
                height: optimalHeight,
            };
            console.log("设置最优裁剪框:", optimalCropBoxData);
            // 应用设置
            cropper.setCropBoxData(optimalCropBoxData);
            cropper.render();
            // 验证结果
            await new Promise((resolve) => setTimeout(resolve, 300));
            const result = cropper.getCropBoxData();
            const widthCoverage = (result.width / cropperContainerData.width) * 100;
            const heightCoverage = (result.height / cropperContainerData.height) * 100;
            console.log("✅ 设置完成！");
            console.log("最终裁剪框:", result);
            console.log("容器覆盖率:", `${widthCoverage.toFixed(1)}% x ${heightCoverage.toFixed(1)}%`);
            console.log("🎉 这是4:3比例下的最大尺寸！");
        }
        catch (error) {
            console.error("❌ Cropper API调用失败:", error);
        }
    }
    // ========== 注释掉所有拖动相关函数 ==========
    // 拖动策略太复杂，已放弃
    /*
    [所有拖动相关函数已注释]
    */
    // 主执行逻辑
    try {
        console.log("🔍 开始数据结构检查");
        console.log("📝 data参数:", data);
        if (!data || !data.data) {
            console.error("❌ 数据参数为空");
            return;
        }
        const { content, video, title, tags, cover } = data.data;
        if (!video) {
            console.error("❌ 缺少视频文件");
            return;
        }
        // 获取视频元数据
        const metadata = await getVideoMetadata();
        const aspectRatio = metadata.width / metadata.height;
        console.log("📊 视频信息:", {
            width: metadata.width,
            height: metadata.height,
            aspectRatio: aspectRatio.toFixed(2),
        });
        // 下载视频文件
        console.log("📥 开始下载视频文件...");
        const response = await fetch(video.url);
        const arrayBuffer = await response.arrayBuffer();
        const videoFile = new File([arrayBuffer], video.name, {
            type: video.type,
        });
        console.log("✅ 视频文件准备完成");
        // 将标签合并到描述中
        let finalContent = content || "";
        if (tags && tags.length > 0) {
            const tagString = tags.map((tag) => `#${tag}`).join(" ");
            finalContent = `${finalContent} ${tagString}`.trim();
            console.log("📝 合并后的内容:", finalContent);
        }
        // 先启动视频上传
        console.log("📤 开始上传视频...");
        const uploadPromise = uploadVideo(videoFile).then(async () => {
            console.log("📤 视频文件已设置，等待上传完成...");
            await waitForUploadCompletion();
            console.log("✅ 视频上传完成");
        });
        // 等待一下确保视频上传已经开始
        await sleep(1000);
        // 然后开始填写表单
        console.log("📝 开始填写表单...");
        await fillDescription(finalContent);
        await fillTitle(title || "");
        console.log("✅ 表单填写完成");
        // 上传自定义封面
        if (cover) {
            console.log("🖼️ 开始上传自定义封面...");
            await uploadCover(cover, aspectRatio);
        }
        // 等待视频上传完成
        console.log("⏳ 等待视频上传完成...");
        await uploadPromise;
        // 自动发布
        if (data.isAutoPublish) {
            await sleep(5000);
            const publishButton = document.querySelector('button[type="submit"]');
            if (publishButton) {
                console.log("🚀 点击发布按钮");
                publishButton.click();
            }
            else {
                console.log("⚠️ 未找到发布按钮");
            }
        }
        console.log("✅ Dewu视频发布完成");
    }
    catch (error) {
        console.error("❌ Dewu视频发布过程中出错:", error);
        throw error;
    }
    finally {
        // 清理状态
        console.log("🧹 清理执行状态");
        window.__dewuRunning = false;
    }
}

export async function VideoEastmoney(data) {
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
            }, timeout);
        });
    }
    async function findElementByText(selector, text, maxRetries = 5, retryInterval = 1000) {
        for (let i = 0; i < maxRetries; i++) {
            const elements = document.querySelectorAll(selector);
            const element = Array.from(elements).find((element) => element.textContent?.includes(text));
            if (element) {
                return element;
            }
            console.log(`未找到包含文本 "${text}" 的元素，尝试次数：${i + 1}`);
            await new Promise((resolve) => setTimeout(resolve, retryInterval));
        }
        console.error(`在 ${maxRetries} 次尝试后未找到包含文本 "${text}" 的元素`);
        return null;
    }
    async function uploadVideo(file) {
        const fileInput = (await waitForElement('input[id="uploadVideo"]'));
        // 创建一个新的 File 对象，因为某些浏览器可能不允许直接设置 fileInput.files
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        // 触发 change 事件
        const changeEvent = new Event("change", { bubbles: true });
        fileInput.dispatchEvent(changeEvent);
        console.log("视频上传事件已触发");
    }
    try {
        const { content, video, title, description } = data.data;
        // 处理视频上传
        if (video) {
            const response = await fetch(video.url);
            const blob = await response.blob();
            const videoFile = new File([blob], video.name, { type: video.type });
            console.log(`视频文件: ${videoFile.name} ${videoFile.type} ${videoFile.size}`);
            await uploadVideo(videoFile);
            console.log("视频上传已初始化");
        }
        else {
            console.error("没有视频文件");
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const body = description || content;
        const contentToInsert = title ? `${title}\n${body}` : body;
        // 等待简介编辑器出现并输入内容
        const editor = (await waitForElement('textarea[id="videoArtTitle"]'));
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // 直接设置文本内容
        editor.textContent = contentToInsert;
        // 触发 input 事件
        const pasteEvent = new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: new DataTransfer(),
        });
        pasteEvent.clipboardData.setData("text/plain", contentToInsert);
        editor.dispatchEvent(pasteEvent);
        // 处理标签
        await new Promise((resolve) => setTimeout(resolve, 5000));
        // 如果需要自动发布
        if (data.isAutoPublish) {
            const submitButtonSpan = await findElementByText("span", "发布");
            if (submitButtonSpan) {
                console.log("点击发布按钮");
                submitButtonSpan.parentElement?.click();
            }
            else {
                console.log('未找到"发布"按钮');
            }
        }
    }
    catch (error) {
        console.error("EastmoneyVideo 发布过程中出错:", error);
    }
}

export async function VideoIqiyi(data) {
    function waitForElement(selector, timeout = 60000) {
        return new Promise((resolve, reject) => {
            const exist = document.querySelector(selector);
            if (exist) {
                resolve(exist);
                return;
            }
            let timer = 0;
            const observer = new MutationObserver(() => {
                const found = document.querySelector(selector);
                if (found) {
                    window.clearTimeout(timer);
                    observer.disconnect();
                    resolve(found);
                }
            });
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
            timer = window.setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
            }, timeout);
        });
    }
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    function isVisible(element) {
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    }
    function findVisibleElement(selector, root = document) {
        return Array.from(root.querySelectorAll(selector)).find(isVisible) ?? null;
    }
    async function injectCoverFile(input, file) {
        if (file.type && !file.type.startsWith("image/"))
            return false;
        const cBuf = await (await fetch(file.url)).arrayBuffer();
        const coverFile = new File([cBuf], file.name, { type: file.type || "image/png" });
        const cdt = new DataTransfer();
        cdt.items.add(coverFile);
        input.files = cdt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    }
    async function uploadVerticalCoverImage(file) {
        const coverEntry = document.querySelector("div.set-cover");
        if (!coverEntry)
            return;
        coverEntry.click();
        await sleep(1000);
        const coverPanel = findVisibleElement("div.base-cover-new");
        const coverInput = coverPanel?.querySelector("div.cover-editor-wrap input[type='file'][accept='.jpg,.jpeg,.png']");
        if (!coverInput)
            return;
        if (!(await injectCoverFile(coverInput, file)))
            return;
        await sleep(3000);
        const confirmBtn = coverPanel?.querySelector("div.mp-popup-btn.editor-modal-bottom button");
        confirmBtn?.click();
    }
    async function uploadHorizontalCoverImage(file) {
        let cropPanel = findVisibleElement("div.image-crop-content");
        const cropEntry = cropPanel?.querySelector("div.no-data-wrap div.main-edit-bar");
        if (!cropEntry)
            return;
        cropEntry.click();
        await sleep(2000);
        cropPanel = findVisibleElement("div.image-crop-content") ?? cropPanel;
        const panelRoot = cropPanel?.closest("div.base-cover-new") ?? cropPanel;
        const coverInput = cropPanel?.querySelector("input[type='file'][accept='.jpg,.jpeg,.png']");
        if (!coverInput)
            return;
        if (!(await injectCoverFile(coverInput, file)))
            return;
        await sleep(3000);
        const doneBtn = Array.from(panelRoot?.querySelectorAll("button") ?? []).find((button) => button.textContent?.trim() === "完成");
        if (doneBtn && !doneBtn.disabled) {
            doneBtn.click();
            await sleep(1000);
        }
    }
    async function publishIfAutoEnabled() {
        if (data.isAutoPublish !== true)
            return;
        // Re-query while polling so rerenders do not leave us holding a stale button.
        const findPublishButton = () => Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("发布"));
        let publishButton = findPublishButton();
        for (let i = 0; i < 60; i++) {
            publishButton = findPublishButton();
            if (publishButton && publishButton.getAttribute("aria-disabled") !== "true")
                break;
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (!publishButton) {
            console.debug('未找到"发布"按钮');
            return;
        }
        if (publishButton.getAttribute("aria-disabled") === "true") {
            console.debug("发布按钮仍不可用，跳过自动发布");
            return;
        }
        console.debug("sendButton clicked");
        publishButton.dispatchEvent(new Event("click", { bubbles: true }));
    }
    try {
        const { title, content, video, tags, cover, horizontalCover, description, original } = data.data;
        if (!video) {
            console.error("爱奇艺：未提供视频文件");
            return;
        }
        // Upload video.
        const fileInput = (await waitForElement('input[type="file"]'));
        const buf = await (await fetch(video.url)).arrayBuffer();
        const ext = video.name.split(".").pop() || "mp4";
        const videoFile = new File([buf], `${title}.${ext}`, { type: video.type || "video/mp4" });
        const dt = new DataTransfer();
        dt.items.add(videoFile);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 3000));
        // Fill title. iQiyi caps titles at 30 characters.
        const titleInput = document.querySelector('input[type="text"][maxlength], input[placeholder*="标题"]');
        if (titleInput && title) {
            titleInput.focus();
            titleInput.value = title.slice(0, 30);
            titleInput.dispatchEvent(new Event("input", { bubbles: true }));
            titleInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
        // Fill description.
        const descTextarea = (document.querySelector('textarea[placeholder="输入视频简介"]') ||
            findVisibleElement("textarea"));
        if (descTextarea) {
            descTextarea.focus();
            descTextarea.value = description || content || "";
            descTextarea.dispatchEvent(new Event("input", { bubbles: true }));
            descTextarea.dispatchEvent(new Event("change", { bubbles: true }));
        }
        // Fill tags.
        if (tags?.length) {
            const tagInput = document.querySelector('input[type="text"][autocomplete="off"][class*="mp-input__tag-inner"]');
            if (tagInput) {
                for (const tag of tags.slice(0, 10)) {
                    tagInput.focus();
                    tagInput.value = tag;
                    tagInput.dispatchEvent(new Event("input", { bubbles: true }));
                    tagInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter", keyCode: 13 }));
                    tagInput.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, key: "Enter", code: "Enter", keyCode: 13 }));
                    tagInput.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter", code: "Enter", keyCode: 13 }));
                    await new Promise((resolve) => setTimeout(resolve, 400));
                }
            }
        }
        // Original declaration defaults to original; explicit false switches to non-original.
        if (original === false) {
            const nonOriginalRadio = (document.querySelector('input[type="radio"][value="1"][class*="el-radio__original"]') ||
                document.querySelectorAll('input[type="radio"][class*="mp-radio__original"]')[1]);
            nonOriginalRadio?.click();
        }
        else {
            const originalRadio = (document.querySelector('input[type="radio"][value="0"][class*="el-radio__original"]') ||
                document.querySelector('input[type="radio"][value="0"][class*="mp-radio__original"]') ||
                document.querySelectorAll('input[type="radio"][class*="mp-radio__original"]')[0]);
            originalRadio?.click();
        }
        // Upload vertical and horizontal covers.
        if (cover) {
            await uploadVerticalCoverImage(cover);
            await sleep(5000);
        }
        if (horizontalCover) {
            await uploadHorizontalCoverImage(horizontalCover);
        }
        await publishIfAutoEnabled();
    }
    catch (error) {
        console.error("爱奇艺视频发布失败:", error);
    }
}

export async function VideoKuaishou(data) {
    const { content, video, title, tags = [], cover, scheduledPublishTime } = data.data;
    function formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        const seconds = String(date.getSeconds()).padStart(2, "0");
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }
    // 辅助函数：等待元素出现
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
            }, timeout);
        });
    }
    // 辅助函数：上传视频
    async function uploadVideo() {
        await waitForElement('input[type="file"]');
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (!video) {
            console.error("没有视频文件");
            return;
        }
        const fileInput = document.querySelector('input[type="file"]');
        if (!fileInput) {
            console.error("未找到文件输入元素");
            return;
        }
        try {
            // Support both url and blobUrl
            const videoUrl = video.url;
            const response = await fetch(videoUrl);
            if (!response.ok) {
                throw new Error(`HTTP 错误! 状态: ${response.status}`);
            }
            const buffer = await response.arrayBuffer();
            const file = new File([buffer], video.name, { type: video.type });
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
            fileInput.dispatchEvent(new Event("input", { bubbles: true }));
            console.log("文件上传操作完成");
        }
        catch (error) {
            console.error("上传视频失败:", error);
        }
    }
    // 辅助函数：上传封面
    async function uploadCover() {
        if (!cover)
            return;
        const coverSettingsSpan = Array.from(document.querySelectorAll("span")).find((el) => el.textContent?.includes("封面设置"));
        if (!coverSettingsSpan) {
            console.error('未找到 "封面设置" 按钮');
            return;
        }
        const coverUploadButton = coverSettingsSpan.parentElement?.nextElementSibling?.firstChild
            ?.firstChild;
        if (!coverUploadButton) {
            console.error("未找到封面上传区域");
            return;
        }
        coverUploadButton.click();
        try {
            await waitForElement("div.ant-modal-body");
        }
        catch (error) {
            console.error("封面设置弹窗未出现", error);
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
        while (true) {
            const loadingSpan = Array.from(document.querySelectorAll("div.ant-modal-body span")).find((el) => el.textContent === "加载中");
            if (loadingSpan) {
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }
            else {
                break;
            }
        }
        const uploadCoverDiv = Array.from(document.querySelectorAll("div.ant-modal-body div")).find((el) => el.textContent === "上传封面");
        if (!uploadCoverDiv) {
            console.error('未找到 "上传封面" 按钮');
            return;
        }
        uploadCoverDiv.click();
        const fileInput = (await waitForElement("div.ant-modal-body input[type='file']"));
        if (!fileInput) {
            console.error("未找到封面上传的 file input");
            return;
        }
        const dataTransfer = new DataTransfer();
        if (cover.type?.includes("image/")) {
            try {
                // Support both url and blobUrl
                const coverUrl = cover.url;
                const response = await fetch(coverUrl);
                if (!response.ok) {
                    throw new Error(`HTTP 错误! 状态: ${response.status}`);
                }
                const buffer = await response.arrayBuffer();
                const file = new File([buffer], cover.name, { type: cover.type });
                dataTransfer.items.add(file);
            }
            catch (error) {
                console.error("上传封面失败:", error);
            }
        }
        if (dataTransfer.files.length === 0) {
            console.error("没有要上传的封面文件");
            return;
        }
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        fileInput.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const confirmButton = Array.from(document.querySelectorAll("button")).find((el) => el.textContent?.trim() === "确认");
        if (confirmButton) {
            confirmButton.click();
        }
        else {
            console.error("未找到'确认'按钮");
        }
    }
    // 上传视频
    await uploadVideo();
    // 填写内容
    const contentEditor = (await waitForElement('div[contenteditable="true"]'));
    if (contentEditor) {
        // 组合标题、内容和标签（限制标签为4个）
        const limitedTags = tags.slice(0, 4);
        const formattedContent = `${title || ""}\n${content}\n${limitedTags.map((tag) => `#${tag}`).join(" ")}`;
        // 先点击再focus
        contentEditor.click();
        await new Promise((resolve) => setTimeout(resolve, 500));
        contentEditor.focus();
        // 使用 ClipboardEvent 来粘贴内容
        const pasteEvent = new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: new DataTransfer(),
        });
        pasteEvent.clipboardData?.setData("text/plain", formattedContent);
        contentEditor.dispatchEvent(pasteEvent);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        contentEditor.blur();
    }
    // 上传封面
    if (cover) {
        await uploadCover();
    }
    // 定时发布功能
    if (scheduledPublishTime && scheduledPublishTime > 0) {
        const labels = document.querySelectorAll("label");
        const scheduledPublishLabel = Array.from(labels).find((el) => el.textContent?.includes("定时发布"));
        if (scheduledPublishLabel) {
            scheduledPublishLabel.click();
            await new Promise((resolve) => setTimeout(resolve, 500));
            const publishTimeInput = document.querySelector('input[placeholder="选择日期时间"]');
            if (publishTimeInput) {
                const publishDate = new Date(scheduledPublishTime);
                publishTimeInput.value = formatDate(publishDate);
                publishTimeInput.dispatchEvent(new Event("input", { bubbles: true }));
                publishTimeInput.dispatchEvent(new Event("change", { bubbles: true }));
                await new Promise((resolve) => setTimeout(resolve, 2000));
                const confirmLis = document.querySelectorAll("li.ant-picker-ok");
                const confirmLi = Array.from(confirmLis).find((el) => el.textContent === "确定");
                if (confirmLi) {
                    const confirmButton = confirmLi.querySelector("button");
                    if (confirmButton) {
                        confirmButton.click();
                    }
                }
            }
        }
    }
    // 等待内容更新
    await new Promise((resolve) => setTimeout(resolve, 5000));
    // 发布按钮逻辑 - 只有在 autoPublish 为 true 时才自动点击发布
    const divElements = document.querySelectorAll("div");
    const publishButton = Array.from(divElements).find((el) => el.textContent === "发布");
    if (publishButton) {
        if (data.isAutoPublish) {
            console.log("发布按钮已点击");
            publishButton.click();
        }
    }
    else {
        console.log('未找到"发布"按钮');
    }
}

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 网易号视频发布器
 */
export async function VideoNetease(data) {
    console.log("🚀 开始网易号视频发布流程...");
    console.log("🔍 当前页面:", window.location.href);
    try {
        // 检查是否在网易号页面
        if (!window.location.href.includes("dy.163.com")) {
            console.error("❌ 不在网易号页面，当前页面:", window.location.href);
            return;
        }
        // 解析视频数据
        if (!data || !data.data) {
            console.error("❌ 缺少视频数据");
            return;
        }
        const { content, video, title, description } = data.data;
        console.log("📝 视频数据:", {
            title: title?.substring(0, 50),
            contentLength: content?.length,
            hasVideo: !!video,
        });
        // 内联定义网易号视频上传器类
        const NeteaseVideoUploader = class NeteaseVideoUploader {
            /**
             * 等待指定时间
             */
            sleep(ms) {
                return new Promise((resolve) => setTimeout(resolve, ms));
            }
            /**
             * 等待元素出现
             */
            async waitForElement(selector, timeout = 10000) {
                return new Promise((resolve, reject) => {
                    const element = document.querySelector(selector);
                    if (element) {
                        resolve(element);
                        return;
                    }
                    const observer = new MutationObserver(() => {
                        const element = document.querySelector(selector);
                        if (element) {
                            resolve(element);
                            observer.disconnect();
                        }
                    });
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true,
                    });
                    setTimeout(() => {
                        observer.disconnect();
                        reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
                    }, timeout);
                });
            }
            /**
             * 填写标题
             */
            async fillTitle(title) {
                try {
                    console.log("📝 填写标题:", title);
                    // 等待页面加载
                    await this.sleep(3000);
                    // 网易号标题输入框选择器
                    const titleSelectors = [
                        'input[placeholder*="标题"]',
                        'input[placeholder*="title"]',
                        'input[name*="title"]',
                        'input[class*="title"]',
                        'input[type="text"]',
                        '.ant-input[type="text"]',
                        ".ant-input",
                        "#title",
                        'textarea[placeholder*="标题"]',
                        '.form-input[type="text"]',
                        '.el-input__inner[type="text"]',
                        ".nes-input",
                    ];
                    for (const selector of titleSelectors) {
                        const titleElement = document.querySelector(selector);
                        if (titleElement && titleElement.offsetParent !== null) {
                            console.log("✅ 找到标题输入框:", selector);
                            try {
                                // 清空原有内容
                                titleElement.focus();
                                titleElement.select();
                                // 逐字符输入模拟真实用户行为
                                for (let i = 0; i < title.length; i++) {
                                    const _char = title[i];
                                    titleElement.value = title.substring(0, i + 1);
                                    // 触发输入事件
                                    titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                    await this.sleep(50);
                                }
                                // 触发多种事件确保框架识别
                                titleElement.dispatchEvent(new Event("focus", { bubbles: true }));
                                titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                titleElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                titleElement.dispatchEvent(new Event("blur", { bubbles: true }));
                                // 验证设置是否成功
                                console.log(`✅ 标题设置后验证: value="${titleElement.value}"`);
                                if (titleElement.value === title) {
                                    console.log("✅ 标题填写成功");
                                    return;
                                }
                            }
                            catch (e) {
                                console.error("设置标题值时出错:", e);
                            }
                        }
                    }
                    console.log("❌ 未找到可用的标题输入框");
                    return;
                }
                catch (error) {
                    console.error("填写标题失败:", error);
                    return;
                }
            }
            /**
             * 填写描述
             */
            async fillDescription(description) {
                try {
                    console.log("📝 填写描述:", `${description.substring(0, 100)}...`);
                    // 网易号描述输入框选择器
                    const descSelectors = [
                        'textarea[placeholder*="描述"]',
                        'textarea[placeholder*="简介"]',
                        'textarea[placeholder*="内容"]',
                        'textarea[name*="content"]',
                        'textarea[name*="desc"]',
                        "textarea",
                        ".ant-input",
                        "#content",
                        "#description",
                        ".form-textarea",
                        ".el-textarea__inner",
                        ".nes-textarea",
                    ];
                    for (const selector of descSelectors) {
                        const descElement = document.querySelector(selector);
                        if (descElement && descElement.offsetParent !== null) {
                            console.log("✅ 找到描述输入框:", selector);
                            try {
                                descElement.focus();
                                descElement.value = description;
                                // 触发多种事件
                                descElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                descElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                console.log("✅ 描述填写成功");
                                return;
                            }
                            catch (e) {
                                console.error("设置描述值时出错:", e);
                            }
                        }
                    }
                    console.log("❌ 未找到可用的描述输入框");
                    return;
                }
                catch (error) {
                    console.error("填写描述失败:", error);
                    return;
                }
            }
            /**
             * 上传视频文件
             */
            async uploadVideo(videoData) {
                try {
                    console.log("📹 开始上传视频...");
                    // 获取视频文件
                    let file;
                    if (videoData.videoFile) {
                        file = videoData.videoFile;
                    }
                    else if (videoData.url) {
                        const response = await fetch(videoData.url);
                        const arrayBuffer = await response.arrayBuffer();
                        const extension = videoData.name.split(".").pop() || "mp4";
                        const fileName = `${videoData.name.replace(/\.[^/.]+$/, "")}.${extension}`;
                        file = new File([arrayBuffer], fileName, { type: "video/mp4" });
                    }
                    else {
                        console.error("❌ 无效的视频数据");
                        return;
                    }
                    console.log("📁 视频文件:", file.name, file.size, file.type);
                    // 等待页面完全加载
                    console.log("⏳ 等待页面加载完成...");
                    await this.sleep(5000);
                    // 查找上传区域
                    console.log("🔍 查找网易号上传区域...");
                    const uploadSelectors = [
                        ".upload-area",
                        ".video-upload",
                        '[class*="upload"]',
                        '[class*="video"]',
                        ".ant-upload",
                        "#upload",
                        ".upload-btn",
                        'button[class*="upload"]',
                        ".upload-container",
                        ".el-upload",
                        ".el-upload-dragger",
                        ".nes-upload",
                        ".upload-wrapper",
                    ];
                    let uploadArea = null;
                    for (const selector of uploadSelectors) {
                        const element = document.querySelector(selector);
                        if (element && element.offsetParent !== null) {
                            console.log(`✅ 找到上传区域: ${selector}`);
                            uploadArea = element;
                            break;
                        }
                    }
                    if (!uploadArea) {
                        console.log("❌ 未找到上传区域，尝试查找文件输入框...");
                        // 直接查找文件输入框
                        const fileInputs = document.querySelectorAll('input[type="file"]');
                        console.log(`🔍 找到 ${fileInputs.length} 个文件输入框`);
                        let targetInput = null;
                        fileInputs.forEach((input, index) => {
                            const accept = input.getAttribute("accept") || "";
                            console.log(`  输入框 ${index + 1}: accept="${accept}"`);
                            // 优先查找视频文件输入框
                            if (accept.includes("video") || accept.includes("*") || accept === "") {
                                targetInput = input;
                                console.log(`✅ 选择输入框 ${index + 1} 作为目标`);
                            }
                        });
                        if (targetInput) {
                            // 使用DataTransfer API设置文件
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            targetInput.files = dataTransfer.files;
                            // 触发change事件
                            targetInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 文件已设置到输入框");
                            return;
                        }
                        console.log("❌ 未找到合适的文件输入框");
                        return;
                    }
                    // 如果找到了上传区域，尝试点击或操作
                    console.log("🔄 尝试操作上传区域...");
                    // 查找上传区域内的文件输入框
                    const uploadInput = uploadArea.querySelector('input[type="file"]');
                    if (uploadInput) {
                        console.log("✅ 在上传区域内找到文件输入框");
                        // 创建透明的文件输入框覆盖上传区域
                        const overlayInput = document.createElement("input");
                        overlayInput.type = "file";
                        overlayInput.accept = "video/*,.mp4,.avi,.mov,.wmv";
                        overlayInput.style.position = "absolute";
                        overlayInput.style.opacity = "0";
                        overlayInput.style.width = "100%";
                        overlayInput.style.height = "100%";
                        overlayInput.style.top = "0";
                        overlayInput.style.left = "0";
                        overlayInput.style.zIndex = "9999";
                        overlayInput.id = `netease_upload_${Date.now()}`;
                        // 设置上传区域样式以支持覆盖
                        const uploadElement = uploadArea;
                        uploadElement.style.position = "relative";
                        uploadElement.appendChild(overlayInput);
                        // 设置文件
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        overlayInput.files = dataTransfer.files;
                        // 触发文件选择事件
                        overlayInput.dispatchEvent(new Event("focus", { bubbles: true }));
                        overlayInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                        console.log("✅ 文件已设置到覆盖输入框");
                        // 尝试点击上传区域（如果需要）
                        if (uploadArea.tagName === "BUTTON" || uploadArea.closest("button")) {
                            console.log("🖱️ 点击上传按钮...");
                            (uploadArea.closest("button") || uploadArea).click();
                            await this.sleep(1000);
                        }
                        // 等待上传开始
                        await this.waitForUploadStart();
                        return;
                    }
                    console.log("⚠️ 上传区域内未找到文件输入框，尝试点击上传区域...");
                    // 点击上传区域触发文件选择
                    const clickableElement = uploadArea.closest("button") || uploadArea.querySelector("button") || uploadArea;
                    if (clickableElement) {
                        console.log("🖱️ 点击可点击元素...");
                        clickableElement.click();
                        await this.sleep(2000);
                        // 再次查找文件输入框
                        const newFileInput = document.querySelector('input[type="file"]');
                        if (newFileInput) {
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            newFileInput.files = dataTransfer.files;
                            newFileInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 文件已设置到新找到的输入框");
                            return;
                        }
                    }
                    console.log("⚠️ 无法直接上传文件，但页面可能已经准备好了");
                    return;
                }
                catch (error) {
                    console.error("❌ 视频上传失败:", error);
                    return;
                }
            }
            /**
             * 等待上传开始
             */
            async waitForUploadStart() {
                console.log("⏳ 等待上传开始...");
                for (let i = 0; i < 30; i++) {
                    await this.sleep(1000);
                    // 检查上传进度指示器
                    const progressSelectors = [
                        '[class*="progress"]',
                        '[class*="uploading"]',
                        '[class*="upload-progress"]',
                        ".ant-progress",
                        ".progress-bar",
                        ".uploading",
                        ".el-progress",
                        ".nes-progress",
                    ];
                    for (const selector of progressSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log("✅ 检测到上传进度指示器");
                            return;
                        }
                    }
                    // 检查是否有上传成功标志
                    const successSelectors = ['[class*="success"]', '[class*="complete"]', '[class*="done"]', ".upload-success"];
                    for (const selector of successSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log("✅ 检测到上传成功标志");
                            return;
                        }
                    }
                }
                console.log("⚠️ 未检测到明确的上传状态，但可能已开始");
            }
        };
        console.log("✅ 网易号上传器类定义完成");
        const uploader = new NeteaseVideoUploader();
        console.log("✅ 网易号上传器实例创建完成");
        // 步骤1: 填写标题
        if (title) {
            console.log("📝 填写标题:", title);
            await uploader.fillTitle(title);
        }
        // 步骤2: 填写描述
        if (content) {
            console.log("📝 填写描述:", `${content.substring(0, 100)}...`);
            await uploader.fillDescription(description ?? content);
        }
        // 步骤3: 上传视频
        if (video) {
            console.log("🎥 开始上传视频...");
            await uploader.uploadVideo(video);
        }
        else {
            console.error("❌ 缺少视频文件");
            return;
        }
        console.log("🎉 网易号视频发布流程完成");
        return;
    }
    catch (error) {
        console.error("💥 网易号视频发布失败:", error);
        console.error("错误详情:", error.stack);
        return;
    }
}

export async function VideoOkjike(data) {
    const { title, content, video, description } = data.data;
    // 辅助函数：等待元素出现
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
            }, timeout);
        });
    }
    // 填写内容
    async function fillContent() {
        const textarea = (await waitForElement('textarea[placeholder="分享你的想法..."]'));
        if (textarea) {
            // 如果有标题，将标题和内容拼接(优先 description 字段)
            const body = description || content;
            const fullContent = title ? `${title}\n\n${body}` : body;
            textarea.value = fullContent;
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }
    // 上传视频文件
    async function uploadVideo() {
        if (!video) {
            console.error("没有视频文件");
            return;
        }
        const fileInput = document.querySelector('input[type="file"][accept="video/mp4"]');
        if (!fileInput) {
            console.error("未找到文件输入元素");
            return;
        }
        const dataTransfer = new DataTransfer();
        try {
            const response = await fetch(video.url);
            if (!response.ok)
                throw new Error(`HTTP 错误! 状态: ${response.status}`);
            const blob = await response.blob();
            const file = new File([blob], video.name, { type: video.type });
            dataTransfer.items.add(file);
        }
        catch (error) {
            console.error("上传视频失败:", error);
            return;
        }
        if (dataTransfer.files.length > 0) {
            fileInput.files = dataTransfer.files;
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
            fileInput.dispatchEvent(new Event("input", { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
    // 主流程
    try {
        await fillContent();
        await uploadVideo();
        if (data.isAutoPublish) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            const buttons = document.querySelectorAll("button");
            const publishButton = Array.from(buttons).find((button) => button.textContent?.includes("发布"));
            if (publishButton) {
                let attempts = 0;
                while (publishButton.disabled && attempts < 10) {
                    await new Promise((resolve) => setTimeout(resolve, 3000));
                    attempts++;
                    console.log(`等待发布按钮可用... 尝试 ${attempts}/10`);
                }
                if (publishButton.disabled) {
                    console.error("发布按钮在10次尝试后仍被禁用");
                    return;
                }
                console.log("点击发布按钮");
                publishButton.click();
            }
        }
    }
    catch (error) {
        console.error("发布过程中出错:", error);
    }
}

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 拼多多视频发布器
 */
export async function VideoPinduoduo(data) {
    console.log("🚀 开始拼多多视频发布流程...");
    console.log("🔍 当前页面:", window.location.href);
    try {
        // 检查是否在拼多多页面
        if (!window.location.href.includes("pinduoduo.com")) {
            console.error("❌ 不在拼多多页面，当前页面:", window.location.href);
            return;
        }
        // 解析视频数据
        if (!data || !data.data) {
            console.error("❌ 缺少视频数据");
            return;
        }
        const { content, video, title, description } = data.data;
        console.log("📝 视频数据:", {
            title: title?.substring(0, 50),
            contentLength: content?.length,
            hasVideo: !!video,
        });
        // 内联定义拼多多视频上传器类
        const PinduoduoVideoUploader = class PinduoduoVideoUploader {
            /**
             * 等待指定时间
             */
            sleep(ms) {
                return new Promise((resolve) => setTimeout(resolve, ms));
            }
            /**
             * 等待元素出现
             */
            async waitForElement(selector, timeout = 10000) {
                return new Promise((resolve, reject) => {
                    const element = document.querySelector(selector);
                    if (element) {
                        resolve(element);
                        return;
                    }
                    const observer = new MutationObserver(() => {
                        const element = document.querySelector(selector);
                        if (element) {
                            resolve(element);
                            observer.disconnect();
                        }
                    });
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true,
                    });
                    setTimeout(() => {
                        observer.disconnect();
                        reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
                    }, timeout);
                });
            }
            /**
             * 填写标题
             */
            async fillTitle(title) {
                try {
                    console.log("📝 填写标题:", title);
                    // 等待页面加载
                    await this.sleep(3000);
                    // 拼多多标题输入框选择器
                    const titleSelectors = [
                        'input[placeholder*="标题"]',
                        'input[placeholder*="title"]',
                        'input[name*="title"]',
                        'input[class*="title"]',
                        'input[type="text"]',
                        '.ant-input[type="text"]',
                        ".ant-input",
                        "#title",
                        'textarea[placeholder*="标题"]',
                        '.form-input[type="text"]',
                        '.el-input__inner[type="text"]',
                        ".pdd-input",
                    ];
                    for (const selector of titleSelectors) {
                        const titleElement = document.querySelector(selector);
                        if (titleElement && titleElement.offsetParent !== null) {
                            console.log("✅ 找到标题输入框:", selector);
                            try {
                                // 清空原有内容
                                titleElement.focus();
                                titleElement.select();
                                // 逐字符输入模拟真实用户行为
                                for (let i = 0; i < title.length; i++) {
                                    const _char = title[i];
                                    titleElement.value = title.substring(0, i + 1);
                                    // 触发输入事件
                                    titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                    await this.sleep(50);
                                }
                                // 触发多种事件确保框架识别
                                titleElement.dispatchEvent(new Event("focus", { bubbles: true }));
                                titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                titleElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                titleElement.dispatchEvent(new Event("blur", { bubbles: true }));
                                // 验证设置是否成功
                                console.log(`✅ 标题设置后验证: value="${titleElement.value}"`);
                                if (titleElement.value === title) {
                                    console.log("✅ 标题填写成功");
                                    return;
                                }
                            }
                            catch (e) {
                                console.error("设置标题值时出错:", e);
                            }
                        }
                    }
                    console.log("❌ 未找到可用的标题输入框");
                    return;
                }
                catch (error) {
                    console.error("填写标题失败:", error);
                    return;
                }
            }
            /**
             * 填写描述
             */
            async fillDescription(description) {
                try {
                    console.log("📝 填写描述:", `${description.substring(0, 100)}...`);
                    // 拼多多描述输入框选择器
                    const descSelectors = [
                        'textarea[placeholder*="描述"]',
                        'textarea[placeholder*="简介"]',
                        'textarea[placeholder*="内容"]',
                        'textarea[name*="content"]',
                        'textarea[name*="desc"]',
                        "textarea",
                        ".ant-input",
                        "#content",
                        "#description",
                        ".form-textarea",
                        ".el-textarea__inner",
                        ".pdd-textarea",
                    ];
                    for (const selector of descSelectors) {
                        const descElement = document.querySelector(selector);
                        if (descElement && descElement.offsetParent !== null) {
                            console.log("✅ 找到描述输入框:", selector);
                            try {
                                descElement.focus();
                                descElement.value = description;
                                // 触发多种事件
                                descElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                descElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                console.log("✅ 描述填写成功");
                                return;
                            }
                            catch (e) {
                                console.error("设置描述值时出错:", e);
                            }
                        }
                    }
                    console.log("❌ 未找到可用的描述输入框");
                    return;
                }
                catch (error) {
                    console.error("填写描述失败:", error);
                    return;
                }
            }
            /**
             * 上传视频文件
             */
            async uploadVideo(videoData) {
                try {
                    console.log("📹 开始上传视频...");
                    // 获取视频文件
                    let file;
                    if (videoData.videoFile) {
                        file = videoData.videoFile;
                    }
                    else if (videoData.url) {
                        const response = await fetch(videoData.url);
                        const arrayBuffer = await response.arrayBuffer();
                        const extension = videoData.name.split(".").pop() || "mp4";
                        const fileName = `${videoData.name.replace(/\.[^/.]+$/, "")}.${extension}`;
                        file = new File([arrayBuffer], fileName, { type: "video/mp4" });
                    }
                    else {
                        console.error("❌ 无效的视频数据");
                        return;
                    }
                    console.log("📁 视频文件:", file.name, file.size, file.type);
                    // 等待页面完全加载
                    console.log("⏳ 等待页面加载完成...");
                    await this.sleep(5000);
                    // 查找上传区域
                    console.log("🔍 查找拼多多上传区域...");
                    const uploadSelectors = [
                        ".upload-area",
                        ".video-upload",
                        '[class*="upload"]',
                        '[class*="video"]',
                        ".ant-upload",
                        "#upload",
                        ".upload-btn",
                        'button[class*="upload"]',
                        ".upload-container",
                        ".el-upload",
                        ".el-upload-dragger",
                        ".pdd-upload",
                        ".upload-wrapper",
                    ];
                    let uploadArea = null;
                    for (const selector of uploadSelectors) {
                        const element = document.querySelector(selector);
                        if (element && element.offsetParent !== null) {
                            console.log(`✅ 找到上传区域: ${selector}`);
                            uploadArea = element;
                            break;
                        }
                    }
                    if (!uploadArea) {
                        console.log("❌ 未找到上传区域，尝试查找文件输入框...");
                        // 直接查找文件输入框
                        const fileInputs = document.querySelectorAll('input[type="file"]');
                        console.log(`🔍 找到 ${fileInputs.length} 个文件输入框`);
                        let targetInput = null;
                        fileInputs.forEach((input, index) => {
                            const accept = input.getAttribute("accept") || "";
                            console.log(`  输入框 ${index + 1}: accept="${accept}"`);
                            // 优先查找视频文件输入框
                            if (accept.includes("video") || accept.includes("*") || accept === "") {
                                targetInput = input;
                                console.log(`✅ 选择输入框 ${index + 1} 作为目标`);
                            }
                        });
                        if (targetInput) {
                            // 使用DataTransfer API设置文件
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            targetInput.files = dataTransfer.files;
                            // 触发change事件
                            targetInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 文件已设置到输入框");
                            return;
                        }
                        console.log("❌ 未找到合适的文件输入框");
                        return;
                    }
                    // 如果找到了上传区域，尝试点击或操作
                    console.log("🔄 尝试操作上传区域...");
                    // 查找上传区域内的文件输入框
                    const uploadInput = uploadArea.querySelector('input[type="file"]');
                    if (uploadInput) {
                        console.log("✅ 在上传区域内找到文件输入框");
                        // 创建透明的文件输入框覆盖上传区域
                        const overlayInput = document.createElement("input");
                        overlayInput.type = "file";
                        overlayInput.accept = "video/*,.mp4,.avi,.mov,.wmv";
                        overlayInput.style.position = "absolute";
                        overlayInput.style.opacity = "0";
                        overlayInput.style.width = "100%";
                        overlayInput.style.height = "100%";
                        overlayInput.style.top = "0";
                        overlayInput.style.left = "0";
                        overlayInput.style.zIndex = "9999";
                        overlayInput.id = `pinduoduo_upload_${Date.now()}`;
                        // 设置上传区域样式以支持覆盖
                        const uploadElement = uploadArea;
                        uploadElement.style.position = "relative";
                        uploadElement.appendChild(overlayInput);
                        // 设置文件
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        overlayInput.files = dataTransfer.files;
                        // 触发文件选择事件
                        overlayInput.dispatchEvent(new Event("focus", { bubbles: true }));
                        overlayInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                        console.log("✅ 文件已设置到覆盖输入框");
                        // 尝试点击上传区域（如果需要）
                        if (uploadArea.tagName === "BUTTON" || uploadArea.closest("button")) {
                            console.log("🖱️ 点击上传按钮...");
                            (uploadArea.closest("button") || uploadArea).click();
                            await this.sleep(1000);
                        }
                        // 等待上传开始
                        await this.waitForUploadStart();
                        return;
                    }
                    console.log("⚠️ 上传区域内未找到文件输入框，尝试点击上传区域...");
                    // 点击上传区域触发文件选择
                    const clickableElement = uploadArea.closest("button") || uploadArea.querySelector("button") || uploadArea;
                    if (clickableElement) {
                        console.log("🖱️ 点击可点击元素...");
                        clickableElement.click();
                        await this.sleep(2000);
                        // 再次查找文件输入框
                        const newFileInput = document.querySelector('input[type="file"]');
                        if (newFileInput) {
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            newFileInput.files = dataTransfer.files;
                            newFileInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 文件已设置到新找到的输入框");
                            return;
                        }
                    }
                    console.log("⚠️ 无法直接上传文件，但页面可能已经准备好了");
                    return;
                }
                catch (error) {
                    console.error("❌ 视频上传失败:", error);
                    return;
                }
            }
            /**
             * 等待上传开始
             */
            async waitForUploadStart() {
                console.log("⏳ 等待上传开始...");
                for (let i = 0; i < 30; i++) {
                    await this.sleep(1000);
                    // 检查上传进度指示器
                    const progressSelectors = [
                        '[class*="progress"]',
                        '[class*="uploading"]',
                        '[class*="upload-progress"]',
                        ".ant-progress",
                        ".progress-bar",
                        ".uploading",
                        ".el-progress",
                        ".pdd-progress",
                    ];
                    for (const selector of progressSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log("✅ 检测到上传进度指示器");
                            return;
                        }
                    }
                    // 检查是否有上传成功标志
                    const successSelectors = ['[class*="success"]', '[class*="complete"]', '[class*="done"]', ".upload-success"];
                    for (const selector of successSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log("✅ 检测到上传成功标志");
                            return;
                        }
                    }
                }
                console.log("⚠️ 未检测到明确的上传状态，但可能已开始");
            }
        };
        console.log("✅ 拼多多上传器类定义完成");
        const uploader = new PinduoduoVideoUploader();
        console.log("✅ 拼多多上传器实例创建完成");
        // 步骤1: 填写标题
        if (title) {
            console.log("📝 填写标题:", title);
            await uploader.fillTitle(title);
        }
        // 步骤2: 填写描述
        if (content) {
            console.log("📝 填写描述:", `${content.substring(0, 100)}...`);
            await uploader.fillDescription(description ?? content);
        }
        // 步骤3: 上传视频
        if (video) {
            console.log("🎥 开始上传视频...");
            await uploader.uploadVideo(video);
        }
        else {
            console.error("❌ 缺少视频文件");
            return;
        }
        console.log("🎉 拼多多视频发布流程完成");
        return;
    }
    catch (error) {
        console.error("💥 拼多多视频发布失败:", error);
        console.error("错误详情:", error.stack);
        return;
    }
}

// 主导出函数
export async function VideoQiE(data) {
    console.log("🎬 QiE视频上传开始...");
    console.log("📊 接收到的数据:", {
        hasVideo: !!data.data?.video,
        hasCover: !!data.data?.cover,
        hasTitle: !!data.data?.title,
        hasContent: !!data.data?.content,
        tagsCount: data.data?.tags?.length || 0,
        isAutoPublish: data.isAutoPublish,
    });
    try {
        console.log("开始创建QiEVideoUploader实例...");
        // 直接在这里定义类，避免作用域问题
        class QiEVideoUploader {
            waitForElement(selector, timeout = 10000) {
                return new Promise((resolve, reject) => {
                    const element = document.querySelector(selector);
                    if (element) {
                        resolve(element);
                        return;
                    }
                    const observer = new MutationObserver(() => {
                        const element = document.querySelector(selector);
                        if (element) {
                            resolve(element);
                            observer.disconnect();
                        }
                    });
                    observer.observe(document.body, { childList: true, subtree: true });
                    setTimeout(() => {
                        observer.disconnect();
                        reject(new Error(`Element "${selector}" not found`));
                    }, timeout);
                });
            }
            sleep(ms) {
                return new Promise((resolve) => setTimeout(resolve, ms));
            }
            simulateClick(element) {
                const rect = element.getBoundingClientRect();
                const clickX = rect.left + rect.width / 2;
                const clickY = rect.top + rect.height / 2;
                element.dispatchEvent(new MouseEvent("mousedown", {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    clientX: clickX,
                    clientY: clickY,
                }));
                element.dispatchEvent(new MouseEvent("mouseup", {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    clientX: clickX,
                    clientY: clickY,
                }));
                element.dispatchEvent(new MouseEvent("click", {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    clientX: clickX,
                    clientY: clickY,
                }));
            }
            async process(data) {
                console.log("🚀 开始QiE处理流程...");
                console.log("🌐 当前页面URL:", window.location.href);
                if (!window.location.href.includes("om.qq.com")) {
                    console.log("⚠️ 当前页面不是企鹅号页面，跳过处理");
                    return;
                }
                const videoData = data.data;
                const { video, title, content, tags, cover } = videoData;
                if (video) {
                    console.log("开始上传视频文件:", video.name);
                    // 执行视频上传
                    const uploadSuccess = await this.performVideoUpload(video, videoData);
                    if (!uploadSuccess) {
                        console.log("❌ 视频上传失败，终止流程");
                        return;
                    }
                    console.log("✅ 视频上传完成，开始处理内容编辑...");
                    // 等待页面完全加载
                    await this.sleep(3000);
                    // 处理标题输入
                    if (title) {
                        await this.fillTitle(title);
                    }
                    await this.sleep(2000);
                    // 处理简介输入
                    if (content) {
                        await this.fillContent(content);
                    }
                    await this.sleep(2000);
                    // 处理标签
                    if (tags && tags.length > 0) {
                        await this.fillTags(tags);
                    }
                    // 上传封面
                    if (cover) {
                        await this.sleep(1000);
                        await this.uploadCover(cover.url);
                    }
                    // 等待所有操作完成
                    await this.sleep(3000);
                    // 自动发布（如果需要）
                    if (data.isAutoPublish) {
                        await this.attemptAutoPublish();
                    }
                }
            }
            async performVideoUpload(video, videoData) {
                try {
                    const fileInput = await this.findVideoFileInput();
                    if (!fileInput) {
                        console.log("❌ 未找到视频上传输入框");
                        return false;
                    }
                    console.log("📁 开始上传视频文件...");
                    const response = await fetch(video.url);
                    const blob = await response.arrayBuffer();
                    const extension = video.name.split(".").pop() || "mp4";
                    const videoFilename = `${videoData.title || "video"}.${extension}`;
                    const videoFile = new File([blob], videoFilename, { type: video.type });
                    console.log("📹 视频文件信息:", {
                        name: videoFile.name,
                        type: videoFile.type,
                        size: videoFile.size,
                    });
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(videoFile);
                    fileInput.files = dataTransfer.files;
                    // 触发多个事件确保上传
                    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
                    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
                    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
                    console.log("✅ 视频上传事件已触发");
                    // 等待视频上传完成并页面跳转
                    await this.waitForVideoUpload();
                    return true;
                }
                catch (error) {
                    console.error("❌ 视频上传过程出错:", error);
                    return false;
                }
            }
            async findVideoFileInput() {
                const fileSelectors = [
                    'input[type="file"]', // 通用文件输入框选择器
                    'input[name="Filedata"]', // 企鹅号特定的文件输入框
                    "#upload-input", // 如果有ID的话
                    ".upload-input", // 如果有固定类名的话
                ];
                console.log("🔍 开始查找视频上传输入框...");
                // 首次尝试
                for (const selector of fileSelectors) {
                    const fileInput = document.querySelector(selector);
                    if (fileInput) {
                        console.log(`✅ 找到视频上传输入框，使用选择器: ${selector}`);
                        return fileInput;
                    }
                    console.log(`❌ 选择器 ${selector} 未找到元素`);
                }
                // 延迟重试
                console.log("⏳ 等待3秒后再次尝试查找文件输入框...");
                await this.sleep(3000);
                for (const selector of fileSelectors) {
                    const fileInput = document.querySelector(selector);
                    if (fileInput) {
                        console.log(`✅ 延迟查找成功，使用选择器: ${selector}`);
                        return fileInput;
                    }
                }
                console.log("❌ 延迟查找后仍未找到文件输入框");
                return null;
            }
            async fillTitle(title) {
                console.log("开始处理标题输入...");
                const titleSelectors = [
                    ".omui-inputautogrowing.omui-articletitle__input.omui-articletitle__input1",
                    ".omui-inputautogrowing.omui-articletitle__input.omui-articletitle__input2",
                    ".omui-articletitle__input",
                    "div.omui-inputautogrowing",
                ];
                let titleInput = null;
                for (const selector of titleSelectors) {
                    titleInput = document.querySelector(selector);
                    if (titleInput) {
                        console.log("找到标题输入框:", selector);
                        break;
                    }
                }
                if (titleInput) {
                    titleInput.click();
                    await this.sleep(500);
                    if (titleInput.contentEditable === "true") {
                        titleInput.textContent = title;
                        titleInput.dispatchEvent(new Event("input", { bubbles: true }));
                    }
                    else {
                        const input = titleInput;
                        input.value = title;
                        input.dispatchEvent(new Event("input", { bubbles: true }));
                        input.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                    console.log("✅ 企鹅号标题已输入:", title);
                }
                else {
                    console.log("❌ 未找到任何标题输入框");
                }
            }
            async fillContent(content) {
                console.log("开始处理简介输入...");
                const textarea = document.querySelector("textarea.omui-textarea__inner");
                if (textarea) {
                    textarea.value = content || "";
                    textarea.dispatchEvent(new Event("input", { bubbles: true }));
                    textarea.dispatchEvent(new Event("change", { bubbles: true }));
                    console.log("✅ 企鹅号简介已输入:", `${content.substring(0, 50)}...`);
                }
                else {
                    console.log("❌ 未找到简介输入框");
                }
            }
            async fillTags(tags) {
                console.log("开始添加企鹅号标签...");
                // 查找标签输入框 - 在-tag容器内
                const tagContainerEl = document.getElementById("-tag");
                let tagInput = null;
                if (tagContainerEl) {
                    console.log("✅ 找到-tag容器，在其中查找标签输入框");
                    tagInput = tagContainerEl.querySelector(".omui-suggestion__value");
                    if (!tagInput) {
                        tagInput = tagContainerEl.querySelector("input.omui-suggestion__value");
                    }
                    if (!tagInput) {
                        tagInput = tagContainerEl.querySelector(".omui-suggestion__input input");
                    }
                    if (!tagInput) {
                        tagInput = tagContainerEl.querySelector('input[style*="width: 2px"]');
                    }
                }
                else {
                    console.log("⚠️ 未找到-tag容器，尝试全局查找");
                    tagInput = document.querySelector(".omui-suggestion__value");
                }
                if (tagInput) {
                    // 先点击整个标签区域确保激活
                    const tagContainer = document.querySelector(".omui-suggestion__input");
                    if (tagContainer) {
                        tagContainer.click();
                        await this.sleep(300);
                    }
                    for (const tag of tags.slice(0, 9)) {
                        console.log(`添加标签: ${tag}`);
                        tagInput.focus();
                        await this.sleep(200);
                        // 根据placeholder提示，使用空格键添加标签
                        console.log("🔧 使用空格键添加标签:", tag);
                        // 方法1: 先输入标签，然后按空格键
                        tagInput.value = tag;
                        tagInput.dispatchEvent(new Event("input", { bubbles: true }));
                        await this.sleep(200);
                        // 按空格键添加标签（根据placeholder提示）
                        const spaceEvent = new KeyboardEvent("keydown", {
                            bubbles: true,
                            cancelable: true,
                            key: " ",
                            code: "Space",
                            keyCode: 32,
                            which: 32,
                        });
                        tagInput.dispatchEvent(spaceEvent);
                        const spaceKeyUpEvent = new KeyboardEvent("keyup", {
                            bubbles: true,
                            cancelable: true,
                            key: " ",
                            code: "Space",
                            keyCode: 32,
                            which: 32,
                        });
                        tagInput.dispatchEvent(spaceKeyUpEvent);
                        await this.sleep(300);
                        // 方法2: 如果空格键不行，尝试Enter键
                        const enterEvent = new KeyboardEvent("keydown", {
                            bubbles: true,
                            cancelable: true,
                            key: "Enter",
                            code: "Enter",
                            keyCode: 13,
                            which: 13,
                        });
                        tagInput.dispatchEvent(enterEvent);
                        await this.sleep(200);
                        // 方法3: 点击建议选项
                        const suggestionOptions = document.querySelectorAll(".omui-suggestion__option");
                        for (const option of suggestionOptions) {
                            if (option.textContent?.trim() === tag && !option.classList.contains("disabled")) {
                                console.log("✅ 找到匹配的标签建议选项，点击添加");
                                option.click();
                                await this.sleep(500);
                                break;
                            }
                        }
                        // 方法4: 检查是否有已创建的标签
                        const addedTags = document.querySelectorAll('.omui-tag, .omui-suggestion__tag, [class*="tag"], .omui-suggestion__value-wrap .tag');
                        console.log(`📋 当前已添加的标签数量: ${addedTags.length}`);
                        // 如果还是没有添加，尝试直接在value中添加空格
                        if (addedTags.length === 0) {
                            console.log("🔄 尝试直接在输入值中添加空格");
                            tagInput.value = `${tag} `;
                            tagInput.dispatchEvent(new Event("input", { bubbles: true }));
                            await this.sleep(200);
                        }
                        tagInput.value = "";
                        tagInput.dispatchEvent(new Event("input", { bubbles: true }));
                        await this.sleep(100);
                    }
                    console.log("✅ 企鹅号标签已添加");
                }
                else {
                    console.log("❌ 未找到标签输入框");
                }
            }
            async attemptAutoPublish() {
                const publishButton = document.querySelector('button[class*="publish"], button[class*="submit"]');
                if (publishButton) {
                    console.log("点击企鹅号发布按钮");
                    publishButton.click();
                }
                else {
                    console.log("❌ 未找到发布按钮");
                }
            }
            async waitForVideoUpload(timeout = 300000) {
                return new Promise((resolve, reject) => {
                    let currentUrl = window.location.href;
                    let uploadCompleted = false;
                    const checkInterval = setInterval(() => {
                        if (window.location.href !== currentUrl) {
                            console.log("🔄 检测到页面跳转，从", currentUrl, "跳转到", window.location.href);
                            currentUrl = window.location.href;
                        }
                        // 检查是否有标题输入框出现（表示进入编辑页面）
                        const titleInput = document.querySelector(".omui-inputautogrowing.omui-articletitle__input");
                        if (titleInput && !uploadCompleted) {
                            uploadCompleted = true;
                            clearInterval(checkInterval);
                            console.log("✅ 企鹅号视频上传完成，已进入编辑页面");
                            setTimeout(() => {
                                resolve();
                            }, 3000);
                        }
                    }, 2000);
                    setTimeout(() => {
                        clearInterval(checkInterval);
                        if (!uploadCompleted) {
                            reject(new Error("企鹅号视频上传超时"));
                        }
                    }, timeout);
                });
            }
            async clickCoverUploadButton() {
                try {
                    console.log("🔍 查找封面上传按钮...");
                    // 首先查找 id 为 -poster 的元素
                    const posterContainer = document.querySelector("#-poster");
                    if (!posterContainer) {
                        console.log("❌ 未找到 # -poster 容器");
                        return false;
                    }
                    console.log("✅ 找到 # -poster 容器");
                    // 在该容器内查找 omui-button omui-button--add 按钮
                    const uploadButton = posterContainer.querySelector(".omui-button.omui-button--add");
                    if (!uploadButton) {
                        console.log("❌ 在 # -poster 容器内未找到上传按钮");
                        // 打印容器内的元素用于调试
                        const buttons = posterContainer.querySelectorAll("button");
                        console.log(`📋 容器内找到 ${buttons.length} 个按钮:`);
                        buttons.forEach((button, index) => {
                            console.log(`按钮 ${index + 1}:`, {
                                className: button.className,
                                textContent: button.textContent?.trim(),
                                id: button.id,
                            });
                        });
                        return false;
                    }
                    console.log("✅ 找到封面上传按钮，准备点击...");
                    // 点击按钮
                    this.simulateClick(uploadButton);
                    await this.sleep(500);
                    console.log("✅ 封面上传按钮点击完成");
                    return true;
                }
                catch (error) {
                    console.error("❌ 点击封面上传按钮时出错:", error);
                    return false;
                }
            }
            async uploadCover(coverUrl) {
                console.log("🖼️ 开始上传封面图片...");
                try {
                    // 首先点击封面上传按钮触发弹框
                    const uploadButtonClicked = await this.clickCoverUploadButton();
                    if (!uploadButtonClicked) {
                        console.log("⚠️ 无法点击封面上传按钮，尝试其他方式");
                        return true;
                    }
                    // 等待弹框出现
                    console.log("⏳ 等待封面上传弹框出现...");
                    await this.sleep(1500);
                    // 切换到本地上传模式并上传
                    return await this.switchToLocalUpload(coverUrl);
                }
                catch (error) {
                    console.error("❌ 封面上传过程出错:", error);
                    return true; // 出错也不阻断流程
                }
            }
            async switchToLocalUpload(coverUrl) {
                console.log("🔄 处理封面上传弹框，切换到本地上传模式...");
                // 等待弹框完全出现
                await this.sleep(1000);
                // 查找弹框中的选项卡
                let localUploadTab = null;
                // 查找所有弹框中的选项卡
                const dialogTabs = document.querySelectorAll(".omui-dialog .omui-tab__label, .omui-dialog-wrapper .omui-tab__label");
                console.log(`📋 在弹框中找到 ${dialogTabs.length} 个选项卡`);
                // 打印所有找到的选项卡信息用于调试
                dialogTabs.forEach((tab, index) => {
                    console.log(`弹框选项卡 ${index + 1}: "${tab.textContent?.trim()}"`, {
                        isActive: tab.classList.contains("is--active"),
                        className: tab.className,
                    });
                });
                // 更精确地查找封面选择弹框中的本地上传选项卡
                console.log("🔍 查找封面选择弹框中的本地上传选项卡...");
                // 方式1：查找包含"封面截取"和"本地上传"的选项卡组
                const allTabNavs = document.querySelectorAll(".omui-tab__nav");
                let _foundCorrectGroup = false;
                console.log(`📋 找到 ${allTabNavs.length} 个选项卡导航组`);
                for (let i = 0; i < allTabNavs.length; i++) {
                    const nav = allTabNavs[i];
                    const labels = nav.querySelectorAll(".omui-tab__label");
                    console.log(`检查第 ${i + 1} 个选项卡组，包含 ${labels.length} 个选项卡:`);
                    // 打印这个组的所有选项卡
                    labels.forEach((tab, index) => {
                        console.log(`  - 选项卡 ${index + 1}: "${tab.textContent?.trim()}"`);
                    });
                    // 检查是否包含4个选项卡且有"封面截取"和"本地上传"
                    if (labels.length === 4) {
                        const firstTab = labels[0].textContent?.trim();
                        const secondTab = labels[1].textContent?.trim();
                        if (firstTab === "封面截取" && secondTab === "本地上传") {
                            localUploadTab = labels[1]; // 第二个选项卡
                            _foundCorrectGroup = true;
                            console.log("✅ 找到正确的封面选择选项卡组，本地上传是第2个选项卡");
                            break;
                        }
                    }
                }
                // 如果方式1没找到，使用方式2：在打开的弹框中查找
                if (!localUploadTab) {
                    console.log("⚠️ 方式1未找到，尝试在打开的弹框中查找...");
                    const openDialogTabs = document.querySelectorAll(".omui-dialog-wrapper.open .omui-tab__nav .omui-tab__label");
                    console.log(`📋 在打开的弹框中找到 ${openDialogTabs.length} 个选项卡`);
                    openDialogTabs.forEach((tab, index) => {
                        console.log(`弹框选项卡 ${index + 1}: "${tab.textContent?.trim()}"`);
                    });
                    // 查找第二个选项卡（本地上传）
                    if (openDialogTabs.length >= 2) {
                        const secondTab = openDialogTabs[1];
                        if (secondTab.textContent?.includes("本地上传")) {
                            localUploadTab = secondTab;
                            console.log("✅ 在打开弹框中找到本地上传选项卡（第2个）");
                        }
                    }
                    // 如果还是没找到，遍历所有选项卡查找
                    if (!localUploadTab) {
                        for (let i = 0; i < openDialogTabs.length; i++) {
                            const tab = openDialogTabs[i];
                            if (tab.textContent?.includes("本地上传")) {
                                localUploadTab = tab;
                                console.log(`✅ 遍历找到本地上传选项卡（第${i + 1}个）`);
                                break;
                            }
                        }
                    }
                }
                if (!localUploadTab) {
                    console.log("❌ 未找到本地上传选项卡");
                    return true;
                }
                // 点击本地上传选项卡
                console.log("🎯 点击本地上传选项卡...");
                this.simulateClick(localUploadTab);
                await this.sleep(1000);
                // 获取同一个选项卡组中的所有选项卡，用于设置激活状态
                const parentNav = localUploadTab.closest(".omui-tab__nav");
                if (parentNav) {
                    const siblingTabs = parentNav.querySelectorAll(".omui-tab__label");
                    // 强制设置为激活状态，同时移除其他选项卡的激活状态
                    siblingTabs.forEach((tab, _index) => {
                        if (tab === localUploadTab) {
                            tab.classList.add("is--active", "is--selected");
                            console.log(`✅ 激活选项卡: "${tab.textContent?.trim()}"`);
                        }
                        else {
                            tab.classList.remove("is--active", "is--selected");
                        }
                    });
                }
                else {
                    // 备用方案：直接设置单个选项卡的激活状态
                    localUploadTab.classList.add("is--active", "is--selected");
                    console.log(`✅ 激活选项卡: "${localUploadTab.textContent?.trim()}"`);
                }
                await this.sleep(500);
                if (localUploadTab.classList.contains("is--active")) {
                    console.log("✅ 成功切换到本地上传选项卡");
                }
                else {
                    console.log("⚠️ 选项卡状态可能未正确更新，但继续执行");
                }
                // 等待本地上传面板加载完成
                console.log("⏳ 等待本地上传面板加载...");
                await this.sleep(1500);
                // 查找文件输入框 - 专门查找图片输入框，排除视频输入框
                console.log("🔍 开始专门查找图片上传输入框...");
                // 首先收集所有可能的文件输入框
                const allFileInputs = document.querySelectorAll('input[type="file"]');
                console.log(`📋 页面总共有 ${allFileInputs.length} 个文件输入框`);
                let fileInput = null;
                let selectorUsed = "";
                // 详细检查每个文件输入框
                for (let i = 0; i < allFileInputs.length; i++) {
                    const input = allFileInputs[i];
                    const accept = input.accept?.toLowerCase() || "";
                    console.log(`🔍 检查输入框 ${i + 1}:`, {
                        accept: input.accept,
                        type: input.type,
                        hidden: input.hasAttribute("hidden"),
                        style: input.style.display,
                        offsetParent: !!input.offsetParent,
                        className: input.className,
                        name: input.name,
                    });
                    // 严格排除视频输入框
                    if (accept.includes("video")) {
                        console.log(`❌ 跳过视频输入框 ${i + 1}: accept="${input.accept}"`);
                        continue;
                    }
                    // 优先选择明确接受图片的输入框
                    if (accept.includes("image")) {
                        fileInput = input;
                        selectorUsed = `图片专用输入框 #${i + 1}`;
                        console.log(`✅ 找到图片专用输入框 ${i + 1}: accept="${input.accept}"`);
                        break;
                    }
                    // 其次选择没有accept限制的输入框（可能支持多种格式）
                    if (!accept && !fileInput) {
                        fileInput = input;
                        selectorUsed = `通用输入框 #${i + 1}`;
                        console.log(`📌 备用选择通用输入框 ${i + 1}: 无accept限制`);
                    }
                }
                // 如果还没找到，在弹框中再次精确查找
                if (!fileInput) {
                    console.log("⚠️ 在所有输入框中未找到合适的，尝试在弹框中精确查找...");
                    const dialogInputs = document.querySelectorAll('.omui-dialog input[type="file"], .omui-dialog-wrapper input[type="file"]');
                    for (let i = 0; i < dialogInputs.length; i++) {
                        const input = dialogInputs[i];
                        const accept = input.accept?.toLowerCase() || "";
                        // 严格排除视频输入框
                        if (accept.includes("video")) {
                            console.log(`❌ 跳过弹框中的视频输入框 ${i + 1}: accept="${input.accept}"`);
                            continue;
                        }
                        // 优先选择图片输入框
                        if (accept.includes("image")) {
                            fileInput = input;
                            selectorUsed = `弹框图片输入框 #${i + 1}`;
                            console.log(`✅ 找到弹框图片输入框 ${i + 1}: accept="${input.accept}"`);
                            break;
                        }
                        // 备用选择无限制的弹框输入框
                        if (!accept && !fileInput) {
                            fileInput = input;
                            selectorUsed = `弹框通用输入框 #${i + 1}`;
                            console.log(`📌 备用选择弹框通用输入框 ${i + 1}`);
                        }
                    }
                }
                // 不管输入框是否隐藏，只要有就使用
                if (!fileInput) {
                    console.log("❌ 完全未找到合适的图片输入框，无法上传封面");
                    return true;
                }
                // 显示找到的输入框信息
                console.log(`🎯 最终使用的文件输入框: ${selectorUsed}`, {
                    accept: fileInput.accept,
                    type: fileInput.type,
                    hidden: fileInput.hasAttribute("hidden"),
                    style: fileInput.style.display,
                    offsetParent: !!fileInput.offsetParent,
                    className: fileInput.className,
                    name: fileInput.name,
                });
                // 如果找到的输入框没有明确接受图片，添加图片支持
                if (!fileInput.accept || (!fileInput.accept.includes("image") && !fileInput.accept.includes("video"))) {
                    console.log("🔧 设置输入框accept属性支持图片...");
                    fileInput.setAttribute("accept", "image/*");
                }
                // 先点击上传按钮以确保文件输入框被激活
                console.log("🖱️ 点击上传按钮以确保文件输入框激活...");
                // 通过"上传图片"文本找到对应的标题，然后找到同级的按钮
                const uploadTitle = Array.from(document.querySelectorAll("h4")).find((h4) => h4.textContent?.includes("上传图片"));
                const uploadButton = uploadTitle?.parentElement?.querySelector("button");
                if (uploadButton) {
                    this.simulateClick(uploadButton);
                    await this.sleep(500);
                }
                else {
                    console.log("⚠️ 未找到上传按钮，直接尝试文件上传");
                }
                // 获取图片数据并上传
                console.log("🖼️ 获取封面图片数据...");
                return await this.performCoverUpload(fileInput, coverUrl);
            }
            async performCoverUpload(fileInput, coverUrl) {
                try {
                    const response = await fetch(coverUrl);
                    const blob = await response.blob();
                    const fileName = `cover_${Date.now()}.${blob.type.split("/")[1] || "jpg"}`;
                    const coverFile = new File([blob], fileName, { type: blob.type });
                    console.log("📄 封面文件信息:", {
                        name: coverFile.name,
                        type: coverFile.type,
                        size: coverFile.size,
                    });
                    // 验证文件类型是否为图片
                    if (!coverFile.type.startsWith("image/")) {
                        console.log("⚠️ 文件类型不是图片:", coverFile.type);
                    }
                    // 创建DataTransfer并添加文件
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(coverFile);
                    fileInput.files = dataTransfer.files;
                    // 触发多个事件确保上传
                    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
                    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
                    fileInput.dispatchEvent(new Event("change", { bubbles: true })); // 再次触发
                    console.log("✅ 封面上传事件已触发");
                    await this.sleep(3000);
                    // 检查是否有下一步按钮需要点击
                    console.log("🔍 查找下一步按钮...");
                    let nextButton = null;
                    // 方式1：在封面上传容器内查找"下一步"按钮
                    if (fileInput) {
                        const uploadContainer = fileInput.closest(".omui-tab__panel-inner");
                        if (uploadContainer) {
                            const buttons = uploadContainer.querySelectorAll("button");
                            for (const button of buttons) {
                                if (button.textContent?.trim() === "下一步") {
                                    nextButton = button;
                                    console.log('✅ 在上传容器内找到"下一步"按钮');
                                    break;
                                }
                            }
                        }
                    }
                    // 方式2：如果容器内没找到，查找带有omui-button--primary类的"下一步"按钮
                    if (!nextButton) {
                        const buttons = document.querySelectorAll("button.omui-button--primary");
                        for (const button of buttons) {
                            if (button.textContent?.trim() === "下一步") {
                                nextButton = button;
                                console.log('✅ 找到primary样式的"下一步"按钮');
                                break;
                            }
                        }
                    }
                    // 方式3：最后fallback，查找任何"下一步"按钮
                    if (!nextButton) {
                        const buttons = document.querySelectorAll("button");
                        for (const button of buttons) {
                            if (button.textContent?.trim() === "下一步") {
                                nextButton = button;
                                console.log('✅ 找到任意"下一步"按钮');
                                break;
                            }
                        }
                    }
                    if (nextButton) {
                        console.log("➡️ 点击下一步/完成按钮...");
                        this.simulateClick(nextButton);
                        // 等待更长时间让页面完全加载
                        await this.sleep(3000);
                        // 检查是否还有其他需要处理的步骤
                        console.log("🔍 检查是否还有后续步骤...");
                        const hasMoreSteps = await this.checkAndHandleNextSteps();
                        if (!hasMoreSteps) {
                            console.log("✅ 没有发现更多需要处理的步骤");
                        }
                    }
                    console.log("✅ 封面上传完成");
                    return true;
                }
                catch (error) {
                    console.error("❌ 执行封面上传时出错:", error);
                    return true;
                }
            }
            /**
             * 处理预览选项 - 依次点击预览选项中的 radio
             */
            async handlePreviewOptions() {
                try {
                    console.log("🔍 查找预览选项...");
                    // 等待页面完全加载
                    await this.sleep(1000);
                    // 首先在主DOM中查找
                    const previewOptions = Array.from(document.querySelectorAll('.preview__option-item input[type="radio"]'));
                    // 如果主DOM中没找到，搜索Shadow DOM
                    if (previewOptions.length === 0) {
                        console.log("🌐 主DOM中未找到预览选项，开始搜索Shadow DOM...");
                        // 查找所有可能包含Shadow DOM的元素
                        const shadowHosts = Array.from(document.querySelectorAll("*")).filter((el) => el.shadowRoot);
                        shadowHosts.forEach((host, index) => {
                            const shadowOptions = host.shadowRoot.querySelectorAll('.preview__option-item input[type="radio"]');
                            if (shadowOptions.length > 0) {
                                console.log(`📱 Shadow DOM ${index} 中找到 ${shadowOptions.length} 个预览选项`);
                                previewOptions.push(...Array.from(shadowOptions));
                            }
                        });
                    }
                    if (previewOptions.length === 0) {
                        console.log("⚠️ 未找到预览选项中的 radio 元素");
                        return false;
                    }
                    console.log(`📋 找到 ${previewOptions.length} 个预览选项 radio`);
                    // 依次点击每个 radio
                    for (let i = 0; i < previewOptions.length; i++) {
                        const radio = previewOptions[i];
                        console.log(`🎯 处理第 ${i + 1} 个预览选项 radio，当前状态: ${radio.checked ? "已选中" : "未选中"}`);
                        // 如果未选中，则点击
                        if (!radio.checked) {
                            radio.click();
                            await this.sleep(300);
                            console.log(`✅ 已点击第 ${i + 1} 个选项，新状态: ${radio.checked ? "已选中" : "未选中"}`);
                        }
                    }
                    console.log("✅ 所有预览选项处理完成");
                    // 点击"完成"按钮
                    console.log('🔍 查找并点击"完成"按钮...');
                    let completeButtonClicked = false;
                    // 1. 首先在主DOM中查找
                    const buttons = document.querySelectorAll("button");
                    for (const button of buttons) {
                        if (button.textContent?.trim() === "完成") {
                            console.log('✅ 在主DOM中找到"完成"按钮，点击...');
                            this.simulateClick(button);
                            await this.sleep(1000);
                            console.log("✅ 已点击完成按钮");
                            completeButtonClicked = true;
                            break;
                        }
                    }
                    // 2. 如果主DOM中没找到，搜索Shadow DOM
                    if (!completeButtonClicked) {
                        console.log('🌐 主DOM中未找到"完成"按钮，搜索Shadow DOM...');
                        const shadowHosts = Array.from(document.querySelectorAll("*")).filter((el) => el.shadowRoot);
                        for (const host of shadowHosts) {
                            const shadowButtons = host.shadowRoot.querySelectorAll("button");
                            for (const button of shadowButtons) {
                                if (button.textContent?.trim() === "完成") {
                                    console.log('✅ 在Shadow DOM中找到"完成"按钮，点击...');
                                    this.simulateClick(button);
                                    await this.sleep(1000);
                                    console.log("✅ 已点击Shadow DOM中的完成按钮");
                                    completeButtonClicked = true;
                                    break;
                                }
                            }
                            if (completeButtonClicked)
                                break;
                        }
                    }
                    if (!completeButtonClicked) {
                        console.log('⚠️ 未找到"完成"按钮');
                    }
                    return true;
                }
                catch (error) {
                    console.error("❌ 处理预览选项时出错:", error);
                    return false;
                }
            }
            /**
             * 检查并处理后续步骤（预览选项、最终确认等）
             */
            async checkAndHandleNextSteps() {
                try {
                    // 0. 首先处理指定复选框
                    console.log("🔍 查找并勾选指定复选框...");
                    const userOriginalContainer = document.getElementById("-user_original");
                    if (userOriginalContainer) {
                        const targetCheckbox = userOriginalContainer.querySelector('input[type="checkbox"].omui-checkbox__input[value="1"]');
                        if (targetCheckbox && !targetCheckbox.checked) {
                            console.log("✅ 在-user_original容器中找到目标复选框，执行勾选...");
                            targetCheckbox.click();
                            await this.sleep(300);
                            console.log("✅ 已勾选指定复选框");
                        }
                        else if (targetCheckbox?.checked) {
                            console.log("✅ 目标复选框已勾选");
                        }
                        else {
                            console.log("⚠️ 在-user_original容器中未找到目标复选框");
                        }
                    }
                    else {
                        console.log("⚠️ 未找到-user_original容器");
                    }
                    // 1. 首先尝试处理预览选项
                    const previewHandled = await this.handlePreviewOptions();
                    if (previewHandled) {
                        return true;
                    }
                    // 2. 查找是否有"完成"或"确认"按钮需要点击
                    const confirmButtons = [
                        { text: "完成", selector: "button" },
                        { text: "确认", selector: "button" },
                        { text: "保存", selector: "button" },
                        { text: "提交", selector: "button" },
                    ];
                    for (const buttonConfig of confirmButtons) {
                        const buttons = document.querySelectorAll(buttonConfig.selector);
                        for (const button of buttons) {
                            if (button.textContent?.trim() === buttonConfig.text && button.offsetParent !== null) {
                                // 确保按钮是可见的
                                console.log(`✅ 找到 "${buttonConfig.text}" 按钮，准备点击...`);
                                this.simulateClick(button);
                                await this.sleep(1000);
                                return true;
                            }
                        }
                    }
                    // 3. 检查是否有其他可能的交互元素
                    const interactiveElements = document.querySelectorAll('input[type="radio"], input[type="checkbox"], .omui-suggestion__option');
                    let foundInteractions = false;
                    for (const element of interactiveElements) {
                        // 对于建议选项，只点击未禁用的
                        if (element.classList.contains("omui-suggestion__option") && element.classList.contains("disabled")) {
                            continue;
                        }
                        if (element.offsetParent !== null) {
                            // 确保元素是可见的
                            console.log(`🎯 找到可交互元素: ${element.tagName}.${element.className}`);
                            element.click();
                            await this.sleep(300);
                            foundInteractions = true;
                        }
                    }
                    if (foundInteractions) {
                        return true;
                    }
                    // 4. 最后检查页面状态
                    console.log("🔍 检查页面当前状态...");
                    const pageTitle = document.title;
                    const url = window.location.href;
                    console.log(`当前页面: ${pageTitle} - ${url}`);
                    return foundInteractions;
                }
                catch (error) {
                    console.error("❌ 检查后续步骤时出错:", error);
                    return false;
                }
            }
        }
        const uploader = new QiEVideoUploader();
        console.log("✅ QiEVideoUploader实例创建成功");
        const result = await uploader.process(data);
        console.log("🎉 QiE视频上传处理完成");
        return result;
    }
    catch (error) {
        console.error("❌ QiE视频上传过程中出现错误:", error);
        throw error;
    }
}

export async function VideoRednote(data) {
    const { content, video, title, tags, cover, scheduledPublishTime } = data.data;
    // 辅助函数：等待元素出现
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
            }, timeout);
        });
    }
    // 辅助函数：上传文件
    async function uploadVideo() {
        const fileInput = (await waitForElement('input[type="file"]'));
        if (!fileInput) {
            console.error("未找到文件输入元素");
            return;
        }
        const dataTransfer = new DataTransfer();
        if (video) {
            try {
                const response = await fetch(video.url);
                if (!response.ok) {
                    throw new Error(`HTTP 错误! 状态: ${response.status}`);
                }
                const blob = await response.blob();
                const file = new File([blob], video.name, { type: video.type });
                dataTransfer.items.add(file);
            }
            catch (error) {
                console.error(`上传视频 ${video.url} 失败:`, error);
            }
        }
        if (dataTransfer.files.length > 0) {
            fileInput.files = dataTransfer.files;
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
            fileInput.dispatchEvent(new Event("input", { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 2000)); // 等待文件处理
            console.log("文件上传操作完成");
        }
        else {
            console.error("没有成功添加任何文件");
        }
    }
    /**
     * 设置定时发布时间
     * @param scheduledPublishTime - 定时发布时间戳（毫秒）
     */
    async function setScheduledPublishTime(scheduledPublishTime) {
        const labels = document.querySelectorAll("label");
        console.debug("labels -->", labels);
        const scheduledLabel = Array.from(labels).find((label) => label.textContent?.includes("定时发布"));
        console.debug("label -->", scheduledLabel);
        if (scheduledLabel) {
            scheduledLabel.click();
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        const publishTimeInput = document.querySelector('input[placeholder="选择日期和时间"]');
        console.debug("publishTimeInput -->", publishTimeInput);
        if (publishTimeInput) {
            // 计算时间：添加 8 小时（28800000 毫秒）以调整时区
            const adjustedTime = new Date(scheduledPublishTime + 28800000);
            const formattedTime = adjustedTime.toISOString().slice(0, 16).replace("T", " ");
            publishTimeInput.focus();
            await new Promise((resolve) => setTimeout(resolve, 100));
            publishTimeInput.value = formattedTime;
            publishTimeInput.dispatchEvent(new Event("input", { bubbles: true }));
            publishTimeInput.dispatchEvent(new Event("change", { bubbles: true }));
            publishTimeInput.blur();
            console.debug("定时发布时间已设置:", formattedTime);
        }
    }
    // 辅助函数：上传封面
    async function uploadCover(coverFile) {
        console.debug("tryCover", coverFile);
        const coverUploadTrigger = document.querySelector("div.noCover.uploadCover");
        console.debug("coverUpload", coverUploadTrigger);
        if (!coverUploadTrigger) {
            console.error("未找到封面上传触发器: div.noCover.uploadCover");
            return;
        }
        coverUploadTrigger.click();
        const fileInputSelector = "input[accept='image/png, image/jpeg, image/*']";
        try {
            await waitForElement(fileInputSelector);
        }
        catch (e) {
            console.error(`等待元素 ${fileInputSelector} 超时`, e);
            return;
        }
        const fileInput = document.querySelector(fileInputSelector);
        console.debug("fileInput", fileInput);
        if (!fileInput) {
            console.error("未找到封面上传的文件输入元素");
            return;
        }
        const dataTransfer = new DataTransfer();
        console.debug("try upload file", coverFile);
        if (!coverFile.type.includes("image/")) {
            console.error("提供的封面文件不是图片");
            return;
        }
        try {
            const response = await fetch(coverFile.url);
            const arrayBuffer = await response.arrayBuffer();
            const file = new File([arrayBuffer], coverFile.name, { type: coverFile.type });
            dataTransfer.items.add(file);
        }
        catch (error) {
            console.error(`上传封面 ${coverFile.url} 失败:`, error);
            return;
        }
        if (dataTransfer.files.length === 0) {
            return;
        }
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        fileInput.dispatchEvent(new Event("input", { bubbles: true }));
        console.debug("文件上传操作触发");
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const doneButtons = document.querySelectorAll("span");
        console.debug("doneButtons", doneButtons);
        const doneButton = Array.from(doneButtons).find((btn) => btn.textContent?.trim() === "确定");
        console.debug("doneButton", doneButton);
        if (doneButton) {
            doneButton.click();
        }
    }
    // 等待页面加载
    await waitForElement('span[class="title"]');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // 上传视频
    await uploadVideo();
    // 填写内容
    // 等待标题输入框出现
    await waitForElement('input[type="text"]');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // 填写标题
    const titleInput = document.querySelector('input[type="text"]');
    if (titleInput) {
        const finalTitle = title?.slice(0, 20) || "";
        titleInput.value = finalTitle;
        titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    // 填写内容和标签
    const editor = document.querySelector('div[contenteditable="true"]');
    if (!editor) {
        console.error("未找到编辑器元素");
        return;
    }
    // 填写正文内容
    editor.focus();
    const contentPasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
    });
    contentPasteEvent.clipboardData.setData("text/plain", `${content}\n` || "");
    editor.dispatchEvent(contentPasteEvent);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    editor.blur();
    // 添加标签
    if (tags && tags.length > 0) {
        for (const tag of tags) {
            editor.focus();
            const tagPasteEvent = new ClipboardEvent("paste", {
                bubbles: true,
                cancelable: true,
                clipboardData: new DataTransfer(),
            });
            tagPasteEvent.clipboardData.setData("text/plain", `#${tag}`);
            editor.dispatchEvent(tagPasteEvent);
            await new Promise((resolve) => setTimeout(resolve, 2000));
            // 模拟回车键按下以确认标签
            const enterEvent = new KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                key: "Enter",
                code: "Enter",
                keyCode: 13,
                which: 13,
            });
            editor.dispatchEvent(enterEvent);
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
    // 上传封面
    if (cover) {
        await uploadCover(cover);
    }
    // 处理定时发布
    if (scheduledPublishTime) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await setScheduledPublishTime(scheduledPublishTime);
    }
    if (data.isAutoPublish === true) {
        // 轮询期间重新查询按钮，避免页面重渲染后持有失效节点；视频处理较慢，最多约 60s
        const findPublishButton = () => Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("发布"));
        let publishButton = findPublishButton();
        for (let i = 0; i < 60; i++) {
            publishButton = findPublishButton();
            if (publishButton && publishButton.getAttribute("aria-disabled") !== "true")
                break;
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (publishButton && publishButton.getAttribute("aria-disabled") !== "true") {
            publishButton.dispatchEvent(new Event("click", { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 10000));
            window.location.href = "https://creator.xiaohongshu.com/new/note-manager";
        }
        else {
            console.debug("小红书：发布按钮仍不可用，跳过自动发布");
        }
    }
}

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 搜狐号视频发布器
 */
export async function VideoSohu(data) {
    console.log("🚀 开始搜狐号视频发布流程...");
    console.log("🔍 当前页面:", window.location.href);
    try {
        // 检查是否在搜狐号页面
        if (!window.location.href.includes("mp.sohu.com")) {
            console.error("❌ 不在搜狐号页面，当前页面:", window.location.href);
            return;
        }
        // 解析视频数据
        if (!data || !data.data) {
            console.error("❌ 缺少视频数据");
            return;
        }
        const { content, video, title, description } = data.data;
        console.log("📝 视频数据:", {
            title: title?.substring(0, 50),
            contentLength: content?.length,
            hasVideo: !!video,
        });
        // 内联定义搜狐号视频上传器类
        const SohuVideoUploader = class SohuVideoUploader {
            /**
             * 等待指定时间
             */
            sleep(ms) {
                return new Promise((resolve) => setTimeout(resolve, ms));
            }
            /**
             * 等待元素出现
             */
            async waitForElement(selector, timeout = 10000) {
                return new Promise((resolve, reject) => {
                    const element = document.querySelector(selector);
                    if (element) {
                        resolve(element);
                        return;
                    }
                    const observer = new MutationObserver(() => {
                        const element = document.querySelector(selector);
                        if (element) {
                            resolve(element);
                            observer.disconnect();
                        }
                    });
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true,
                    });
                    setTimeout(() => {
                        observer.disconnect();
                        reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
                    }, timeout);
                });
            }
            /**
             * 填写标题
             */
            async fillTitle(title) {
                try {
                    console.log("📝 填写标题:", title);
                    // 等待页面加载
                    await this.sleep(3000);
                    // 搜狐号标题输入框选择器
                    const titleSelectors = [
                        'input[placeholder*="标题"]',
                        'input[placeholder*="title"]',
                        'input[name*="title"]',
                        'input[class*="title"]',
                        'input[type="text"]',
                        '.ant-input[type="text"]',
                        ".ant-input",
                        "#title",
                        'textarea[placeholder*="标题"]',
                        '.form-input[type="text"]',
                        '.el-input__inner[type="text"]',
                    ];
                    for (const selector of titleSelectors) {
                        const titleElement = document.querySelector(selector);
                        if (titleElement && titleElement.offsetParent !== null) {
                            console.log("✅ 找到标题输入框:", selector);
                            try {
                                // 清空原有内容
                                titleElement.focus();
                                titleElement.select();
                                // 逐字符输入模拟真实用户行为
                                for (let i = 0; i < title.length; i++) {
                                    const _char = title[i];
                                    titleElement.value = title.substring(0, i + 1);
                                    // 触发输入事件
                                    titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                    await this.sleep(50);
                                }
                                // 触发多种事件确保框架识别
                                titleElement.dispatchEvent(new Event("focus", { bubbles: true }));
                                titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                titleElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                titleElement.dispatchEvent(new Event("blur", { bubbles: true }));
                                // 验证设置是否成功
                                console.log(`✅ 标题设置后验证: value="${titleElement.value}"`);
                                if (titleElement.value === title) {
                                    console.log("✅ 标题填写成功");
                                    return;
                                }
                            }
                            catch (e) {
                                console.error("设置标题值时出错:", e);
                            }
                        }
                    }
                    console.log("❌ 未找到可用的标题输入框");
                    return;
                }
                catch (error) {
                    console.error("填写标题失败:", error);
                    return;
                }
            }
            /**
             * 填写描述
             */
            async fillDescription(description) {
                try {
                    console.log("📝 填写描述:", `${description.substring(0, 100)}...`);
                    // 搜狐号描述输入框选择器
                    const descSelectors = [
                        'textarea[placeholder*="描述"]',
                        'textarea[placeholder*="简介"]',
                        'textarea[placeholder*="内容"]',
                        'textarea[name*="content"]',
                        'textarea[name*="desc"]',
                        "textarea",
                        ".ant-input",
                        "#content",
                        "#description",
                        ".form-textarea",
                        ".el-textarea__inner",
                    ];
                    for (const selector of descSelectors) {
                        const descElement = document.querySelector(selector);
                        if (descElement && descElement.offsetParent !== null) {
                            console.log("✅ 找到描述输入框:", selector);
                            try {
                                descElement.focus();
                                descElement.value = description;
                                // 触发多种事件
                                descElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                descElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                console.log("✅ 描述填写成功");
                                return;
                            }
                            catch (e) {
                                console.error("设置描述值时出错:", e);
                            }
                        }
                    }
                    console.log("❌ 未找到可用的描述输入框");
                    return;
                }
                catch (error) {
                    console.error("填写描述失败:", error);
                    return;
                }
            }
            /**
             * 上传视频文件
             */
            async uploadVideo(videoData) {
                try {
                    console.log("📹 开始上传视频...");
                    // 获取视频文件
                    let file;
                    if (videoData.videoFile) {
                        file = videoData.videoFile;
                    }
                    else if (videoData.url) {
                        const response = await fetch(videoData.url);
                        const arrayBuffer = await response.arrayBuffer();
                        const extension = videoData.name.split(".").pop() || "mp4";
                        const fileName = `${videoData.name.replace(/\.[^/.]+$/, "")}.${extension}`;
                        file = new File([arrayBuffer], fileName, { type: "video/mp4" });
                    }
                    else {
                        console.error("❌ 无效的视频数据");
                        return;
                    }
                    console.log("📁 视频文件:", file.name, file.size, file.type);
                    // 等待页面完全加载
                    console.log("⏳ 等待页面加载完成...");
                    await this.sleep(5000);
                    // 查找上传区域
                    console.log("🔍 查找搜狐号上传区域...");
                    const uploadSelectors = [
                        ".upload-area",
                        ".video-upload",
                        '[class*="upload"]',
                        '[class*="video"]',
                        ".ant-upload",
                        "#upload",
                        ".upload-btn",
                        'button[class*="upload"]',
                        ".upload-container",
                        ".el-upload",
                        ".el-upload-dragger",
                    ];
                    let uploadArea = null;
                    for (const selector of uploadSelectors) {
                        const element = document.querySelector(selector);
                        if (element && element.offsetParent !== null) {
                            console.log(`✅ 找到上传区域: ${selector}`);
                            uploadArea = element;
                            break;
                        }
                    }
                    if (!uploadArea) {
                        console.log("❌ 未找到上传区域，尝试查找文件输入框...");
                        // 直接查找文件输入框
                        const fileInputs = document.querySelectorAll('input[type="file"]');
                        console.log(`🔍 找到 ${fileInputs.length} 个文件输入框`);
                        let targetInput = null;
                        fileInputs.forEach((input, index) => {
                            const accept = input.getAttribute("accept") || "";
                            console.log(`  输入框 ${index + 1}: accept="${accept}"`);
                            // 优先查找视频文件输入框
                            if (accept.includes("video") || accept.includes("*") || accept === "") {
                                targetInput = input;
                                console.log(`✅ 选择输入框 ${index + 1} 作为目标`);
                            }
                        });
                        if (targetInput) {
                            // 使用DataTransfer API设置文件
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            targetInput.files = dataTransfer.files;
                            // 触发change事件
                            targetInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 文件已设置到输入框");
                            return;
                        }
                        console.log("❌ 未找到合适的文件输入框");
                        return;
                    }
                    // 如果找到了上传区域，尝试点击或操作
                    console.log("🔄 尝试操作上传区域...");
                    // 查找上传区域内的文件输入框
                    const uploadInput = uploadArea.querySelector('input[type="file"]');
                    if (uploadInput) {
                        console.log("✅ 在上传区域内找到文件输入框");
                        // 创建透明的文件输入框覆盖上传区域
                        const overlayInput = document.createElement("input");
                        overlayInput.type = "file";
                        overlayInput.accept = "video/*,.mp4,.avi,.mov,.wmv";
                        overlayInput.style.position = "absolute";
                        overlayInput.style.opacity = "0";
                        overlayInput.style.width = "100%";
                        overlayInput.style.height = "100%";
                        overlayInput.style.top = "0";
                        overlayInput.style.left = "0";
                        overlayInput.style.zIndex = "9999";
                        overlayInput.id = `sohu_upload_${Date.now()}`;
                        // 设置上传区域样式以支持覆盖
                        const uploadElement = uploadArea;
                        uploadElement.style.position = "relative";
                        uploadElement.appendChild(overlayInput);
                        // 设置文件
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        overlayInput.files = dataTransfer.files;
                        // 触发文件选择事件
                        overlayInput.dispatchEvent(new Event("focus", { bubbles: true }));
                        overlayInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                        console.log("✅ 文件已设置到覆盖输入框");
                        // 尝试点击上传区域（如果需要）
                        if (uploadArea.tagName === "BUTTON" || uploadArea.closest("button")) {
                            console.log("🖱️ 点击上传按钮...");
                            (uploadArea.closest("button") || uploadArea).click();
                            await this.sleep(1000);
                        }
                        // 等待上传开始
                        await this.waitForUploadStart();
                        return;
                    }
                    console.log("⚠️ 上传区域内未找到文件输入框，尝试点击上传区域...");
                    // 点击上传区域触发文件选择
                    const clickableElement = uploadArea.closest("button") || uploadArea.querySelector("button") || uploadArea;
                    if (clickableElement) {
                        console.log("🖱️ 点击可点击元素...");
                        clickableElement.click();
                        await this.sleep(2000);
                        // 再次查找文件输入框
                        const newFileInput = document.querySelector('input[type="file"]');
                        if (newFileInput) {
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            newFileInput.files = dataTransfer.files;
                            newFileInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 文件已设置到新找到的输入框");
                            return;
                        }
                    }
                    console.log("⚠️ 无法直接上传文件，但页面可能已经准备好了");
                    return;
                }
                catch (error) {
                    console.error("❌ 视频上传失败:", error);
                    return;
                }
            }
            /**
             * 等待上传开始
             */
            async waitForUploadStart() {
                console.log("⏳ 等待上传开始...");
                for (let i = 0; i < 30; i++) {
                    await this.sleep(1000);
                    // 检查上传进度指示器
                    const progressSelectors = [
                        '[class*="progress"]',
                        '[class*="uploading"]',
                        '[class*="upload-progress"]',
                        ".ant-progress",
                        ".progress-bar",
                        ".uploading",
                        ".el-progress",
                    ];
                    for (const selector of progressSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log("✅ 检测到上传进度指示器");
                            return;
                        }
                    }
                    // 检查是否有上传成功标志
                    const successSelectors = ['[class*="success"]', '[class*="complete"]', '[class*="done"]', ".upload-success"];
                    for (const selector of successSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log("✅ 检测到上传成功标志");
                            return;
                        }
                    }
                }
                console.log("⚠️ 未检测到明确的上传状态，但可能已开始");
            }
        };
        console.log("✅ 搜狐号上传器类定义完成");
        const uploader = new SohuVideoUploader();
        console.log("✅ 搜狐号上传器实例创建完成");
        // 步骤1: 填写标题
        if (title) {
            console.log("📝 填写标题:", title);
            await uploader.fillTitle(title);
        }
        // 步骤2: 填写描述
        if (content) {
            console.log("📝 填写描述:", `${content.substring(0, 100)}...`);
            await uploader.fillDescription(description ?? content);
        }
        // 步骤3: 上传视频
        if (video) {
            console.log("🎥 开始上传视频...");
            await uploader.uploadVideo(video);
        }
        else {
            console.error("❌ 缺少视频文件");
            return;
        }
        console.log("🎉 搜狐号视频发布流程完成");
        return;
    }
    catch (error) {
        console.error("💥 搜狐号视频发布失败:", error);
        console.error("错误详情:", error.stack);
        return;
    }
}

/**
 * Fill the separate tv.sohu.com creator page.
 *
 * The tv.sohu.com page is a different publisher from mp.sohu.com. It accepts
 * both short video and image-text inputs from the same page, but MultiPost's
 * video target intentionally handles only the video path here.
 */
export async function VideoSohuTv(data) {
    if (!("video" in data.data))
        return;
    const videoData = data.data;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    async function waitForElement(selector, timeout = 15000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const element = document.querySelector(selector);
            if (element)
                return element;
            await sleep(250);
        }
        return null;
    }
    function setTextInput(element, value) {
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            element.value = value;
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
        }
        if (element instanceof HTMLElement && element.isContentEditable) {
            element.innerText = value;
            element.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
        }
        return false;
    }
    async function fileFromUrl(file) {
        const response = await fetch(file.url);
        if (!response.ok) {
            console.error(`搜狐视频素材读取失败：HTTP ${response.status}`);
            return null;
        }
        const blob = await response.blob();
        return new File([blob], file.name, { type: file.type || blob.type || "application/octet-stream" });
    }
    async function dispatchFile(input, file) {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        if (transfer.files.length === 0)
            return false;
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    }
    async function uploadVideo() {
        if (!videoData.video)
            return false;
        const element = await waitForElement('input[type="file"]');
        if (!(element instanceof HTMLInputElement))
            return false;
        const file = await fileFromUrl(videoData.video);
        return file ? dispatchFile(element, file) : false;
    }
    async function uploadCover() {
        const cover = videoData.horizontalCover || videoData.cover;
        if (!cover)
            return;
        const trigger = await waitForElement("p.pic-edit", 5000);
        if (!(trigger instanceof HTMLElement))
            return;
        trigger.click();
        const input = await waitForElement("input.uploadImg", 5000);
        if (!(input instanceof HTMLInputElement))
            return;
        const file = await fileFromUrl(cover);
        if (!file || !file.type.startsWith("image/"))
            return;
        if (await dispatchFile(input, file)) {
            const confirm = Array.from(document.querySelectorAll("a.btn-main")).find((element) => element.textContent?.trim() === "确认");
            if (confirm instanceof HTMLElement)
                confirm.click();
        }
    }
    try {
        if (!(await uploadVideo()))
            return;
        await sleep(1000);
        const title = await waitForElement('input[type="text"]');
        if (title)
            setTextInput(title, videoData.title || videoData.content.slice(0, 20));
        const description = await waitForElement('textarea, div[contenteditable="true"]');
        if (description)
            setTextInput(description, videoData.description || videoData.content);
        const topic = document.querySelector("input.input-topic");
        if (topic instanceof HTMLInputElement) {
            for (const tag of videoData.tags?.slice(0, 2) || []) {
                topic.value = tag;
                topic.dispatchEvent(new Event("input", { bubbles: true }));
                topic.dispatchEvent(new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    key: "Enter",
                    code: "Enter",
                    keyCode: 13,
                    which: 13,
                }));
                await sleep(500);
            }
        }
        await uploadCover();
        if (!data.isAutoPublish)
            return;
        const publishButton = Array.from(document.querySelectorAll("button")).find((element) => element.textContent?.includes("发布"));
        if (!(publishButton instanceof HTMLButtonElement))
            return;
        for (let attempt = 0; attempt < 120; attempt += 1) {
            if (publishButton.getAttribute("aria-disabled") !== "true" && !publishButton.disabled) {
                publishButton.click();
                return;
            }
            await sleep(1000);
        }
        console.error("搜狐视频发布按钮在等待后仍不可用");
    }
    catch (error) {
        console.error("搜狐视频发布失败:", error);
    }
}

export async function VideoTencentVideo(data) {
    function waitForElement(selector, timeout = 60000) {
        return new Promise((resolve, reject) => {
            const exist = document.querySelector(selector);
            if (exist) {
                resolve(exist);
                return;
            }
            let timer = 0;
            const observer = new MutationObserver(() => {
                const found = document.querySelector(selector);
                if (found) {
                    window.clearTimeout(timer);
                    observer.disconnect();
                    resolve(found);
                }
            });
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
            timer = window.setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
            }, timeout);
        });
    }
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    function isVisible(element) {
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    }
    function getVisibleCoverUploadRoots() {
        const roots = Array.from(document.querySelectorAll('[role="dialog"], div[class*="modal"], div[class*="Modal"], div[class*="dialog"], div[class*="Dialog"], div[class*="popup"], div[class*="Popup"]'));
        return roots.filter((root) => isVisible(root) && Boolean(root.querySelector('input#uploadCoverBtn, button[dt-mpid="上传封面确定"]')));
    }
    function getEntryCoverRoot(entry) {
        return entry.closest('div[class*="cover"], div[class*="Cover"], div[class*="upload"], div[class*="Upload"]');
    }
    function uniqueRoots(roots) {
        return roots.filter((root, index) => Boolean(root) && roots.indexOf(root) === index);
    }
    async function waitForCoverInput(entry, existingRoots, timeout = 3000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const roots = uniqueRoots([
                ...getVisibleCoverUploadRoots().filter((root) => !existingRoots.has(root)),
                getEntryCoverRoot(entry),
            ]);
            for (const root of roots) {
                const input = root.querySelector("input#uploadCoverBtn");
                if (input)
                    return { input, root };
            }
            await sleep(150);
        }
        return null;
    }
    async function waitForCoverConfirmButton(root, timeout = 5000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const confirmBtn = root.querySelector('button[dt-mpid="上传封面确定"]');
            if (confirmBtn)
                return confirmBtn;
            const dialogConfirmBtn = getVisibleCoverUploadRoots()
                .find((dialogRoot) => dialogRoot !== root)
                ?.querySelector('button[dt-mpid="上传封面确定"]');
            if (dialogConfirmBtn)
                return dialogConfirmBtn;
            await sleep(200);
        }
        return null;
    }
    async function injectCoverFile(input, file) {
        if (file.type && !file.type.startsWith("image/"))
            return false;
        const cBuf = await (await fetch(file.url)).arrayBuffer();
        const coverFile = new File([cBuf], file.name, { type: file.type || "image/png" });
        const cdt = new DataTransfer();
        cdt.items.add(coverFile);
        input.files = cdt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    }
    async function uploadCoverImage(file, entrySelector) {
        const manualEntry = document.querySelector(entrySelector);
        if (!manualEntry)
            return;
        const existingRoots = new Set(getVisibleCoverUploadRoots());
        manualEntry.click();
        const coverInputResult = await waitForCoverInput(manualEntry, existingRoots);
        if (!coverInputResult)
            return;
        if (!(await injectCoverFile(coverInputResult.input, file)))
            return;
        await sleep(1500);
        const confirmBtn = await waitForCoverConfirmButton(coverInputResult.root);
        confirmBtn?.click();
        if (confirmBtn)
            await sleep(1000);
    }
    async function publishIfAutoEnabled() {
        if (data.isAutoPublish !== true)
            return;
        // Re-query while polling so rerenders do not leave us holding a stale button.
        const findPublishButton = () => Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("发布"));
        let publishButton = findPublishButton();
        for (let i = 0; i < 60; i++) {
            publishButton = findPublishButton();
            if (publishButton && publishButton.getAttribute("aria-disabled") !== "true")
                break;
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (!publishButton) {
            console.debug('未找到"发布"按钮');
            return;
        }
        if (publishButton.getAttribute("aria-disabled") === "true") {
            console.debug("发布按钮仍不可用，跳过自动发布");
            return;
        }
        console.debug("sendButton clicked");
        publishButton.dispatchEvent(new Event("click", { bubbles: true }));
    }
    try {
        const { title, content, video, cover, horizontalCover, description } = data.data;
        if (!video) {
            console.error("腾讯视频：未提供视频文件");
            return;
        }
        // Upload video.
        const fileInput = (await waitForElement('input[type="file"]'));
        const buf = await (await fetch(video.url)).arrayBuffer();
        const ext = video.name.split(".").pop() || "mp4";
        const videoFile = new File([buf], `${title}.${ext}`, { type: video.type || "video/mp4" });
        const dt = new DataTransfer();
        dt.items.add(videoFile);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 3000));
        // Fill title.
        const titleInput = document.querySelector('input[placeholder*="标题"], input[type="text"]');
        if (titleInput && title) {
            titleInput.focus();
            titleInput.value = title;
            titleInput.dispatchEvent(new Event("input", { bubbles: true }));
            titleInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
        // Fill description.
        const descArea = document.querySelector('textarea[placeholder*="简介"]');
        if (descArea) {
            descArea.focus();
            descArea.value = description || content || "";
            descArea.dispatchEvent(new Event("input", { bubbles: true }));
            descArea.dispatchEvent(new Event("change", { bubbles: true }));
        }
        // Upload vertical and horizontal covers from their separate entry points.
        if (cover) {
            await uploadCoverImage(cover, 'div[class*="manualUploadCoverButton_"]');
            await sleep(2000);
        }
        if (horizontalCover) {
            await uploadCoverImage(horizontalCover, 'div[class*="uploadAddArea___"]');
        }
        await publishIfAutoEnabled();
    }
    catch (error) {
        console.error("腾讯视频发布失败:", error);
    }
}

export async function VideoTiktok(data) {
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
            setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    }
    async function uploadVideo(file) {
        const fileInput = (await waitForElement('input[type="file"][accept="video/*"]'));
        if (!fileInput) {
            console.error("Video file input not found");
            throw new Error("Video file input not found");
        }
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 等待1秒确保元素完全加载
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        // 触发必要的事件
        const changeEvent = new Event("change", { bubbles: true });
        fileInput.dispatchEvent(changeEvent);
        const inputEvent = new Event("input", { bubbles: true });
        fileInput.dispatchEvent(inputEvent);
        console.log("视频上传事件已触发");
    }
    async function uploadCover(cover) {
        console.log("准备上传封面:", cover);
        const editContainer = (await waitForElement("div.edit-container"));
        if (!editContainer) {
            console.log("未找到封面编辑容器");
            return;
        }
        editContainer.click();
        await new Promise((r) => setTimeout(r, 1000));
        const tabs = document.querySelectorAll("div.cover-edit-header div.cover-edit-tab");
        if (tabs.length < 2) {
            console.log("未找到封面上传标签页");
            return;
        }
        tabs[1].click();
        await new Promise((r) => setTimeout(r, 1000));
        const fileInput = (await waitForElement('input[type="file"][accept="image/png, image/jpeg, image/jpg"]'));
        if (!fileInput) {
            console.log("未找到封面图片文件输入框");
            return;
        }
        const response = await fetch(cover.url);
        const buffer = await response.arrayBuffer();
        const imageFile = new File([buffer], cover.name, { type: cover.type });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(imageFile);
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        fileInput.dispatchEvent(new Event("input", { bubbles: true }));
        console.log("封面图片上传事件已触发");
        await new Promise((r) => setTimeout(r, 3000));
        const doneButtons = document.querySelectorAll("div.cover-edit-footer button");
        console.log("完成按钮:", doneButtons);
        const doneButton = doneButtons[doneButtons.length - 1];
        if (doneButton) {
            doneButton.click();
            console.log("已点击完成按钮");
        }
    }
    try {
        const { content, video, title, tags = [], cover, horizontalCover, description, } = data.data;
        // 处理视频上传
        if (video) {
            const response = await fetch(video.url);
            const arrayBuffer = await response.arrayBuffer();
            const extension = video.name.split(".").pop();
            const fileName = `${title || "video"}.${extension}`;
            const videoFile = new File([arrayBuffer], fileName, { type: video.type });
            console.log(`视频文件: ${videoFile.name} ${videoFile.type} ${videoFile.size}`);
            await uploadVideo(videoFile);
            console.log("视频上传已初始化");
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
        // 处理内容输入
        const editor = (await waitForElement('div.public-DraftEditor-content[contenteditable="true"]'));
        if (editor) {
            // 使用 ClipboardEvent 来模拟粘贴操作
            const fullContent = `${title || ""}
${description || content}
${tags.map((tag) => `#${tag}`).join(" ")}`;
            const pasteEvent = new ClipboardEvent("paste", {
                bubbles: true,
                cancelable: true,
                clipboardData: new DataTransfer(),
            });
            pasteEvent.clipboardData.setData("text/plain", fullContent);
            editor.dispatchEvent(pasteEvent);
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        const coverToUpload = cover ?? horizontalCover;
        if (coverToUpload) {
            await uploadCover(coverToUpload);
        }
        // 等待内容填写完成
        await new Promise((resolve) => setTimeout(resolve, 5000));
        // 处理发布按钮
        const buttons = document.querySelectorAll("button");
        for (const button of Array.from(buttons)) {
            if (["發佈", "发布", "Post"].includes(button.textContent?.trim() || "")) {
                if (data.isAutoPublish) {
                    console.log("点击发布按钮");
                    button.click();
                }
                break;
            }
        }
    }
    catch (error) {
        console.error("TiktokVideo 发布过程中出错:", error);
        throw error; // 向上传递错误
    }
}

export async function VideoToutiaohao(data) {
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
            }, timeout);
        });
    }
    async function uploadVideo(file) {
        const fileInput = (await waitForElement('input[type=file][accept="video/*"]'));
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        const changeEvent = new Event("change", { bubbles: true });
        fileInput.dispatchEvent(changeEvent);
        const inputEvent = new Event("input", { bubbles: true });
        fileInput.dispatchEvent(inputEvent);
        console.log("视频上传事件已触发");
    }
    async function uploadCover(cover) {
        console.log("尝试上传封面", cover);
        const coverUploadContainer = await waitForElement("div.cover-container");
        console.log("封面上传容器", coverUploadContainer);
        if (!coverUploadContainer)
            return;
        coverUploadContainer.click();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const changeCoverButton = await waitForElement("div.byte-upload-trigger");
        changeCoverButton.click();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const fileInput = (await waitForElement('input[type="file"].byte-upload-input'));
        console.log("封面文件输入框", fileInput);
        if (!fileInput)
            return;
        if (!cover.type?.includes("image/")) {
            console.log("提供的封面文件不是图片类型", cover);
            return;
        }
        const response = await fetch(cover.url);
        const arrayBuffer = await response.arrayBuffer();
        const imageFile = new File([arrayBuffer], cover.name, { type: cover.type });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(imageFile);
        fileInput.files = dataTransfer.files;
        const changeEvent = new Event("change", { bubbles: true });
        fileInput.dispatchEvent(changeEvent);
        console.log("封面文件上传操作已触发");
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const doneButton = await waitForElement("button.primary");
        console.log("完成按钮", doneButton);
        if (doneButton) {
            doneButton.click();
        }
    }
    try {
        const { content, video, title, tags, cover } = data.data;
        // 处理视频上传
        if (video) {
            const response = await fetch(video.url);
            const blob = await response.blob();
            const videoFile = new File([blob], video.name, { type: video.type });
            console.log(`视频文件: ${videoFile.name} ${videoFile.type} ${videoFile.size}`);
            await uploadVideo(videoFile);
            console.log("视频上传已初始化");
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // 处理标题输入
        const titleInput = (await waitForElement('input[placeholder*="作品标题"]'));
        if (titleInput) {
            titleInput.focus();
            titleInput.value = title || content.slice(0, 20);
            titleInput.dispatchEvent(new Event("input", { bubbles: true }));
            titleInput.dispatchEvent(new Event("change", { bubbles: true }));
            console.log("标题已填写:", titleInput.value);
        }
        // 填写内容和标签
        const contentEditor = (await waitForElement('div.zone-container.editor-kit-container.editor.editor-comp-publish[contenteditable="true"]'));
        if (contentEditor) {
            contentEditor.focus();
            // 填写描述内容
            const contentPasteEvent = new ClipboardEvent("paste", {
                bubbles: true,
                cancelable: true,
                clipboardData: new DataTransfer(),
            });
            contentPasteEvent.clipboardData.setData("text/plain", `${content}\n\n`);
            contentEditor.dispatchEvent(contentPasteEvent);
            await new Promise((resolve) => setTimeout(resolve, 500));
            // 处理标签
            if (tags && tags.length > 0) {
                const tagsToSync = tags.slice(0, 5);
                for (const tag of tagsToSync) {
                    console.log("添加标签:", tag);
                    const pasteEvent = new ClipboardEvent("paste", {
                        bubbles: true,
                        cancelable: true,
                        clipboardData: new DataTransfer(),
                    });
                    pasteEvent.clipboardData.setData("text/plain", `#${tag} `);
                    contentEditor.dispatchEvent(pasteEvent);
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }
            }
        }
        // 处理封面上传
        if (cover) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await uploadCover(cover);
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
        // 处理自动发布
        const buttons = document.querySelectorAll("button");
        const publishButton = Array.from(buttons).find((button) => button.textContent === "发布");
        if (publishButton) {
            while (publishButton.disabled) {
                console.log("发布按钮不可用，等待...");
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            if (data.isAutoPublish) {
                console.log("点击发布按钮");
                publishButton.click();
            }
        }
        else {
            console.log('未找到"发布"按钮');
        }
    }
    catch (error) {
        console.error("ToutiaohaoVideo 发布过程中出错:", error);
    }
}

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * vivo视频发布器
 */
export async function VideoVivoVideo(data) {
    console.log("🚀 开始vivo视频发布流程...");
    console.log("🔍 当前页面:", window.location.href);
    try {
        // 检查是否在vivo视频页面
        if (!window.location.href.includes("video.vivo.com.cn")) {
            console.error("❌ 不在vivo视频页面，当前页面:", window.location.href);
            return;
        }
        // 解析视频数据
        if (!data || !data.data) {
            console.error("❌ 缺少视频数据");
            return;
        }
        const { content, video, title, description } = data.data;
        console.log("📝 视频数据:", {
            title: title?.substring(0, 50),
            contentLength: content?.length,
            hasVideo: !!video,
        });
        // 内联定义vivo视频上传器类
        const VivoVideoUploader = class VivoVideoUploader {
            /**
             * 等待指定时间
             */
            sleep(ms) {
                return new Promise((resolve) => setTimeout(resolve, ms));
            }
            /**
             * 等待元素出现
             */
            async waitForElement(selector, timeout = 10000) {
                return new Promise((resolve, reject) => {
                    const element = document.querySelector(selector);
                    if (element) {
                        resolve(element);
                        return;
                    }
                    const observer = new MutationObserver(() => {
                        const element = document.querySelector(selector);
                        if (element) {
                            resolve(element);
                            observer.disconnect();
                        }
                    });
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true,
                    });
                    setTimeout(() => {
                        observer.disconnect();
                        reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
                    }, timeout);
                });
            }
            /**
             * 填写标题
             */
            async fillTitle(title) {
                try {
                    console.log("📝 填写标题:", title);
                    // 等待页面加载
                    await this.sleep(3000);
                    // vivo视频标题输入框选择器
                    const titleSelectors = [
                        'input[placeholder*="标题"]',
                        'input[placeholder*="title"]',
                        'input[name*="title"]',
                        'input[class*="title"]',
                        'input[type="text"]',
                        '.ant-input[type="text"]',
                        ".ant-input",
                        "#title",
                        'textarea[placeholder*="标题"]',
                        '.form-input[type="text"]',
                        '.el-input__inner[type="text"]',
                        ".vivo-input",
                    ];
                    for (const selector of titleSelectors) {
                        const titleElement = document.querySelector(selector);
                        if (titleElement && titleElement.offsetParent !== null) {
                            console.log("✅ 找到标题输入框:", selector);
                            try {
                                // 清空原有内容
                                titleElement.focus();
                                titleElement.select();
                                // 逐字符输入模拟真实用户行为
                                for (let i = 0; i < title.length; i++) {
                                    const _char = title[i];
                                    titleElement.value = title.substring(0, i + 1);
                                    // 触发输入事件
                                    titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                    await this.sleep(50);
                                }
                                // 触发多种事件确保框架识别
                                titleElement.dispatchEvent(new Event("focus", { bubbles: true }));
                                titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                titleElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                titleElement.dispatchEvent(new Event("blur", { bubbles: true }));
                                // 验证设置是否成功
                                console.log(`✅ 标题设置后验证: value="${titleElement.value}"`);
                                if (titleElement.value === title) {
                                    console.log("✅ 标题填写成功");
                                    return;
                                }
                            }
                            catch (e) {
                                console.error("设置标题值时出错:", e);
                            }
                        }
                    }
                    console.log("❌ 未找到可用的标题输入框");
                    return;
                }
                catch (error) {
                    console.error("填写标题失败:", error);
                    return;
                }
            }
            /**
             * 填写描述
             */
            async fillDescription(description) {
                try {
                    console.log("📝 填写描述:", `${description.substring(0, 100)}...`);
                    // vivo视频描述输入框选择器
                    const descSelectors = [
                        'textarea[placeholder*="描述"]',
                        'textarea[placeholder*="简介"]',
                        'textarea[placeholder*="内容"]',
                        'textarea[name*="content"]',
                        'textarea[name*="desc"]',
                        "textarea",
                        ".ant-input",
                        "#content",
                        "#description",
                        ".form-textarea",
                        ".el-textarea__inner",
                        ".vivo-textarea",
                    ];
                    for (const selector of descSelectors) {
                        const descElement = document.querySelector(selector);
                        if (descElement && descElement.offsetParent !== null) {
                            console.log("✅ 找到描述输入框:", selector);
                            try {
                                descElement.focus();
                                descElement.value = description;
                                // 触发多种事件
                                descElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                descElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                console.log("✅ 描述填写成功");
                                return;
                            }
                            catch (e) {
                                console.error("设置描述值时出错:", e);
                            }
                        }
                    }
                    console.log("❌ 未找到可用的描述输入框");
                    return;
                }
                catch (error) {
                    console.error("填写描述失败:", error);
                    return;
                }
            }
            /**
             * 上传视频文件
             */
            async uploadVideo(videoData) {
                try {
                    console.log("📹 开始上传视频...");
                    // 获取视频文件
                    let file;
                    if (videoData.videoFile) {
                        file = videoData.videoFile;
                    }
                    else if (videoData.url) {
                        const response = await fetch(videoData.url);
                        const arrayBuffer = await response.arrayBuffer();
                        const extension = videoData.name.split(".").pop() || "mp4";
                        const fileName = `${videoData.name.replace(/\.[^/.]+$/, "")}.${extension}`;
                        file = new File([arrayBuffer], fileName, { type: "video/mp4" });
                    }
                    else {
                        console.error("❌ 无效的视频数据");
                        return;
                    }
                    console.log("📁 视频文件:", file.name, file.size, file.type);
                    // 等待页面完全加载
                    console.log("⏳ 等待页面加载完成...");
                    await this.sleep(5000);
                    // 查找上传区域
                    console.log("🔍 查找vivo视频上传区域...");
                    const uploadSelectors = [
                        ".upload-area",
                        ".video-upload",
                        '[class*="upload"]',
                        '[class*="video"]',
                        ".ant-upload",
                        "#upload",
                        ".upload-btn",
                        'button[class*="upload"]',
                        ".upload-container",
                        ".el-upload",
                        ".el-upload-dragger",
                        ".vivo-upload",
                        ".upload-wrapper",
                    ];
                    let uploadArea = null;
                    for (const selector of uploadSelectors) {
                        const element = document.querySelector(selector);
                        if (element && element.offsetParent !== null) {
                            console.log(`✅ 找到上传区域: ${selector}`);
                            uploadArea = element;
                            break;
                        }
                    }
                    if (!uploadArea) {
                        console.log("❌ 未找到上传区域，尝试查找文件输入框...");
                        // 直接查找文件输入框
                        const fileInputs = document.querySelectorAll('input[type="file"]');
                        console.log(`🔍 找到 ${fileInputs.length} 个文件输入框`);
                        let targetInput = null;
                        fileInputs.forEach((input, index) => {
                            const accept = input.getAttribute("accept") || "";
                            console.log(`  输入框 ${index + 1}: accept="${accept}"`);
                            // 优先查找视频文件输入框
                            if (accept.includes("video") || accept.includes("*") || accept === "") {
                                targetInput = input;
                                console.log(`✅ 选择输入框 ${index + 1} 作为目标`);
                            }
                        });
                        if (targetInput) {
                            // 使用DataTransfer API设置文件
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            targetInput.files = dataTransfer.files;
                            // 触发change事件
                            targetInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 文件已设置到输入框");
                            return;
                        }
                        console.log("❌ 未找到合适的文件输入框");
                        return;
                    }
                    // 如果找到了上传区域，尝试点击或操作
                    console.log("🔄 尝试操作上传区域...");
                    // 查找上传区域内的文件输入框
                    const uploadInput = uploadArea.querySelector('input[type="file"]');
                    if (uploadInput) {
                        console.log("✅ 在上传区域内找到文件输入框");
                        // 创建透明的文件输入框覆盖上传区域
                        const overlayInput = document.createElement("input");
                        overlayInput.type = "file";
                        overlayInput.accept = "video/*,.mp4,.avi,.mov,.wmv";
                        overlayInput.style.position = "absolute";
                        overlayInput.style.opacity = "0";
                        overlayInput.style.width = "100%";
                        overlayInput.style.height = "100%";
                        overlayInput.style.top = "0";
                        overlayInput.style.left = "0";
                        overlayInput.style.zIndex = "9999";
                        overlayInput.id = `vivo_upload_${Date.now()}`;
                        // 设置上传区域样式以支持覆盖
                        const uploadElement = uploadArea;
                        uploadElement.style.position = "relative";
                        uploadElement.appendChild(overlayInput);
                        // 设置文件
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        overlayInput.files = dataTransfer.files;
                        // 触发文件选择事件
                        overlayInput.dispatchEvent(new Event("focus", { bubbles: true }));
                        overlayInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                        console.log("✅ 文件已设置到覆盖输入框");
                        // 尝试点击上传区域（如果需要）
                        if (uploadArea.tagName === "BUTTON" || uploadArea.closest("button")) {
                            console.log("🖱️ 点击上传按钮...");
                            (uploadArea.closest("button") || uploadArea).click();
                            await this.sleep(1000);
                        }
                        // 等待上传开始
                        await this.waitForUploadStart();
                        return;
                    }
                    console.log("⚠️ 上传区域内未找到文件输入框，尝试点击上传区域...");
                    // 点击上传区域触发文件选择
                    const clickableElement = uploadArea.closest("button") || uploadArea.querySelector("button") || uploadArea;
                    if (clickableElement) {
                        console.log("🖱️ 点击可点击元素...");
                        clickableElement.click();
                        await this.sleep(2000);
                        // 再次查找文件输入框
                        const newFileInput = document.querySelector('input[type="file"]');
                        if (newFileInput) {
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            newFileInput.files = dataTransfer.files;
                            newFileInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 文件已设置到新找到的输入框");
                            return;
                        }
                    }
                    console.log("⚠️ 无法直接上传文件，但页面可能已经准备好了");
                    return;
                }
                catch (error) {
                    console.error("❌ 视频上传失败:", error);
                    return;
                }
            }
            /**
             * 等待上传开始
             */
            async waitForUploadStart() {
                console.log("⏳ 等待上传开始...");
                for (let i = 0; i < 30; i++) {
                    await this.sleep(1000);
                    // 检查上传进度指示器
                    const progressSelectors = [
                        '[class*="progress"]',
                        '[class*="uploading"]',
                        '[class*="upload-progress"]',
                        ".ant-progress",
                        ".progress-bar",
                        ".uploading",
                        ".el-progress",
                        ".vivo-progress",
                    ];
                    for (const selector of progressSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log("✅ 检测到上传进度指示器");
                            return;
                        }
                    }
                    // 检查是否有上传成功标志
                    const successSelectors = ['[class*="success"]', '[class*="complete"]', '[class*="done"]', ".upload-success"];
                    for (const selector of successSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log("✅ 检测到上传成功标志");
                            return;
                        }
                    }
                }
                console.log("⚠️ 未检测到明确的上传状态，但可能已开始");
            }
        };
        console.log("✅ vivo视频上传器类定义完成");
        const uploader = new VivoVideoUploader();
        console.log("✅ vivo视频上传器实例创建完成");
        // 步骤1: 填写标题
        if (title) {
            console.log("📝 填写标题:", title);
            await uploader.fillTitle(title);
        }
        // 步骤2: 填写描述
        if (content) {
            console.log("📝 填写描述:", `${content.substring(0, 100)}...`);
            await uploader.fillDescription(description ?? content);
        }
        // 步骤3: 上传视频
        if (video) {
            console.log("🎥 开始上传视频...");
            await uploader.uploadVideo(video);
        }
        else {
            console.error("❌ 缺少视频文件");
            return;
        }
        console.log("🎉 vivo视频发布流程完成");
        return;
    }
    catch (error) {
        console.error("💥 vivo视频发布失败:", error);
        console.error("错误详情:", error.stack);
        return;
    }
}

export async function VideoWeibo(data) {
    const { content, video, title, tags, cover, horizontalCover } = data.data;
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
            }, timeout);
        });
    }
    function simulateDragAndDrop(dropTarget, dataTransfer) {
        const dragEnter = new DragEvent("dragenter", { bubbles: true, dataTransfer });
        const dragOver = new DragEvent("dragover", { bubbles: true, dataTransfer });
        const drop = new DragEvent("drop", { bubbles: true, dataTransfer });
        dropTarget.dispatchEvent(dragEnter);
        dropTarget.dispatchEvent(dragOver);
        dropTarget.dispatchEvent(drop);
    }
    function uploadViaPageFileInput(file) {
        return new Promise((resolve) => {
            const requestId = crypto.randomUUID();
            let settled = false;
            const finish = (success) => {
                if (settled)
                    return;
                settled = true;
                window.removeEventListener("message", handleResult);
                resolve(success);
            };
            const handleResult = (event) => {
                if (event.source === window &&
                    event.data?.type === "WEIBO_UPLOAD_VIDEO_RESULT" &&
                    event.data?.requestId === requestId) {
                    finish(event.data.success === true);
                }
            };
            window.addEventListener("message", handleResult);
            window.postMessage({ type: "WEIBO_UPLOAD_VIDEO", requestId, files: [file] }, "*");
            setTimeout(() => finish(false), 8000);
        });
    }
    try {
        // 处理视频上传
        if (video) {
            await waitForElement("button[id^='video_button_upload_']");
            const response = await fetch(video.url);
            const arrayBuffer = await response.arrayBuffer();
            const videoFile = new File([arrayBuffer], video.name, { type: video.type });
            console.log(`文件: ${videoFile.name} ${videoFile.type} ${videoFile.size}`);
            const uploadedViaPageInput = await uploadViaPageFileInput(videoFile);
            if (!uploadedViaPageInput) {
                const buttons = document.querySelectorAll("button");
                const uploadVideoButton = Array.from(buttons).find((button) => button.textContent?.includes("上传视频"));
                if (!uploadVideoButton) {
                    throw new Error('未找到"上传视频"按钮');
                }
                const dragArea = uploadVideoButton.parentElement?.parentElement;
                if (!dragArea) {
                    throw new Error("未找到拖拽区域");
                }
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(videoFile);
                simulateDragAndDrop(dragArea, dataTransfer);
            }
            // 等待上传完成
            await new Promise((resolve) => setTimeout(resolve, 3000));
        }
        // 等待标题输入框出现
        await waitForElement('input[placeholder="填写标题（0～30个字）"]');
        // 等待验证码消失
        while (true) {
            const geetest = document.querySelector("div.geetest_captcha.geetest_boxShow.geetest_freeze_wait");
            if (!geetest)
                break;
            await new Promise((resolve) => setTimeout(resolve, 3000));
        }
        // 点击原创选项
        const radioTexts = document.querySelectorAll("span.woo-radio-text");
        const originalSpan = Array.from(radioTexts).find((span) => span.textContent === "原创");
        if (originalSpan) {
            originalSpan.click();
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        // 填写标题
        const titleInput = document.querySelector('input[placeholder="填写标题（0～30个字）"]');
        if (titleInput) {
            titleInput.value = title;
            titleInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
        // 填写内容
        const descriptionInput = document.querySelector('textarea[placeholder="有什么新鲜事想分享给大家？"]');
        if (descriptionInput) {
            const tagsText = tags ? tags.map((tag) => `#${tag}#`).join(" ") : "";
            const fullContent = `${content} ${tagsText}`;
            descriptionInput.focus();
            descriptionInput.value = fullContent;
            descriptionInput.dispatchEvent(new Event("input", { bubbles: true }));
            descriptionInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
        async function uploadCover(coverData) {
            console.log("tryCover", coverData);
            const cropCoverLink = Array.from(document.querySelectorAll("a")).find((e) => e.textContent?.includes("裁剪封面"));
            console.log("a", cropCoverLink);
            if (!cropCoverLink)
                return;
            cropCoverLink.click();
            await new Promise((e) => setTimeout(e, 1000));
            const fileInput = document.querySelector("input[type='file'][accept='.jpg, .jpeg, .bmp, .gif, .png']");
            console.log("fileInput", fileInput);
            if (!fileInput)
                return;
            const dataTransfer = new DataTransfer();
            console.log("try upload file", coverData);
            if (!coverData.type || !coverData.type.includes("image/")) {
                return;
            }
            const response = await fetch(coverData.url);
            const arrayBuffer = await response.arrayBuffer();
            const imageFile = new File([arrayBuffer], coverData.name, { type: coverData.type });
            dataTransfer.items.add(imageFile);
            if (dataTransfer.files.length === 0)
                return;
            fileInput.files = dataTransfer.files;
            const changeEvent = new Event("change", { bubbles: true });
            fileInput.dispatchEvent(changeEvent);
            const inputEvent = new Event("input", { bubbles: true });
            fileInput.dispatchEvent(inputEvent);
            console.log("文件上传操作触发");
            await new Promise((e) => setTimeout(e, 3000));
            const tab1 = document.querySelector("div.wbpro-tab1");
            console.log("tab1", tab1);
            if (!tab1)
                return;
            const doneButtonsContainer = tab1.nextElementSibling;
            if (!doneButtonsContainer)
                return;
            const doneButtons = doneButtonsContainer.querySelectorAll("div.wbpro-layer div.wbpro-layer-btn.woo-box-flex.woo-box-justifyCenter button");
            console.log("doneButtons", doneButtons);
            const doneButton = Array.from(doneButtons).find((e) => "完成" === e.textContent);
            console.log("doneButton", doneButton);
            if (doneButton) {
                doneButton.click();
            }
        }
        const selectedCover = cover || horizontalCover;
        if (selectedCover) {
            await uploadCover(selectedCover);
        }
        // 处理自动发布
        if (data.isAutoPublish) {
            const buttons = document.querySelectorAll("button");
            const sendButton = Array.from(buttons).find((button) => button.textContent?.includes("发布"));
            if (sendButton) {
                let attempts = 0;
                while (sendButton.disabled && attempts < 10) {
                    await new Promise((resolve) => setTimeout(resolve, 3000));
                    attempts++;
                    console.log(`等待发布按钮启用中... 尝试 ${attempts}/10`);
                }
                if (sendButton.disabled) {
                    throw new Error("发布按钮在10次尝试后仍然禁用");
                }
                console.log("点击发布按钮");
                sendButton.dispatchEvent(new Event("click", { bubbles: true }));
                await new Promise((resolve) => setTimeout(resolve, 3000));
                window.location.reload();
            }
            else {
                console.log('未找到"发布"按钮');
            }
        }
    }
    catch (error) {
        console.error("填入微博内容或上传视频时出错:", error);
    }
}

/**
 * @file 微信视频号发布同步功能
 * @description 处理视频同步发布到微信视频号，支持wujie微前端框架的shadow DOM环境
 * @author Chrome Extension Team
 * @date 2024-01-01
 */
/**
 * 微信视频号视频发布处理函数
 * @description 自动化填写视频标题、描述、标签，上传视频文件，处理原创声明和发布操作
 * @param data - 同步数据，包含视频信息和发布配置
 * @throws {Error} 当查找关键元素失败或发布过程出错时抛出错误
 */
export async function VideoWeiXinChannel(data) {
    /**
     * Format date to yyyy-MM-dd HH:mm format
     * @param date - Date object to format
     * @returns Formatted date string
     */
    function formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        return `${year}-${month}-${day} ${hours}:${minutes}`;
    }
    /**
     * 解析视频号所在的根节点（视频号运行在 wujie 微前端的 shadow DOM 内）
     * @returns wujie-app 的 shadowRoot；若不存在则回退到 document
     */
    function getRoot() {
        const wujieApp = document.querySelector("wujie-app");
        return wujieApp?.shadowRoot || document;
    }
    /**
     * 等待元素出现，支持Shadow DOM查询
     * @param selector - CSS选择器
     * @param timeout - 超时时间（毫秒）
     * @returns Promise<Element> 找到的元素
     */
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            /**
             * 在指定根节点下查找元素，支持Shadow DOM
             * @param root - 根节点
             * @returns Element | null 找到的元素或null
             */
            function findElementInRoot(root) {
                // 先在当前根节点下查找
                const element = root.querySelector(selector);
                if (element)
                    return element;
                // 查找所有可能包含shadow-root的元素
                const allElements = root.querySelectorAll("*");
                for (const el of allElements) {
                    if (el.shadowRoot) {
                        const found = findElementInRoot(el.shadowRoot);
                        if (found)
                            return found;
                    }
                }
                return null;
            }
            /**
             * 查找wujie-app的shadow-root并在其中搜索元素
             * @returns Element | null 找到的元素或null
             */
            function findInWujieApp() {
                // 查找wujie-app元素
                const wujieApp = document.querySelector("wujie-app");
                if (wujieApp?.shadowRoot) {
                    const element = wujieApp.shadowRoot.querySelector(selector);
                    if (element) {
                        return element;
                    }
                    // 如果直接查找失败，尝试递归查找
                    return findElementInRoot(wujieApp.shadowRoot);
                }
                // 如果没有找到wujie-app，尝试在整个文档中查找
                return findElementInRoot(document);
            }
            // 首次查找
            const element = findInWujieApp();
            if (element) {
                resolve(element);
                return;
            }
            // 设置MutationObserver监听DOM变化
            const observer = new MutationObserver(() => {
                const element = findInWujieApp();
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });
            // 观察整个document的变化
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
            // 特别处理wujie-app的shadow-root
            const checkWujieApp = () => {
                const wujieApp = document.querySelector("wujie-app");
                if (wujieApp?.shadowRoot) {
                    const shadowObserver = new MutationObserver(() => {
                        const element = wujieApp.shadowRoot.querySelector(selector);
                        if (element) {
                            resolve(element);
                            observer.disconnect();
                            shadowObserver.disconnect();
                        }
                    });
                    shadowObserver.observe(wujieApp.shadowRoot, {
                        childList: true,
                        subtree: true,
                    });
                    // 超时时也要断开shadow observer
                    setTimeout(() => {
                        shadowObserver.disconnect();
                    }, timeout);
                }
            };
            // 立即检查一次
            checkWujieApp();
            // 定期重新检查wujie-app（防止wujie-app后加载）
            const intervalCheck = setInterval(() => {
                const element = findInWujieApp();
                if (element) {
                    resolve(element);
                    observer.disconnect();
                    clearInterval(intervalCheck);
                }
            }, 1000);
            // 设置超时
            setTimeout(() => {
                observer.disconnect();
                clearInterval(intervalCheck);
                reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
            }, timeout);
        });
    }
    /**
     * 等待元素出现但不抛错：超时返回 null，避免单个字段缺失中断整个发布流程
     * @param selector - CSS选择器
     * @param timeout - 超时时间（毫秒）
     */
    async function waitForElementOptional(selector, timeout = 8000) {
        return waitForElement(selector, timeout).catch(() => null);
    }
    /**
     * 上传视频文件
     * @param file - 视频文件
     */
    async function uploadVideo(file) {
        const fileInput = (await waitForElement('input[type="file"]'));
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        // 触发文件选择变化事件
        const changeEvent = new Event("change", { bubbles: true });
        fileInput.dispatchEvent(changeEvent);
        const inputEvent = new Event("input", { bubbles: true });
        fileInput.dispatchEvent(inputEvent);
        console.log("视频上传事件已触发");
    }
    /**
     * 设置定时发布时间
     * @param scheduledPublishTime - 定时发布时间戳（毫秒）
     * @param root - 根节点（Document 或 ShadowRoot），用于查询元素
     */
    async function setScheduledPublishTime(scheduledPublishTime, root = document) {
        try {
            const labels = root.querySelectorAll("label");
            console.debug("labels -->", labels);
            const scheduledLabel = Array.from(labels).find((label) => {
                console.debug("label -->", label.textContent);
                return label.textContent?.trim() === "定时";
            });
            console.debug("scheduledLabel -->", scheduledLabel);
            if (scheduledLabel) {
                scheduledLabel.click();
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
            const publishTimeInput = root.querySelector('input[placeholder="请选择发表时间"]');
            console.debug("publishTimeInput -->", publishTimeInput);
            if (publishTimeInput) {
                // 阻止事件冒泡的处理函数
                const stopEvent = (e) => {
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                };
                // 需要阻止的事件类型
                const eventTypes = ["input", "change", "blur", "focus", "keydown", "keyup"];
                // 添加事件监听器以阻止事件
                eventTypes.forEach((eventType) => {
                    publishTimeInput.addEventListener(eventType, stopEvent, { capture: true });
                });
                try {
                    // 移除 readonly 属性
                    publishTimeInput.removeAttribute("readonly");
                    // 格式化时间
                    const formattedTime = formatDate(new Date(scheduledPublishTime));
                    // 设置时间值（多种方式确保生效）
                    publishTimeInput.value = formattedTime;
                    publishTimeInput.setAttribute("value", formattedTime);
                    publishTimeInput.defaultValue = formattedTime;
                    publishTimeInput.setAttribute("data-value", formattedTime);
                    console.debug("设置时间值:", formattedTime, "当前值:", publishTimeInput.value);
                }
                finally {
                    // 延迟移除事件监听器
                    setTimeout(() => {
                        eventTypes.forEach((eventType) => {
                            publishTimeInput.removeEventListener(eventType, stopEvent, { capture: true });
                        });
                    }, 200);
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    // 触发 change 和 input 事件
                    publishTimeInput.dispatchEvent(new Event("change", { bubbles: true }));
                    publishTimeInput.dispatchEvent(new Event("input", { bubbles: true }));
                }
            }
        }
        catch (error) {
            console.error("setScheduledPublishTime failed:", error);
        }
    }
    /**
     * 把图片文件塞进指定的 file input 并触发 change/input
     * @param fileInput - 目标 input[type=file]
     * @param cover - 封面图片信息
     * @returns 是否成功设置文件
     */
    async function setCoverFile(fileInput, cover) {
        if (!cover.type?.includes("image/"))
            return false;
        const response = await fetch(cover.url);
        const arrayBuffer = await response.arrayBuffer();
        const imageFile = new File([arrayBuffer], cover.name, { type: cover.type });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(imageFile);
        if (dataTransfer.files.length === 0)
            return false;
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        fileInput.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    }
    /**
     * 上传竖封面（主封面）。：入口 div.cover-preview-wrap，等待竖封面蒙层消失后上传
     * @param cover - 封面图片信息
     * @param root - 根节点（Document 或 ShadowRoot）
     */
    async function uploadCover(cover, root) {
        try {
            console.debug("tryCover", cover);
            const coverUploadButton = root.querySelector("div.cover-preview-wrap > div");
            console.debug("coverUpload -->", coverUploadButton);
            if (!coverUploadButton)
                return;
            // 视频未处理完时封面区会有竖封面蒙层，等它消失再点
            for (let i = 0; i < 20; i++) {
                const mask = root.querySelector("div.vertical-mask-layer");
                if (!mask)
                    break;
                console.debug("mask is found, wait 3s");
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }
            coverUploadButton.click();
            await waitForElementOptional("div.cover-control-wrap");
            const fileInput = root.querySelector("div.cover-control-wrap input[type='file']");
            if (!fileInput) {
                console.error("封面上传文件输入框未找到");
                return;
            }
            const ok = await setCoverFile(fileInput, cover);
            if (!ok)
                return;
            console.debug("竖封面上传操作触发");
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const buttons = root.querySelectorAll("div.finder-dialog-footer button");
            const confirmButton = Array.from(buttons).find((b) => b.textContent === "确认");
            if (confirmButton) {
                confirmButton.click();
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
        catch (error) {
            console.error("uploadCover failed:", error);
        }
    }
    /**
     * 上传横封面。：入口 div.horizon-img-wrap div.edit-btn → 直接编辑按钮 → 上传
     * @param cover - 横封面图片信息
     * @param root - 根节点（Document 或 ShadowRoot）
     */
    async function uploadCoverHorizontal(cover, root) {
        try {
            console.debug("tryCoverHorizon", cover);
            const editButton = root.querySelector("div.horizon-img-wrap div.edit-btn");
            console.debug("coverUpload -->", editButton);
            if (!editButton)
                return;
            editButton.click();
            await waitForElementOptional("div.btn-directly-edit");
            const directlyEditButton = root.querySelector("div.btn-directly-edit > button");
            console.debug("editBtn -->", directlyEditButton);
            if (!directlyEditButton)
                return;
            directlyEditButton.click();
            await waitForElementOptional("div.cover-control-wrap");
            const fileInput = root.querySelector("div.cover-control-wrap input[type='file']");
            if (!fileInput) {
                console.error("横封面上传文件输入框未找到");
                return;
            }
            const ok = await setCoverFile(fileInput, cover);
            if (!ok)
                return;
            console.debug("横封面上传操作触发");
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const buttons = root.querySelectorAll("div.finder-dialog-footer button");
            const confirmButton = Array.from(buttons).find((b) => b.textContent === "确认");
            if (confirmButton) {
                confirmButton.click();
            }
        }
        catch (error) {
            console.error("uploadCoverHorizontal failed:", error);
        }
    }
    try {
        const { content, video, title, tags = [], cover, horizontalCover, verticalCover, description, scheduledPublishTime, } = data.data;
        // 等待 wujie-app 与文件输入框就绪，再解析一次根节点（后续字段统一从该根节点同步查询，）
        await waitForElement('input[type="file"]');
        const root = getRoot();
        // 处理视频上传
        if (video) {
            const response = await fetch(video.url);
            const blob = await response.blob();
            const videoFile = new File([blob], video.name, { type: video.type });
            console.log(`视频文件: ${videoFile.name} ${videoFile.type} ${videoFile.size}`);
            await uploadVideo(videoFile);
            console.log("视频上传已初始化");
        }
        // 等待视频上传完成、标题/描述表单渲染出来
        await new Promise((resolve) => setTimeout(resolve, 5000));
        // 处理标题输入（找不到不报错，避免中断后续字段填充）
        const titleInput = (await waitForElementOptional('input[placeholder="填写短标题有机会获得更多流量"], input[placeholder="概括视频主要内容，字数建议6-16个字符"]'));
        const titleChars = [...String(title || "").trim()];
        const titleCut = titleChars.slice(0, 16).join("");
        const titleSpace = titleCut.lastIndexOf(" ");
        const shortTitle = titleChars.length <= 16 ? titleChars.join("") : titleSpace >= 8 ? titleCut.slice(0, titleSpace).trim() : titleCut.trim();
        if (titleInput) {
            const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            if (valueSetter) valueSetter.call(titleInput, shortTitle);
            else titleInput.value = shortTitle;
            titleInput.dispatchEvent(new Event("input", { bubbles: true }));
            titleInput.dispatchEvent(new Event("change", { bubbles: true }));
            console.log("标题已填写:", shortTitle);
        }
        else {
            console.error("未找到视频号标题输入框");
        }
        // 处理内容和标签输入
        const descriptionInput = (await waitForElementOptional('div[data-placeholder="添加描述"]'));
        if (descriptionInput) {
            // 输入主要内容（content 优先，回退 description）
            descriptionInput.focus();
            const pasteEvent = new ClipboardEvent("paste", {
                bubbles: true,
                cancelable: true,
                clipboardData: new DataTransfer(),
            });
            pasteEvent.clipboardData.setData("text/plain", content || description || "");
            descriptionInput.dispatchEvent(pasteEvent);
            await new Promise((resolve) => setTimeout(resolve, 500));
            // 添加标签
            for (const tag of tags) {
                console.log("添加标签:", tag);
                descriptionInput.focus();
                const tagPasteEvent = new ClipboardEvent("paste", {
                    bubbles: true,
                    cancelable: true,
                    clipboardData: new DataTransfer(),
                });
                tagPasteEvent.clipboardData.setData("text/plain", ` #${tag}`);
                descriptionInput.dispatchEvent(tagPasteEvent);
                await new Promise((resolve) => setTimeout(resolve, 1000));
                const enterEvent = new KeyboardEvent("keydown", {
                    bubbles: true,
                    cancelable: true,
                    key: "Enter",
                    code: "Enter",
                    keyCode: 13,
                    which: 13,
                });
                descriptionInput.dispatchEvent(enterEvent);
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
        else {
            console.error("未找到视频号描述输入框");
        }
        // 处理原创声明（：先勾选，再在声明弹窗内勾选并点「声明原创」）
        const originalInput = root.querySelector('input[type="checkbox"][class="ant-checkbox-input"]');
        if (originalInput) {
            originalInput.click();
            await new Promise((resolve) => setTimeout(resolve, 1000));
            const declareInput = root.querySelector('div.declare-body-wrapper input[type="checkbox"][class="ant-checkbox-input"]');
            if (declareInput) {
                declareInput.click();
                await new Promise((resolve) => setTimeout(resolve, 1000));
                const buttons = root.querySelectorAll('button[type="button"]');
                for (const button of Array.from(buttons)) {
                    if (button.textContent === "声明原创") {
                        console.log("点击声明原创按钮");
                        button.click();
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                        break;
                    }
                }
            }
        }
        // 处理定时发布
        if (scheduledPublishTime) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await setScheduledPublishTime(scheduledPublishTime, root);
        }
        // 处理封面：，竖封面 + 横封面分别上传
        const mainCover = cover || verticalCover;
        if (mainCover) {
            await uploadCover(mainCover, root);
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        if (horizontalCover) {
            await uploadCoverHorizontal(horizontalCover, root);
        }
        if (data.isAutoPublish === true) {
            const publishReadyDeadline = Date.now() + 90000;
            while (Date.now() < publishReadyDeadline) {
                const visible = `${document.body?.innerText || ""}\n${root.textContent || ""}`;
                if (!visible.includes("生成中") && !visible.includes("标题超过")) break;
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
            // 处理发布按钮 - 支持shadow DOM查询
            const buttons = root.querySelectorAll("button");
            const publishButton = Array.from(buttons).find((b) => b.textContent?.trim() === "发表");
            console.debug("sendButton", publishButton);
            if (publishButton) {
                console.debug("sendButton clicked");
                publishButton.click();
            }
            else {
                console.error('未找到"发表"按钮');
            }
        }
    }
    catch (error) {
        console.error("WeiXinVideo 发布过程中出错:", error);
    }
}

// 不支持发布视频
export async function VideoXiaoheihe(data) {
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
            }, timeout);
        });
    }
    try {
        const { content, video, title, description } = data.data;
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const titleEditorSelector = "div.hb-cpt__editor-title .ProseMirror.hb-editor";
        const contentEditorSelector = "div.video__edit-content .ProseMirror.hb-editor";
        // 等待编辑器元素出现
        await waitForElement(contentEditorSelector);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // 填写标题
        if (title) {
            try {
                await waitForElement(titleEditorSelector);
                const titleEditor = document.querySelector(titleEditorSelector);
                if (titleEditor) {
                    titleEditor.focus();
                    const titlePasteEvent = new ClipboardEvent("paste", {
                        bubbles: true,
                        cancelable: true,
                        clipboardData: new DataTransfer(),
                    });
                    titlePasteEvent.clipboardData.setData("text/plain", title);
                    titleEditor.dispatchEvent(titlePasteEvent);
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }
            }
            catch {
                console.debug("未找到标题编辑器元素, 跳过标题填写");
            }
        }
        // 填写正文
        const contentEditor = document.querySelector(contentEditorSelector);
        if (!contentEditor) {
            console.debug("未找到正文编辑器元素");
            return;
        }
        contentEditor.focus();
        const contentPasteEvent = new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: new DataTransfer(),
        });
        contentPasteEvent.clipboardData.setData("text/plain", description || content || "");
        contentEditor.dispatchEvent(contentPasteEvent);
        if (video) {
            const response = await fetch(video.url);
            const blob = await response.blob();
            const videoFile = new File([blob], video.name, { type: video.type });
            console.log(`文件: ${videoFile.name} ${videoFile.type} ${videoFile.size}`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
            window.postMessage({ type: "XIAOHEIHE_VIDEO_UPLOAD", video: videoFile }, "*");
        }
        // 发布动态
        if (data.isAutoPublish) {
            const maxAttempts = 3;
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const publishButton = document.querySelector("button.editor-publish__btn");
                if (publishButton) {
                    publishButton.click();
                    console.log("已点击发布按钮");
                    await new Promise((resolve) => setTimeout(resolve, 3000));
                    window.location.reload();
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    }
    catch (error) {
        console.error("小黑盒发布过程中出错:", error);
    }
}

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 易车视频发布器
 */
export async function VideoYiche(data) {
    console.log("🚀 开始易车视频发布流程...");
    console.log("🔍 当前页面:", window.location.href);
    try {
        // 检查是否在易车页面
        if (!window.location.href.includes("mp.yiche.com")) {
            console.error("❌ 不在易车页面，当前页面:", window.location.href);
            return;
        }
        // 解析视频数据
        if (!data || !data.data) {
            console.error("❌ 缺少视频数据");
            return;
        }
        const { content, video, title, description } = data.data;
        console.log("📝 视频数据:", {
            title: title?.substring(0, 50),
            contentLength: content?.length,
            hasVideo: !!video,
        });
        // 内联定义易车视频上传器类
        const YicheVideoUploader = class YicheVideoUploader {
            /**
             * 等待指定时间
             */
            sleep(ms) {
                return new Promise((resolve) => setTimeout(resolve, ms));
            }
            /**
             * 等待元素出现
             */
            async waitForElement(selector, timeout = 10000) {
                return new Promise((resolve, reject) => {
                    const element = document.querySelector(selector);
                    if (element) {
                        resolve(element);
                        return;
                    }
                    const observer = new MutationObserver(() => {
                        const element = document.querySelector(selector);
                        if (element) {
                            resolve(element);
                            observer.disconnect();
                        }
                    });
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true,
                    });
                    setTimeout(() => {
                        observer.disconnect();
                        reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
                    }, timeout);
                });
            }
            /**
             * 填写标题
             */
            async fillTitle(title) {
                try {
                    console.log("📝 填写标题:", title);
                    // 等待页面加载
                    await this.sleep(3000);
                    // 易车标题输入框选择器
                    const titleSelectors = [
                        'input[placeholder*="标题"]',
                        'input[placeholder*="title"]',
                        'input[name*="title"]',
                        'input[class*="title"]',
                        'input[type="text"]',
                        '.ant-input[type="text"]',
                        ".ant-input",
                        "#title",
                        'textarea[placeholder*="标题"]',
                        '.form-input[type="text"]',
                    ];
                    for (const selector of titleSelectors) {
                        const titleElement = document.querySelector(selector);
                        if (titleElement && titleElement.offsetParent !== null) {
                            console.log("✅ 找到标题输入框:", selector);
                            try {
                                // 清空原有内容
                                titleElement.focus();
                                titleElement.select();
                                // 逐字符输入模拟真实用户行为
                                for (let i = 0; i < title.length; i++) {
                                    const _char = title[i];
                                    titleElement.value = title.substring(0, i + 1);
                                    // 触发输入事件
                                    titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                    await this.sleep(50);
                                }
                                // 触发多种事件确保框架识别
                                titleElement.dispatchEvent(new Event("focus", { bubbles: true }));
                                titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                titleElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                titleElement.dispatchEvent(new Event("blur", { bubbles: true }));
                                // 验证设置是否成功
                                console.log(`✅ 标题设置后验证: value="${titleElement.value}"`);
                                if (titleElement.value === title) {
                                    console.log("✅ 标题填写成功");
                                    return;
                                }
                            }
                            catch (e) {
                                console.error("设置标题值时出错:", e);
                            }
                        }
                    }
                    console.log("❌ 未找到可用的标题输入框");
                    return;
                }
                catch (error) {
                    console.error("填写标题失败:", error);
                    return;
                }
            }
            /**
             * 填写描述
             */
            async fillDescription(description) {
                try {
                    console.log("📝 填写描述:", `${description.substring(0, 100)}...`);
                    // 易车描述输入框选择器
                    const descSelectors = [
                        'textarea[placeholder*="描述"]',
                        'textarea[placeholder*="简介"]',
                        'textarea[placeholder*="内容"]',
                        'textarea[name*="content"]',
                        'textarea[name*="desc"]',
                        "textarea",
                        ".ant-input",
                        "#content",
                        "#description",
                        ".form-textarea",
                    ];
                    for (const selector of descSelectors) {
                        const descElement = document.querySelector(selector);
                        if (descElement && descElement.offsetParent !== null) {
                            console.log("✅ 找到描述输入框:", selector);
                            try {
                                descElement.focus();
                                descElement.value = description;
                                // 触发多种事件
                                descElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                descElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                console.log("✅ 描述填写成功");
                                return;
                            }
                            catch (e) {
                                console.error("设置描述值时出错:", e);
                            }
                        }
                    }
                    console.log("❌ 未找到可用的描述输入框");
                    return;
                }
                catch (error) {
                    console.error("填写描述失败:", error);
                    return;
                }
            }
            /**
             * 上传视频文件
             */
            async uploadVideo(videoData) {
                try {
                    console.log("📹 开始上传视频...");
                    // 获取视频文件
                    let file;
                    if (videoData.videoFile) {
                        file = videoData.videoFile;
                    }
                    else if (videoData.url) {
                        const response = await fetch(videoData.url);
                        const arrayBuffer = await response.arrayBuffer();
                        const extension = videoData.name.split(".").pop() || "mp4";
                        const fileName = `${videoData.name.replace(/\.[^/.]+$/, "")}.${extension}`;
                        file = new File([arrayBuffer], fileName, { type: "video/mp4" });
                    }
                    else {
                        console.error("❌ 无效的视频数据");
                        return;
                    }
                    console.log("📁 视频文件:", file.name, file.size, file.type);
                    // 等待页面完全加载
                    console.log("⏳ 等待页面加载完成...");
                    await this.sleep(5000);
                    // 查找上传区域
                    console.log("🔍 查找易车上传区域...");
                    const uploadSelectors = [
                        ".upload-area",
                        ".video-upload",
                        '[class*="upload"]',
                        '[class*="video"]',
                        ".ant-upload",
                        "#upload",
                        ".upload-btn",
                        'button[class*="upload"]',
                        ".upload-container",
                    ];
                    let uploadArea = null;
                    for (const selector of uploadSelectors) {
                        const element = document.querySelector(selector);
                        if (element && element.offsetParent !== null) {
                            console.log(`✅ 找到上传区域: ${selector}`);
                            uploadArea = element;
                            break;
                        }
                    }
                    if (!uploadArea) {
                        console.log("❌ 未找到上传区域，尝试查找文件输入框...");
                        // 直接查找文件输入框
                        const fileInputs = document.querySelectorAll('input[type="file"]');
                        console.log(`🔍 找到 ${fileInputs.length} 个文件输入框`);
                        let targetInput = null;
                        fileInputs.forEach((input, index) => {
                            const accept = input.getAttribute("accept") || "";
                            console.log(`  输入框 ${index + 1}: accept="${accept}"`);
                            // 优先查找视频文件输入框
                            if (accept.includes("video") || accept.includes("*") || accept === "") {
                                targetInput = input;
                                console.log(`✅ 选择输入框 ${index + 1} 作为目标`);
                            }
                        });
                        if (targetInput) {
                            // 使用DataTransfer API设置文件
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            targetInput.files = dataTransfer.files;
                            // 触发change事件
                            targetInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 文件已设置到输入框");
                            return;
                        }
                        console.log("❌ 未找到合适的文件输入框");
                        return;
                    }
                    // 如果找到了上传区域，尝试点击或操作
                    console.log("🔄 尝试操作上传区域...");
                    // 查找上传区域内的文件输入框
                    const uploadInput = uploadArea.querySelector('input[type="file"]');
                    if (uploadInput) {
                        console.log("✅ 在上传区域内找到文件输入框");
                        // 创建透明的文件输入框覆盖上传区域
                        const overlayInput = document.createElement("input");
                        overlayInput.type = "file";
                        overlayInput.accept = "video/*,.mp4,.avi,.mov,.wmv";
                        overlayInput.style.position = "absolute";
                        overlayInput.style.opacity = "0";
                        overlayInput.style.width = "100%";
                        overlayInput.style.height = "100%";
                        overlayInput.style.top = "0";
                        overlayInput.style.left = "0";
                        overlayInput.style.zIndex = "9999";
                        overlayInput.id = `yiche_upload_${Date.now()}`;
                        // 设置上传区域样式以支持覆盖
                        const uploadElement = uploadArea;
                        uploadElement.style.position = "relative";
                        uploadElement.appendChild(overlayInput);
                        // 设置文件
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        overlayInput.files = dataTransfer.files;
                        // 触发文件选择事件
                        overlayInput.dispatchEvent(new Event("focus", { bubbles: true }));
                        overlayInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                        console.log("✅ 文件已设置到覆盖输入框");
                        // 尝试点击上传区域（如果需要）
                        if (uploadArea.tagName === "BUTTON" || uploadArea.closest("button")) {
                            console.log("🖱️ 点击上传按钮...");
                            (uploadArea.closest("button") || uploadArea).click();
                            await this.sleep(1000);
                        }
                        // 等待上传开始
                        await this.waitForUploadStart();
                        return;
                    }
                    console.log("⚠️ 上传区域内未找到文件输入框，尝试点击上传区域...");
                    // 点击上传区域触发文件选择
                    const clickableElement = uploadArea.closest("button") || uploadArea.querySelector("button") || uploadArea;
                    if (clickableElement) {
                        console.log("🖱️ 点击可点击元素...");
                        clickableElement.click();
                        await this.sleep(2000);
                        // 再次查找文件输入框
                        const newFileInput = document.querySelector('input[type="file"]');
                        if (newFileInput) {
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            newFileInput.files = dataTransfer.files;
                            newFileInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 文件已设置到新找到的输入框");
                            return;
                        }
                    }
                    console.log("⚠️ 无法直接上传文件，但页面可能已经准备好了");
                    return;
                }
                catch (error) {
                    console.error("❌ 视频上传失败:", error);
                    return;
                }
            }
            /**
             * 等待上传开始
             */
            async waitForUploadStart() {
                console.log("⏳ 等待上传开始...");
                for (let i = 0; i < 30; i++) {
                    await this.sleep(1000);
                    // 检查上传进度指示器
                    const progressSelectors = [
                        '[class*="progress"]',
                        '[class*="uploading"]',
                        '[class*="upload-progress"]',
                        ".ant-progress",
                        ".progress-bar",
                        ".uploading",
                    ];
                    for (const selector of progressSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log("✅ 检测到上传进度指示器");
                            return;
                        }
                    }
                    // 检查是否有上传成功标志
                    const successSelectors = ['[class*="success"]', '[class*="complete"]', '[class*="done"]', ".upload-success"];
                    for (const selector of successSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log("✅ 检测到上传成功标志");
                            return;
                        }
                    }
                }
                console.log("⚠️ 未检测到明确的上传状态，但可能已开始");
            }
        };
        console.log("✅ 易车上传器类定义完成");
        const uploader = new YicheVideoUploader();
        console.log("✅ 易车上传器实例创建完成");
        // 步骤1: 填写标题
        if (title) {
            console.log("📝 填写标题:", title);
            await uploader.fillTitle(title);
        }
        // 步骤2: 填写描述
        if (content) {
            console.log("📝 填写描述:", `${content.substring(0, 100)}...`);
            await uploader.fillDescription(description ?? content);
        }
        // 步骤3: 上传视频
        if (video) {
            console.log("🎥 开始上传视频...");
            await uploader.uploadVideo(video);
        }
        else {
            console.error("❌ 缺少视频文件");
            return;
        }
        console.log("🎉 易车视频发布流程完成");
        return;
    }
    catch (error) {
        console.error("💥 易车视频发布失败:", error);
        console.error("错误详情:", error.stack);
        return;
    }
}

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 一点号视频发布器
 */
export async function VideoYidian(data) {
    console.log("🚀 开始一点号视频发布流程...");
    console.log("🔍 当前页面:", window.location.href);
    try {
        // 检查是否在一点号页面
        if (!window.location.href.includes("yidian.com")) {
            console.error("❌ 不在一点号页面，当前页面:", window.location.href);
            return;
        }
        // 解析视频数据
        if (!data || !data.data) {
            console.error("❌ 缺少视频数据");
            return;
        }
        const { content, video, title, description } = data.data;
        console.log("📝 视频数据:", { title: title?.substring(0, 50), contentLength: content?.length, hasVideo: !!video });
        // 内联定义一点号视频上传器类
        const YidianVideoUploader = class YidianVideoUploader {
            /**
             * 等待指定时间
             */
            sleep(ms) {
                return new Promise((resolve) => setTimeout(resolve, ms));
            }
            /**
             * 等待元素出现
             */
            async waitForElement(selector, timeout = 10000) {
                return new Promise((resolve, reject) => {
                    const element = document.querySelector(selector);
                    if (element) {
                        resolve(element);
                        return;
                    }
                    const observer = new MutationObserver(() => {
                        const element = document.querySelector(selector);
                        if (element) {
                            resolve(element);
                            observer.disconnect();
                        }
                    });
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true,
                    });
                    setTimeout(() => {
                        observer.disconnect();
                        reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
                    }, timeout);
                });
            }
            /**
             * 填写标题
             */
            async fillTitle(title) {
                try {
                    console.log("📝 填写标题:", title);
                    // 等待页面加载
                    await this.sleep(3000);
                    // 一点号标题输入框选择器
                    const titleSelectors = [
                        'input[placeholder*="标题"]',
                        'input[placeholder*="title"]',
                        'input[name*="title"]',
                        'input[class*="title"]',
                        'input[type="text"]',
                        '.ant-input[type="text"]',
                        ".ant-input",
                        "#title",
                        'textarea[placeholder*="标题"]',
                        '.form-input[type="text"]',
                        '.el-input__inner[type="text"]',
                        ".yidian-input",
                    ];
                    for (const selector of titleSelectors) {
                        const titleElement = document.querySelector(selector);
                        if (titleElement && titleElement.offsetParent !== null) {
                            console.log("✅ 找到标题输入框:", selector);
                            try {
                                // 清空原有内容
                                titleElement.focus();
                                titleElement.select();
                                // 逐字符输入模拟真实用户行为
                                for (let i = 0; i < title.length; i++) {
                                    const _char = title[i];
                                    titleElement.value = title.substring(0, i + 1);
                                    // 触发输入事件
                                    titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                    await this.sleep(50);
                                }
                                // 触发多种事件确保框架识别
                                titleElement.dispatchEvent(new Event("focus", { bubbles: true }));
                                titleElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                titleElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                titleElement.dispatchEvent(new Event("blur", { bubbles: true }));
                                // 验证设置是否成功
                                console.log(`✅ 标题设置后验证: value="${titleElement.value}"`);
                                if (titleElement.value === title) {
                                    console.log("✅ 标题填写成功");
                                    return;
                                }
                            }
                            catch (e) {
                                console.error("设置标题值时出错:", e);
                            }
                        }
                    }
                    console.log("❌ 未找到可用的标题输入框");
                    return;
                }
                catch (error) {
                    console.error("填写标题失败:", error);
                    return;
                }
            }
            /**
             * 填写描述
             */
            async fillDescription(description) {
                try {
                    console.log("📝 填写描述:", `${description.substring(0, 100)}...`);
                    // 一点号描述输入框选择器
                    const descSelectors = [
                        'textarea[placeholder*="描述"]',
                        'textarea[placeholder*="简介"]',
                        'textarea[placeholder*="内容"]',
                        'textarea[name*="content"]',
                        'textarea[name*="desc"]',
                        "textarea",
                        ".ant-input",
                        "#content",
                        "#description",
                        ".form-textarea",
                        ".el-textarea__inner",
                        ".yidian-textarea",
                    ];
                    for (const selector of descSelectors) {
                        const descElement = document.querySelector(selector);
                        if (descElement && descElement.offsetParent !== null) {
                            console.log("✅ 找到描述输入框:", selector);
                            try {
                                descElement.focus();
                                descElement.value = description;
                                // 触发多种事件
                                descElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                                descElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                                console.log("✅ 描述填写成功");
                                return;
                            }
                            catch (e) {
                                console.error("设置描述值时出错:", e);
                            }
                        }
                    }
                    console.log("❌ 未找到可用的描述输入框");
                    return;
                }
                catch (error) {
                    console.error("填写描述失败:", error);
                    return;
                }
            }
            /**
             * 上传视频文件
             */
            async uploadVideo(videoData) {
                try {
                    console.log("📹 开始上传视频...");
                    // 获取视频文件
                    let file;
                    if (videoData.videoFile) {
                        file = videoData.videoFile;
                    }
                    else if (videoData.url) {
                        const response = await fetch(videoData.url);
                        const arrayBuffer = await response.arrayBuffer();
                        const extension = videoData.name.split(".").pop() || "mp4";
                        const fileName = `${videoData.name.replace(/\.[^/.]+$/, "")}.${extension}`;
                        file = new File([arrayBuffer], fileName, { type: "video/mp4" });
                    }
                    else {
                        console.error("❌ 无效的视频数据");
                        return;
                    }
                    console.log("📁 视频文件:", file.name, file.size, file.type);
                    // 等待页面完全加载
                    console.log("⏳ 等待页面加载完成...");
                    await this.sleep(5000);
                    // 查找上传区域
                    console.log("🔍 查找一点号上传区域...");
                    const uploadSelectors = [
                        ".upload-area",
                        ".video-upload",
                        '[class*="upload"]',
                        '[class*="video"]',
                        ".ant-upload",
                        "#upload",
                        ".upload-btn",
                        'button[class*="upload"]',
                        ".upload-container",
                        ".el-upload",
                        ".el-upload-dragger",
                        ".yidian-upload",
                        ".upload-wrapper",
                    ];
                    let uploadArea = null;
                    for (const selector of uploadSelectors) {
                        const element = document.querySelector(selector);
                        if (element && element.offsetParent !== null) {
                            console.log(`✅ 找到上传区域: ${selector}`);
                            uploadArea = element;
                            break;
                        }
                    }
                    if (!uploadArea) {
                        console.log("❌ 未找到上传区域，尝试查找文件输入框...");
                        // 直接查找文件输入框
                        const fileInputs = document.querySelectorAll('input[type="file"]');
                        console.log(`🔍 找到 ${fileInputs.length} 个文件输入框`);
                        let targetInput = null;
                        fileInputs.forEach((input, index) => {
                            const accept = input.getAttribute("accept") || "";
                            console.log(`  输入框 ${index + 1}: accept="${accept}"`);
                            // 优先查找视频文件输入框
                            if (accept.includes("video") || accept.includes("*") || accept === "") {
                                targetInput = input;
                                console.log(`✅ 选择输入框 ${index + 1} 作为目标`);
                            }
                        });
                        if (targetInput) {
                            // 使用DataTransfer API设置文件
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            targetInput.files = dataTransfer.files;
                            // 触发change事件
                            targetInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 文件已设置到输入框");
                            return;
                        }
                        console.log("❌ 未找到合适的文件输入框");
                        return;
                    }
                    // 如果找到了上传区域，尝试点击或操作
                    console.log("🔄 尝试操作上传区域...");
                    // 查找上传区域内的文件输入框
                    const uploadInput = uploadArea.querySelector('input[type="file"]');
                    if (uploadInput) {
                        console.log("✅ 在上传区域内找到文件输入框");
                        // 创建透明的文件输入框覆盖上传区域
                        const overlayInput = document.createElement("input");
                        overlayInput.type = "file";
                        overlayInput.accept = "video/*,.mp4,.avi,.mov,.wmv";
                        overlayInput.style.position = "absolute";
                        overlayInput.style.opacity = "0";
                        overlayInput.style.width = "100%";
                        overlayInput.style.height = "100%";
                        overlayInput.style.top = "0";
                        overlayInput.style.left = "0";
                        overlayInput.style.zIndex = "9999";
                        overlayInput.id = `yidian_upload_${Date.now()}`;
                        // 设置上传区域样式以支持覆盖
                        const uploadElement = uploadArea;
                        uploadElement.style.position = "relative";
                        uploadElement.appendChild(overlayInput);
                        // 设置文件
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        overlayInput.files = dataTransfer.files;
                        // 触发文件选择事件
                        overlayInput.dispatchEvent(new Event("focus", { bubbles: true }));
                        overlayInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                        console.log("✅ 文件已设置到覆盖输入框");
                        // 尝试点击上传区域（如果需要）
                        if (uploadArea.tagName === "BUTTON" || uploadArea.closest("button")) {
                            console.log("🖱️ 点击上传按钮...");
                            (uploadArea.closest("button") || uploadArea).click();
                            await this.sleep(1000);
                        }
                        // 等待上传开始
                        await this.waitForUploadStart();
                        return;
                    }
                    console.log("⚠️ 上传区域内未找到文件输入框，尝试点击上传区域...");
                    // 点击上传区域触发文件选择
                    const clickableElement = uploadArea.closest("button") || uploadArea.querySelector("button") || uploadArea;
                    if (clickableElement) {
                        console.log("🖱️ 点击可点击元素...");
                        clickableElement.click();
                        await this.sleep(2000);
                        // 再次查找文件输入框
                        const newFileInput = document.querySelector('input[type="file"]');
                        if (newFileInput) {
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(file);
                            newFileInput.files = dataTransfer.files;
                            newFileInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                            console.log("✅ 文件已设置到新找到的输入框");
                            return;
                        }
                    }
                    console.log("⚠️ 无法直接上传文件，但页面可能已经准备好了");
                    return;
                }
                catch (error) {
                    console.error("❌ 视频上传失败:", error);
                    return;
                }
            }
            /**
             * 等待上传开始
             */
            async waitForUploadStart() {
                console.log("⏳ 等待上传开始...");
                for (let i = 0; i < 30; i++) {
                    await this.sleep(1000);
                    // 检查上传进度指示器
                    const progressSelectors = [
                        '[class*="progress"]',
                        '[class*="uploading"]',
                        '[class*="upload-progress"]',
                        ".ant-progress",
                        ".progress-bar",
                        ".uploading",
                        ".el-progress",
                        ".yidian-progress",
                    ];
                    for (const selector of progressSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log("✅ 检测到上传进度指示器");
                            return;
                        }
                    }
                    // 检查是否有上传成功标志
                    const successSelectors = ['[class*="success"]', '[class*="complete"]', '[class*="done"]', ".upload-success"];
                    for (const selector of successSelectors) {
                        const elements = document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            console.log("✅ 检测到上传成功标志");
                            return;
                        }
                    }
                }
                console.log("⚠️ 未检测到明确的上传状态，但可能已开始");
            }
        };
        console.log("✅ 一点号上传器类定义完成");
        const uploader = new YidianVideoUploader();
        console.log("✅ 一点号上传器实例创建完成");
        // 步骤1: 填写标题
        if (title) {
            console.log("📝 填写标题:", title);
            await uploader.fillTitle(title);
        }
        // 步骤2: 填写描述
        if (content) {
            console.log("📝 填写描述:", `${content.substring(0, 100)}...`);
            await uploader.fillDescription(description ?? content);
        }
        // 步骤3: 上传视频
        if (video) {
            console.log("🎥 开始上传视频...");
            await uploader.uploadVideo(video);
        }
        else {
            console.error("❌ 缺少视频文件");
            return;
        }
        console.log("🎉 一点号视频发布流程完成");
        return;
    }
    catch (error) {
        console.error("💥 一点号视频发布失败:", error);
        console.error("错误详情:", error.stack);
        return;
    }
}

export async function VideoYouku(data) {
    function waitForElement(selector, timeout = 60000) {
        return new Promise((resolve, reject) => {
            const exist = document.querySelector(selector);
            if (exist) {
                resolve(exist);
                return;
            }
            let timer = 0;
            const observer = new MutationObserver(() => {
                const found = document.querySelector(selector);
                if (found) {
                    window.clearTimeout(timer);
                    observer.disconnect();
                    resolve(found);
                }
            });
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
            timer = window.setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
            }, timeout);
        });
    }
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    function isVisible(element) {
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    }
    function findCropDialogRoot(cropIcon) {
        const dialogRoot = cropIcon.closest('[role="dialog"], div[class*="modal"], div[class*="Modal"], div[class*="dialog"], div[class*="Dialog"], div[class*="drawer"], div[class*="Drawer"]');
        if (dialogRoot)
            return dialogRoot;
        let root = cropIcon.parentElement;
        while (root && root !== document.body) {
            if (root.querySelector("button"))
                return root;
            root = root.parentElement;
        }
        return cropIcon.parentElement ?? document.body;
    }
    async function waitForCropDialog(existingCropIcons, timeout = 5000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const cropIcons = Array.from(document.querySelectorAll("img.bi-cropper-cropBtnIcon"));
            const cropIcon = cropIcons.find((icon) => !existingCropIcons.has(icon) && isVisible(findCropDialogRoot(icon)));
            if (cropIcon) {
                return {
                    cropIcon,
                    root: findCropDialogRoot(cropIcon),
                };
            }
            await sleep(200);
        }
        return null;
    }
    function findButtonByText(root, text) {
        return Array.from(root.querySelectorAll("button")).find((button) => button.textContent?.trim() === text);
    }
    async function waitForButtonByText(root, text, timeout = 3000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const button = findButtonByText(root, text);
            if (button)
                return button;
            await sleep(200);
        }
        return null;
    }
    async function injectCoverFile(input, file) {
        if (file.type && !file.type.startsWith("image/"))
            return false;
        const cBuf = await (await fetch(file.url)).arrayBuffer();
        const coverFile = new File([cBuf], file.name, { type: file.type || "image/png" });
        const cdt = new DataTransfer();
        cdt.items.add(coverFile);
        input.files = cdt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    }
    async function uploadCoverImage(file, index) {
        const coverInputs = document.querySelectorAll("input[type='file'][id*='-imgUpload']");
        const coverInput = coverInputs[index];
        if (!coverInput)
            return;
        const existingCropIcons = new Set(document.querySelectorAll("img.bi-cropper-cropBtnIcon"));
        if (!(await injectCoverFile(coverInput, file)))
            return;
        await sleep(3000);
        const cropDialog = await waitForCropDialog(existingCropIcons);
        if (!cropDialog)
            return;
        (cropDialog.cropIcon.parentElement ?? cropDialog.cropIcon).click();
        await sleep(1000);
        const doneBtn = await waitForButtonByText(cropDialog.root, "确 定");
        doneBtn?.click();
        if (doneBtn)
            await sleep(1000);
        const confirmBtn = await waitForButtonByText(cropDialog.root, "确 认");
        confirmBtn?.click();
        if (confirmBtn)
            await sleep(3000);
    }
    async function publishIfAutoEnabled() {
        if (data.isAutoPublish !== true)
            return;
        // Re-query while polling so rerenders do not leave us holding a stale button.
        const findPublishButton = () => Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("发布"));
        let publishButton = findPublishButton();
        for (let i = 0; i < 60; i++) {
            publishButton = findPublishButton();
            if (publishButton && publishButton.getAttribute("aria-disabled") !== "true")
                break;
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (!publishButton) {
            console.debug('未找到"发布"按钮');
            return;
        }
        if (publishButton.getAttribute("aria-disabled") === "true") {
            console.debug("发布按钮仍不可用，跳过自动发布");
            return;
        }
        console.debug("sendButton clicked");
        publishButton.dispatchEvent(new Event("click", { bubbles: true }));
    }
    try {
        const { title, content, video, tags, cover, horizontalCover, description } = data.data;
        if (!video) {
            console.error("优酷：未提供视频文件");
            return;
        }
        // Upload video.
        const fileInput = (await waitForElement('input[type="file"]'));
        const buf = await (await fetch(video.url)).arrayBuffer();
        const ext = video.name.split(".").pop() || "mp4";
        const videoFile = new File([buf], `${title}.${ext}`, { type: video.type || "video/mp4" });
        const dt = new DataTransfer();
        dt.items.add(videoFile);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 3000));
        // Fill title.
        const titleInput = document.querySelector("input#title");
        if (titleInput && title) {
            titleInput.focus();
            titleInput.value = title;
            titleInput.dispatchEvent(new Event("input", { bubbles: true }));
            titleInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
        // Fill description.
        const descTextarea = document.querySelector('textarea[placeholder="请输入视频简介"]');
        if (descTextarea) {
            descTextarea.focus();
            descTextarea.value = description || content || "";
            descTextarea.dispatchEvent(new Event("input", { bubbles: true }));
            descTextarea.dispatchEvent(new Event("change", { bubbles: true }));
        }
        // Fill tags.
        if (tags?.length) {
            const tagInput = (document.querySelector('input[placeholder="精准标签可获得高点击率，建议8-10个，按Enter键创建"]') || document.querySelector('input[placeholder*="标签"]'));
            if (tagInput) {
                for (const tag of tags.slice(0, 10)) {
                    tagInput.focus();
                    tagInput.value = tag;
                    tagInput.dispatchEvent(new Event("input", { bubbles: true }));
                    tagInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter", keyCode: 13 }));
                    await new Promise((resolve) => setTimeout(resolve, 400));
                }
            }
        }
        // Upload vertical and horizontal covers. Youku uses imgUpload[0] and imgUpload[1].
        if (cover) {
            await uploadCoverImage(cover, 0);
        }
        if (horizontalCover) {
            await uploadCoverImage(horizontalCover, 1);
        }
        await publishIfAutoEnabled();
    }
    catch (error) {
        console.error("优酷视频发布失败:", error);
    }
}

export async function VideoYoutube(data) {
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
            setTimeout(() => {
                observer.disconnect();
                console.warn(`Element with selector "${selector}" not found within ${timeout}ms`);
                resolve(null);
            }, timeout);
        });
    }
    async function uploadCover(cover) {
        console.debug("Trying to upload cover", cover);
        const coverInput = (await waitForElement("input#file-loader.ytcp-thumbnail-uploader", 5000));
        if (!coverInput) {
            console.error("Could not find the thumbnail uploader input.");
            return;
        }
        if (!cover.type || !cover.type.includes("image/")) {
            console.error("Cover file is not an image or type is missing.");
            return;
        }
        const response = await fetch(cover.url);
        const arrayBuffer = await response.arrayBuffer();
        const coverFile = new File([arrayBuffer], cover.name, { type: cover.type });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(coverFile);
        if (dataTransfer.files.length === 0) {
            return;
        }
        coverInput.files = dataTransfer.files;
        coverInput.dispatchEvent(new Event("change", { bubbles: true }));
        coverInput.dispatchEvent(new Event("input", { bubbles: true }));
        console.debug("Cover file upload events dispatched.");
    }
    try {
        const videoData = data.data;
        const originalTitle = videoData.title;
        const displayTitle = videoData.tags?.length
            ? `${originalTitle} ${videoData.tags.map((tag) => `#${tag}`).join(" ")}`
            : originalTitle;
        // 等待上传按钮出现并点击
        const uploadIcon = await waitForElement("ytcp-icon-button#upload-icon");
        if (!uploadIcon) {
            console.error("未找到上传按钮");
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        uploadIcon.click();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // 处理视频上传
        if (!videoData.video) {
            console.error("没有视频文件");
            return;
        }
        const fileInput = document.querySelector('input[type="file"]');
        console.debug("fileInput", fileInput);
        if (!fileInput) {
            console.error("未找到文件输入框");
            return;
        }
        const response = await fetch(videoData.video.url);
        const arrayBuffer = await response.arrayBuffer();
        const extension = videoData.video.name.split(".").pop();
        const fileName = `${originalTitle}.${extension}`;
        const videoFile = new File([arrayBuffer], fileName, { type: videoData.video.type });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(videoFile);
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        fileInput.dispatchEvent(new Event("input", { bubbles: true }));
        console.debug("文件上传操作完成");
        // 等待标题输入框出现
        const titleArea = await waitForElement("#title-textarea");
        if (!titleArea) {
            console.error("未找到 title-textarea");
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
        // 处理标题输入
        console.debug("titleArea", titleArea);
        const titleInput = titleArea.querySelector("#textbox");
        console.debug("titleInput", titleInput);
        if (!titleInput) {
            console.error("未找到 titleInput");
            return;
        }
        // 清空并设置标题
        titleInput.innerHTML = "";
        await new Promise((resolve) => setTimeout(resolve, 1000));
        titleInput.focus();
        const titlePasteEvent = new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: new DataTransfer(),
        });
        titlePasteEvent.clipboardData.setData("text/plain", displayTitle || "");
        titleInput.dispatchEvent(titlePasteEvent);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        titleInput.blur();
        // 处理描述输入
        const descriptionArea = document.querySelector("#description-textarea");
        if (descriptionArea) {
            const descriptionInput = descriptionArea.querySelector("#textbox");
            console.debug("descriptionInput", descriptionInput);
            if (descriptionInput) {
                descriptionInput.focus();
                const descPasteEvent = new ClipboardEvent("paste", {
                    bubbles: true,
                    cancelable: true,
                    clipboardData: new DataTransfer(),
                });
                descPasteEvent.clipboardData.setData("text/plain", videoData.description || videoData.content || "");
                descriptionInput.dispatchEvent(descPasteEvent);
                await new Promise((resolve) => setTimeout(resolve, 1000));
                descriptionInput.blur();
            }
        }
        if (videoData.cover) {
            await uploadCover(videoData.cover);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // 自动发布逻辑
        const buttons = document.querySelectorAll("button");
        const publishButton = Array.from(buttons).find((button) => button.textContent === "发布");
        if (publishButton) {
            if (data.isAutoPublish) {
                console.debug("sendButton clicked");
                publishButton.click();
            }
        }
        else {
            console.debug("未找到'发布'按钮");
        }
    }
    catch (error) {
        console.error("YoutubeVideo 发布过程中出错:", error);
    }
}

export async function VideoZhihu(data) {
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element with selector "${selector}" not found within ${timeout}ms`));
            }, timeout);
        });
    }
    async function waitForElementOptional(selector, timeout = 10000) {
        return waitForElement(selector, timeout).catch(() => null);
    }
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    async function pasteText(element, text) {
        const before = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.value
            : element.textContent || "";
        const pasteEvent = new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: new DataTransfer(),
        });
        pasteEvent.clipboardData.setData("text/plain", text);
        element.dispatchEvent(pasteEvent);
        await sleep(100);
        const after = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.value
            : element.textContent || "";
        if (after !== before) {
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
            return;
        }
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            element.value = `${element.value}${text}`;
        }
        else {
            element.textContent = `${element.textContent || ""}${text}`;
        }
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
    }
    async function uploadVideo(file) {
        const fileInput = (await waitForElementOptional("input[type=file]"));
        if (!fileInput) {
            console.log("未找到知乎视频上传文件输入框");
            return false;
        }
        // 创建一个新的 File 对象，因为某些浏览器可能不允许直接设置 fileInput.files
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        // 触发 change 事件
        const changeEvent = new Event("change", { bubbles: true });
        fileInput.dispatchEvent(changeEvent);
        console.log("视频上传事件已触发");
        return true;
    }
    async function uploadCover(cover) {
        console.debug("tryCover", cover);
        const coverButton = (await waitForElementOptional("div.VideoUploadForm-imageEditButton"));
        console.debug("coverButton -->", coverButton);
        if (!coverButton)
            return false;
        coverButton.click();
        await waitForElementOptional("h3.Modal-title");
        const uploadTabs = document.querySelectorAll("h3.Modal-title div");
        const localUploadTab = Array.from(uploadTabs).find((tab) => tab.textContent?.trim() === "本地上传");
        console.debug("localUploadDiv -->", localUploadTab);
        if (!localUploadTab)
            return false;
        localUploadTab.click();
        const fileInput = (await waitForElementOptional("input[type='file'][accept='image/png,image/jpeg,image/jpg']"));
        console.debug("fileInput -->", fileInput);
        if (!fileInput || (cover.type && !cover.type.includes("image/")))
            return false;
        const response = await fetch(cover.url);
        const arrayBuffer = await response.arrayBuffer();
        const coverFile = new File([arrayBuffer], cover.name, { type: cover.type || "image/png" });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(coverFile);
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        fileInput.dispatchEvent(new Event("input", { bubbles: true }));
        console.debug("封面上传操作已触发");
        await sleep(1000);
        const buttons = document.querySelectorAll("button");
        const confirmButton = Array.from(buttons).find((button) => button.textContent?.trim() === "确认选择");
        console.debug("doneButton -->", confirmButton);
        if (!confirmButton)
            return false;
        confirmButton.click();
        return true;
    }
    async function fillDescription(descriptionText) {
        const contentEditable = (await waitForElementOptional('div[contenteditable="true"]', 5000));
        if (contentEditable) {
            contentEditable.click();
            await sleep(500);
            contentEditable.focus();
            contentEditable.textContent = "";
            contentEditable.innerHTML = "";
            contentEditable.dispatchEvent(new Event("input", { bubbles: true }));
            contentEditable.dispatchEvent(new Event("change", { bubbles: true }));
            await pasteText(contentEditable, `${descriptionText}\n`);
            await sleep(500);
            return;
        }
        const textarea = (await waitForElementOptional('textarea[placeholder="填写视频简介，让更多人找到你的视频"]', 5000));
        if (!textarea) {
            console.log("未找到知乎视频简介输入框");
            return;
        }
        textarea.focus();
        textarea.value = descriptionText;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
        textarea.blur();
    }
    async function addTags(tags) {
        if (tags.length === 0)
            return;
        let contentEditor = null;
        contentEditor = (await waitForElementOptional('div[contenteditable="true"]', 5000));
        if (!contentEditor) {
            console.debug("未找到话题编辑器");
            return;
        }
        for (const tag of tags.slice(0, 5)) {
            console.debug("添加标签", tag);
            contentEditor.focus();
            const pasteEvent = new ClipboardEvent("paste", {
                bubbles: true,
                cancelable: true,
                clipboardData: new DataTransfer(),
            });
            pasteEvent.clipboardData.setData("text/plain", `#${tag}`);
            contentEditor.dispatchEvent(pasteEvent);
            await sleep(1000);
            const activeSuggestion = document.querySelector("div.Menu-item.is-active");
            if (activeSuggestion) {
                const newTopic = activeSuggestion.querySelector("span.new-topic");
                if (newTopic?.textContent?.trim() === "创建新话题") {
                    console.debug("创建新话题", tag);
                    newTopic.click();
                }
                else {
                    activeSuggestion.click();
                }
                await sleep(1000);
            }
        }
        contentEditor.blur();
    }
    async function publishIfAutoEnabled(videoUploaded) {
        if (data.isAutoPublish !== true)
            return;
        if (!videoUploaded) {
            console.warn("知乎自动发布已跳过：视频未成功触发上传");
            return;
        }
        await sleep(5000);
        const divs = document.querySelectorAll("div");
        const publishButton = Array.from(divs).find((div) => div.textContent?.trim() === "发布");
        if (publishButton) {
            console.debug("sendButton clicked");
            publishButton.click();
        }
        else {
            console.debug('未找到"发布"按钮');
        }
    }
    try {
        const { content, video, title, description, tags = [], cover } = data.data;
        let videoUploaded = false;
        // 处理视频上传
        if (video) {
            const response = await fetch(video.url);
            const blob = await response.blob();
            const videoFile = new File([blob], video.name, { type: video.type });
            console.log(`视频文件: ${videoFile.name} ${videoFile.type} ${videoFile.size}`);
            videoUploaded = await uploadVideo(videoFile);
            if (videoUploaded) {
                console.log("视频上传已初始化");
            }
        }
        else {
            console.error("没有视频文件");
        }
        await sleep(5000);
        // 处理标题输入
        const titleInput = (await waitForElementOptional('input[placeholder="输入视频标题"]'));
        if (titleInput) {
            titleInput.value = title || content.slice(0, 20);
            titleInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
        else {
            console.log("未找到知乎视频标题输入框");
        }
        // 填写内容
        await fillDescription(description || content);
        await addTags(tags).catch((error) => {
            console.warn("知乎标签处理失败，继续发布流程:", error);
        });
        if (cover) {
            await uploadCover(cover).catch((error) => {
                console.warn("知乎封面上传失败，继续发布流程:", error);
                return false;
            });
        }
        await publishIfAutoEnabled(videoUploaded);
    }
    catch (error) {
        console.error("知乎视频发布过程中出错:", error);
    }
}

export const multipostInjectors = {
  VIDEO_ALIPAY: VideoAlipay,
  VIDEO_BAIJIAHAO: VideoBaijiahao,
  VIDEO_BILIBILI: VideoBilibili,
  VIDEO_BLUESKY: VideoBluesky,
  VIDEO_CHEJIAHAO: VideoChejiahao,
  VIDEO_DAYU: VideoDayu,
  VIDEO_DEWU: VideoDewu,
  VIDEO_EASTMONEY: VideoEastmoney,
  VIDEO_IQIYI: VideoIqiyi,
  VIDEO_KUAISHOU: VideoKuaishou,
  VIDEO_NETEASE: VideoNetease,
  VIDEO_OKJIKE: VideoOkjike,
  VIDEO_PINDUODUO: VideoPinduoduo,
  VIDEO_QIE: VideoQiE,
  VIDEO_REDNOTE: VideoRednote,
  VIDEO_SOHU: VideoSohu,
  VIDEO_SOHUTV: VideoSohuTv,
  VIDEO_TENCENTVIDEO: VideoTencentVideo,
  VIDEO_TIKTOK: VideoTiktok,
  VIDEO_TOUTIAOHAO: VideoToutiaohao,
  VIDEO_VIVOVIDEO: VideoVivoVideo,
  VIDEO_WEIBO: VideoWeibo,
  VIDEO_WEIXINCHANNEL: VideoWeiXinChannel,
  VIDEO_XIAOHEIHE: VideoXiaoheihe,
  VIDEO_YICHE: VideoYiche,
  VIDEO_YIDIAN: VideoYidian,
  VIDEO_YOUKU: VideoYouku,
  VIDEO_YOUTUBE: VideoYoutube,
  VIDEO_ZHIHU: VideoZhihu,
}
