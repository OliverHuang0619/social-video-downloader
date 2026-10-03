export function buildPublishDescription(job = {}) {
  const topics = [...new Set((job.topics || [])
    .map(topic => String(topic).trim().replace(/^#+/, ""))
    .filter(Boolean))]
    .slice(0, 5);
  return topics.map(topic => `#${topic}`).join(" ");
}

export function shouldWaitForCovers(job = {}) {
  return job.waitForCovers === true;
}
