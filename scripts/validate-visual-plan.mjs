import { chromium } from 'playwright';

const baseUrl = process.env.TF_BASE_URL || 'http://127.0.0.1:3000';
const workspaceId = process.env.TF_WORKSPACE_ID || '61fa490c-89f1-43c9-b773-03ec42c9fd07';
const taskId = process.env.TF_TASK_ID || 'TASK-21';
const targetUrl = `${baseUrl}/workspace/${workspaceId}/tasks/${taskId}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1400 } });

await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1500);

// Expand generated section if collapsed.
const generatedToggle = page.getByRole('button', { name: /Expand|Collapse/i }).first();
if (await generatedToggle.isVisible()) {
  const label = (await generatedToggle.textContent()) || '';
  if (/expand/i.test(label)) {
    await generatedToggle.click();
    await page.waitForTimeout(500);
  }
}

// Expand inner plan panel if collapsed.
const planToggle = page.getByRole('button', { name: /Collapse|Expand/i }).nth(1);
if (await planToggle.isVisible()) {
  const label = (await planToggle.textContent()) || '';
  if (/expand/i.test(label)) {
    await planToggle.click();
    await page.waitForTimeout(800);
  }
}

await page.waitForTimeout(2500);

const hasPlanText = await page.locator('body').innerText().then((t) => /Generated Plan|\bPLAN\b|Architecture Diff/i.test(t));
const svgCount = await page.locator('svg').count();
const hasMermaidLikeSvg = await page.evaluate(() => {
  const svgs = Array.from(document.querySelectorAll('svg'));
  return svgs.some((svg) => {
    const text = (svg.textContent || '').toLowerCase();
    return text.includes('render svg') || text.includes('current') || text.includes('planned') || text.includes('flowchart');
  });
});
const fallbackVisible = await page.locator('text=Invalid Mermaid diagram payload').count();

const screenshotPath = `/tmp/visual-plan-${taskId.toLowerCase()}.png`;
await page.screenshot({ path: screenshotPath, fullPage: true });

const result = {
  targetUrl,
  hasPlanText,
  svgCount,
  hasMermaidLikeSvg,
  fallbackVisible,
  screenshotPath,
};

console.log(JSON.stringify(result, null, 2));

await browser.close();
