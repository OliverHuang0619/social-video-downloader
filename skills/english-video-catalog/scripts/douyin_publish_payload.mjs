function comparablePublishText(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function normalizePublishTopics(title, values = []) {
  const titleKey = comparablePublishText(title);
  const result = ["英语启蒙"];
  const seen = new Set(result.map(comparablePublishText));
  for (const raw of values) {
    const topic = String(raw).trim().replace(/^#+/, "");
    const topicKey = comparablePublishText(topic);
    const repeatsTitle = topicKey && titleKey && (topicKey === titleKey
      || (Math.min(topicKey.length, titleKey.length) >= 8 && (topicKey.startsWith(titleKey) || titleKey.startsWith(topicKey))));
    if (!topic || seen.has(topicKey) || repeatsTitle) continue;
    result.push(topic);
    seen.add(topicKey);
    if (result.length === 5) break;
  }
  return result;
}

export function buildPublishDescription(job = {}) {
  const topics = normalizePublishTopics(job.title, job.topics || []);
  return topics.map(topic => `#${topic}`).join(" ");
}

export function shouldWaitForCovers(job = {}) {
  return job.waitForCovers === true;
}
